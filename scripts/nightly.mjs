// AABL nightly pipeline — game-by-game stats, season totals, standings.
// Runs in GitHub Actions (.github/workflows/nightly.yml).
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   START, END     YYYY-MM-DD range to process (default: yesterday, Eastern).
//                  A range replays several days in order (used to test on 2026).
//   POOL_SEASON    season whose standings get snapshots (default: year of the date)
//
// For each date: final regular-season games -> boxscores -> aabl.stats_game
// (one row per player + role per gamePk, so doubleheaders and suspended games
// never double-count), then rebuild aabl.stats_season, then snapshot standings.
// Points always come from the aabl.scoring table.

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const MLB = 'https://statsapi.mlb.com/api/v1';
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

// ---------- dates ----------
// The job runs ~4am Eastern, before that day's games, so the default is
// YESTERDAY in Eastern time (AAHL lesson: "today" returns empty box scores).
function yesterdayET() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function dateRange(start, end) {
  const out = [];
  for (let d = new Date(start + 'T12:00:00Z'); d <= new Date(end + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}
const START = process.env.START || yesterdayET();
const END = process.env.END || START;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
if (!isDate(START) || !isDate(END) || START > END) { console.error(`Bad date range: ${START} .. ${END}`); process.exit(1); }

// ---------- Supabase ----------
function sbHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}
async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: sbHeaders({ 'Accept-Profile': 'aabl', 'Content-Profile': 'aabl', ...(opts.headers || {}) }) });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function upsert(table, rows, onConflict, resolution = 'merge-duplicates') {
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { Prefer: `resolution=${resolution},return=minimal` }, body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}
const rpc = (fn, args) => sb(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

// ---------- MLB ----------
async function mlb(path, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${MLB}${path}`);
      if (!res.ok) throw new Error(`MLB ${path}: ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1000 * i));
    }
  }
}
async function pool(items, size, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const n = v => Number(v) || 0;
const FINAL = /^(final|game over|completed early)/i;

function hitterLine(b) {
  const h = n(b.hits), d = n(b.doubles), t = n(b.triples), hr = n(b.homeRuns);
  return { singles: Math.max(0, h - d - t - hr), doubles: d, triples: t, hr, rbi: n(b.rbi), runs: n(b.runs),
    bb: n(b.baseOnBalls), hbp: n(b.hitByPitch), sb: n(b.stolenBases), so: n(b.strikeOuts), cs: n(b.caughtStealing) };
}
function pitcherLine(p) {
  const outs = n(p.outs), er = n(p.earnedRuns);
  return { outs, k: n(p.strikeOuts), w: n(p.wins), sv: n(p.saves), hld: n(p.holds), er, l: n(p.losses),
    bb_allowed: n(p.baseOnBalls), h_allowed: n(p.hits),
    qs: n(p.gamesStarted) > 0 && outs >= 18 && er <= 3 ? 1 : 0 };
}
const score = (line, w) => Math.round(Object.entries(w).reduce((t, [k, p]) => t + n(line[k]) * p, 0) * 10) / 10;
const ZERO = { singles: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, sb: 0, so: 0, cs: 0,
  outs: 0, k: 0, w: 0, qs: 0, sv: 0, hld: 0, er: 0, l: 0, bb_allowed: 0, h_allowed: 0 };

async function main() {
  const dates = dateRange(START, END);
  console.log(`Processing ${dates.length} day(s): ${START} .. ${END}`);
  const [run] = await sb('job_runs', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ job: 'nightly', run_date: END, detail: { start: START, end: END } }) });

  const scoring = await sb('scoring?select=player_type,stat,points');
  const weights = { hitter: {}, pitcher: {} };
  scoring.forEach(r => { weights[r.player_type][r.stat] = Number(r.points); });

  const teamCache = new Map();
  async function teamAbbr(season) {
    if (!teamCache.has(season)) {
      const t = await mlb(`/teams?sportId=1&season=${season}`);
      teamCache.set(season, new Map((t.teams || []).map(x => [x.id, x.abbreviation])));
    }
    return teamCache.get(season);
  }

  const log = { days: 0, games: 0, rows: 0, skipped: [], snapshots: 0 };
  const touchedSeasons = new Set();

  for (const date of dates) {
    const season = Number(date.slice(0, 4));
    const abbr = await teamAbbr(season);
    const sched = await mlb(`/schedule?sportId=1&date=${date}&gameType=R`);
    const games = (sched.dates || []).flatMap(d => d.games || []);
    const finals = games.filter(g => FINAL.test((g.status && g.status.detailedState) || ''));
    games.filter(g => !finals.includes(g)).forEach(g => log.skipped.push(`${date} ${g.gamePk} ${g.status && g.status.detailedState}`));
    if (!finals.length) { console.log(`${date}: no final games`); continue; }

    const boxes = await pool(finals, 6, g => mlb(`/game/${g.gamePk}/boxscore`).then(b => ({ g, b })));
    const statRows = [], players = new Map();
    for (const { g, b } of boxes) {
      for (const side of ['away', 'home']) {
        const team = b.teams[side];
        const tAbbr = abbr.get(team.team.id) || null;
        for (const p of Object.values(team.players || {})) {
          const id = p.person && p.person.id;
          if (!id) continue;
          const bat = p.stats && p.stats.batting, pit = p.stats && p.stats.pitching;
          const batted = bat && (n(bat.plateAppearances) > 0 || n(bat.atBats) > 0 || n(bat.runs) > 0 || n(bat.stolenBases) > 0 || n(bat.caughtStealing) > 0);
          const pitched = pit && (n(pit.outs) > 0 || n(pit.battersFaced) > 0);
          if (!batted && !pitched) continue;
          players.set(id, { mlb_id: id, full_name: p.person.fullName, team_abbr: tAbbr,
            position: (p.position && p.position.abbreviation) || null,
            headshot_url: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${id}/headshot/67/current`,
            updated_at: new Date().toISOString() });
          const base = { mlb_id: id, game_pk: g.gamePk, game_date: date, updated_at: new Date().toISOString() };
          if (batted) { const line = hitterLine(bat); statRows.push({ ...ZERO, ...line, ...base, role: 'hitter', points: score(line, weights.hitter) }); }
          if (pitched) { const line = pitcherLine(pit); statRows.push({ ...ZERO, ...line, ...base, role: 'pitcher', points: score(line, weights.pitcher) }); }
        }
      }
    }
    // New players get inserted; existing ones only get their current team updated
    // (position/headshot set by the season import are left alone).
    await upsert('players', [...players.values()].map(p => ({ mlb_id: p.mlb_id, full_name: p.full_name, headshot_url: p.headshot_url, position: p.position, team_abbr: p.team_abbr, updated_at: p.updated_at })), 'mlb_id', 'ignore-duplicates');
    for (const [team, ids] of groupBy([...players.values()], p => p.team_abbr)) {
      if (team) await sb(`players?mlb_id=in.(${ids.map(p => p.mlb_id).join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ team_abbr: team, updated_at: new Date().toISOString() }) });
    }
    await upsert('stats_game', statRows, 'mlb_id,game_pk,role');
    touchedSeasons.add(season);
    log.days++; log.games += finals.length; log.rows += statRows.length;
    console.log(`${date}: ${finals.length} games, ${statRows.length} stat rows`);

    // Snapshot standings for the pool season (only on days with games).
    const poolSeason = Number(process.env.POOL_SEASON || season);
    const snap = await rpc('snapshot_standings', { p_pool_season: poolSeason, p_stats_season: season, p_date: date });
    log.snapshots += n(snap);
  }

  // SKIP_REBUILD=1 is for spot-test runs on a single past day, so season totals
  // aren't replaced with one day's numbers.
  if (process.env.SKIP_REBUILD === '1') touchedSeasons.clear();
  for (const s of touchedSeasons) {
    const rebuilt = await rpc('rebuild_season_stats', { p_season: s });
    console.log(`Season ${s}: rebuilt ${rebuilt} season-total rows`);
  }
  // Standings use stats_game directly, so they're already current; the rebuild
  // keeps stats_season (Players/Boxes pages) in step.

  await sb(`job_runs?id=eq.${run.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ finished_at: new Date().toISOString(), ok: true, detail: { start: START, end: END, ...log, skipped: log.skipped.slice(0, 50) } }) });

  const summary = [`## AABL nightly — ${START}${END !== START ? ' to ' + END : ''}`,
    `Days with games: ${log.days} · Games: ${log.games} · Stat rows: ${log.rows} · Standings rows: ${log.snapshots}`,
    log.skipped.length ? `Skipped (not final): ${log.skipped.length}` : ''].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

function groupBy(list, f) {
  const m = new Map();
  list.forEach(x => { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}

main().catch(async err => {
  console.error(err);
  try {
    await sb('job_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ job: 'nightly', run_date: END, finished_at: new Date().toISOString(), ok: false, detail: { start: START, end: END, error: String(err).slice(0, 500) } }) });
  } catch (e) { /* ignore */ }
  process.exit(1);
});
