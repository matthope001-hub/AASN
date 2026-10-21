// AABL — import the MLB regular-season schedule into aabl.schedule.
// Runs in GitHub Actions (.github/workflows/import-schedule.yml).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SEASON (e.g. 2027)

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SEASON = Number(process.env.SEASON || 2027);
const MLB = 'https://statsapi.mlb.com/api/v1';

if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

function sbHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function sbUpsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Profile': 'aabl', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows.slice(i, i + 500))
    });
    if (!res.ok) throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
  }
}

async function mlb(path) {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB ${path}: ${res.status}`);
  return res.json();
}

async function main() {
  const teams = await mlb(`/teams?sportId=1&season=${SEASON}`);
  const abbr = new Map((teams.teams || []).map(t => [t.id, t.abbreviation]));

  const data = await mlb(`/schedule?sportId=1&season=${SEASON}&gameType=R&hydrate=venue`);
  const now = new Date().toISOString();
  const seen = new Set();
  const rows = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      if (seen.has(g.gamePk)) continue;   // a postponed game can be listed on two dates
      seen.add(g.gamePk);
      const away = g.teams && g.teams.away, home = g.teams && g.teams.home;
      rows.push({
        game_pk: g.gamePk,
        season: SEASON,
        game_date: g.officialDate || d.date,
        start_time: g.gameDate || null,
        game_type: g.gameType || 'R',
        away_abbr: abbr.get(away.team.id) || away.team.name,
        home_abbr: abbr.get(home.team.id) || home.team.name,
        venue: (g.venue && g.venue.name) || null,
        status: (g.status && g.status.detailedState) || null,
        away_score: away.score ?? null,
        home_score: home.score ?? null,
        doubleheader: g.doubleHeader || 'N',
        game_number: g.gameNumber || 1,
        updated_at: now
      });
    }
  }

  const summary = [`## AABL import — MLB ${SEASON} schedule`];
  if (!rows.length) {
    summary.push(`MLB has not published a ${SEASON} regular-season schedule yet. Nothing imported.`);
  } else {
    await sbUpsert('schedule', rows, 'game_pk');
    const dates = rows.map(r => r.game_date).sort();
    summary.push(`Games: ${rows.length} · ${dates[0]} to ${dates[dates.length - 1]}`);
  }
  console.log(summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}

main().catch(err => { console.error(err); process.exit(1); });
