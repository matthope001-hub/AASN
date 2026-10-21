// AABL — import MLB season totals into Supabase (aabl.players + aabl.stats_season)
// Runs in GitHub Actions (see .github/workflows/import-season.yml).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SEASON (e.g. 2026)
// Points are calculated from the aabl.scoring table, never hardcoded.

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SEASON = Number(process.env.SEASON || 2026);
const MLB = 'https://statsapi.mlb.com/api/v1';

if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

// ---------- Supabase helpers ----------
function sbHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`; // legacy service_role JWT
  return h;
}

async function sbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders({ 'Accept-Profile': 'aabl' })
  });
  if (!res.ok) throw new Error(`select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: sbHeaders({
        'Content-Profile': 'aabl',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify(chunk)
    });
    if (!res.ok) throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
  }
}

// ---------- MLB helpers ----------
async function mlb(path) {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB ${path}: ${res.status}`);
  return res.json();
}

async function seasonSplits(group) {
  const out = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const data = await mlb(`/stats?stats=season&group=${group}&season=${SEASON}&sportId=1&gameType=R&playerPool=ALL&limit=${limit}&offset=${offset}`);
    const splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
    out.push(...splits);
    if (splits.length < limit) break;
  }
  return out;
}

// Traded players can have one split per team. Use the combined split if MLB
// provides one (no team), otherwise sum the per-team splits.
function combineByPlayer(splits) {
  const byId = new Map();
  for (const s of splits) {
    const id = s.player && s.player.id;
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(s);
  }
  const result = [];
  for (const [id, list] of byId) {
    const total = list.find(s => !s.team);
    const withTeam = list.filter(s => s.team);
    const lastTeam = withTeam.length ? withTeam[withTeam.length - 1].team : null;
    let stat;
    if (total) stat = total.stat;
    else {
      stat = {};
      for (const s of withTeam) for (const [k, v] of Object.entries(s.stat || {})) {
        if (typeof v === 'number') stat[k] = (stat[k] || 0) + v;
      }
    }
    result.push({ id, name: list[0].player.fullName, position: list[0].position && list[0].position.abbreviation, team: lastTeam, stat });
  }
  return result;
}

const n = v => Number(v) || 0;

function hitterLine(st) {
  const hits = n(st.hits), d = n(st.doubles), t = n(st.triples), hr = n(st.homeRuns);
  return {
    games: n(st.gamesPlayed),
    singles: Math.max(0, hits - d - t - hr), doubles: d, triples: t, hr,
    rbi: n(st.rbi), runs: n(st.runs), bb: n(st.baseOnBalls), hbp: n(st.hitByPitch),
    sb: n(st.stolenBases), so: n(st.strikeOuts), cs: n(st.caughtStealing)
  };
}

// Quality starts aren't in MLB season totals, so count them from each
// starter's game log: a start with 6+ IP (18+ outs) and 3 or fewer ER.
async function qualityStarts(pitchers) {
  const qs = new Map();
  const starters = pitchers.filter(p => n(p.stat.gamesStarted) > 0);
  let i = 0, failed = 0;
  async function worker() {
    while (i < starters.length) {
      const p = starters[i++];
      try {
        const data = await mlb(`/people/${p.id}/stats?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`);
        const splits = (data.stats && data.stats[0] && data.stats[0].splits) || [];
        qs.set(p.id, splits.filter(g => n(g.stat.gamesStarted) > 0 && n(g.stat.outs) >= 18 && n(g.stat.earnedRuns) <= 3).length);
      } catch (e) { failed++; }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Quality starts counted for ${qs.size} starters (${failed} failed)`);
  return { qs, failed };
}

let qsCounts = new Map();
function pitcherLine(st, id) {
  return {
    games: n(st.gamesPlayed),
    outs: n(st.outs), k: n(st.strikeOuts), w: n(st.wins), qs: qsCounts.get(id) || 0,
    sv: n(st.saves), hld: n(st.holds), er: n(st.earnedRuns), l: n(st.losses),
    bb_allowed: n(st.baseOnBalls), h_allowed: n(st.hits)
  };
}

function score(line, weights) {
  let pts = 0;
  for (const [stat, p] of Object.entries(weights)) pts += n(line[stat]) * p;
  return Math.round(pts * 10) / 10;
}

// ---------- Main ----------
async function main() {
  console.log(`Importing MLB ${SEASON} regular-season totals…`);

  const scoring = await sbSelect('scoring', 'select=player_type,stat,points');
  const weights = { hitter: {}, pitcher: {} };
  for (const r of scoring) weights[r.player_type][r.stat] = Number(r.points);

  const teamsData = await mlb(`/teams?sportId=1&season=${SEASON}`);
  const teamAbbr = new Map((teamsData.teams || []).map(t => [t.id, t.abbreviation]));

  const hitters = combineByPlayer(await seasonSplits('hitting'))
    .filter(p => n(p.stat.plateAppearances) > 0);
  const pitchers = combineByPlayer(await seasonSplits('pitching'))
    .filter(p => n(p.stat.outs) > 0);

  console.log(`Hitters: ${hitters.length}, pitchers: ${pitchers.length}`);
  const qsResult = await qualityStarts(pitchers);
  qsCounts = qsResult.qs;

  // Players (one row per person; two-way players appear once here)
  const players = new Map();
  for (const p of [...hitters, ...pitchers]) {
    if (players.has(p.id)) continue;
    players.set(p.id, {
      mlb_id: p.id,
      full_name: p.name,
      team_abbr: p.team ? (teamAbbr.get(p.team.id) || null) : null,
      position: p.position || null,
      headshot_url: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${p.id}/headshot/67/current`,
      active: true,
      updated_at: new Date().toISOString()
    });
  }
  await sbUpsert('players', [...players.values()], 'mlb_id');

  // Season stats (one row per player + role; Ohtani gets a hitter AND a pitcher row)
  const zero = { singles: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, sb: 0, so: 0, cs: 0,
                 outs: 0, k: 0, w: 0, qs: 0, sv: 0, hld: 0, er: 0, l: 0, bb_allowed: 0, h_allowed: 0 };
  const now = new Date().toISOString();
  const rows = [
    ...hitters.map(p => { const line = hitterLine(p.stat); return { ...zero, ...line, season: SEASON, mlb_id: p.id, role: 'hitter', points: score(line, weights.hitter), updated_at: now }; }),
    ...pitchers.map(p => { const line = pitcherLine(p.stat, p.id); return { ...zero, ...line, season: SEASON, mlb_id: p.id, role: 'pitcher', points: score(line, weights.pitcher), updated_at: now }; })
  ];
  await sbUpsert('stats_season', rows, 'season,mlb_id,role');

  // Summary
  const name = id => players.get(id).full_name;
  const top = role => rows.filter(r => r.role === role).sort((a, b) => b.points - a.points).slice(0, 10)
    .map((r, i) => `| ${i + 1} | ${name(r.mlb_id)} | ${players.get(r.mlb_id).team_abbr || ''} | ${r.points} |`).join('\n');
  const summary = [
    `## AABL import — MLB ${SEASON} season totals`,
    `Players: ${players.size} · Hitter rows: ${hitters.length} · Pitcher rows: ${pitchers.length}`,
    `Quality starts counted for ${qsCounts.size} starters` + (qsResult.failed ? ` (⚠️ ${qsResult.failed} failed — rerun to retry)` : ''),
    '\n### Top 10 hitters\n| # | Player | Team | Pts |\n|---|---|---|---|\n' + top('hitter'),
    '\n### Top 10 pitchers\n| # | Player | Team | Pts |\n|---|---|---|---|\n' + top('pitcher')
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
