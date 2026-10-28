// AASN nightly backup — dumps every AABL table, every AAFL table (public.aafl_*) and the
// shared AASN champions table to one JSON file. The workflow gzips and encrypts it
// before uploading, because artifacts on a public repo can be downloaded.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, OUT (default backup.json)
//
// Restore: decrypt (see .github/workflows/backup.yml), then insert each
// table's rows back via the SQL editor or the REST API.

import { writeFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

// table -> order (stable paging)
const TABLES = {
  aabl: {
    config: 'season', scoring: 'player_type,stat', players: 'mlb_id', boxes: 'season,box_id',
    box_options: 'option_id', entries: 'entry_id', picks: 'entry_id,box_id', division_picks: 'entry_id,division',
    division_winners: 'season,division', trades: 'trade_id', il: 'mlb_id', schedule: 'game_pk',
    stats_season: 'season,mlb_id,role', stats_game: 'mlb_id,game_pk,role', standings: 'season,snapshot_date,entry_id',
    job_runs: 'id'
  },
  public: {
    champions: 'id',
    aafl_config: 'season', aafl_teams: 'id', aafl_invites: 'code', aafl_games: 'id',
    aafl_picks: 'team_id,game_id', aafl_credits: 'team_id,week'
  }
};

async function dump(schema, table, order) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const headers = { apikey: KEY, 'Accept-Profile': schema };
    if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
    let res = await fetch(`${URL}/rest/v1/${table}?select=*&order=${order}&limit=1000&offset=${off}`, { headers });
    // If an order column doesn't exist, fall back to unordered paging.
    if (res.status === 400 && off === 0) { order = null; res = await fetch(`${URL}/rest/v1/${table}?select=*&limit=1000&offset=${off}`, { headers }); }
    if (!res.ok) throw new Error(`${schema}.${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const out = { taken_at: new Date().toISOString(), tables: {} };
let failed = 0;
for (const [schema, list] of Object.entries(TABLES)) {
  for (const [table, order] of Object.entries(list)) {
    try {
      out.tables[`${schema}.${table}`] = await dump(schema, table, order);
      console.log(`${schema}.${table}: ${out.tables[`${schema}.${table}`].length} rows`);
    } catch (e) { failed++; console.error(String(e.message || e)); }
  }
}
writeFileSync(process.env.OUT || 'backup.json', JSON.stringify(out));
if (failed) { console.error(`${failed} table(s) failed`); process.exit(1); }
