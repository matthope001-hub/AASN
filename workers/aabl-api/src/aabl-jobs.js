// AABL jobs moved off GitHub Actions onto aasn-api's every-minute cron.
// Work is split across several one-minute ticks so each run stays inside the free plan
// (50 outside requests and a few ms of CPU per run). Nothing here touches AAHL.
//
//   Nightly stats   08:17–08:36 UTC  yesterday's (Eastern) final games, 3 box scores per tick,
//                                    then standings snapshot + season totals rebuild.
//   Backup          09:30–09:59 UTC  every AABL table, AAFL tables and champions, as CSV pages,
//                                    into D1 (table aabl_backups). stats_game only on Sundays
//                                    (it can always be rebuilt from MLB box scores). Kept 30 days.
//   Schedule        10:05–10:08 UTC  MLB regular-season schedule in 4 date chunks + pick deadline.
//   Player news     every 4h, :41–:46 ESPN/RotoWire news, one batch of 25 players per tick.
//   Site health     every 15 min (:12) AASN pages + Supabase; emails when something is down twice in a row,
//                                    and again when it's back.

const MLB = 'https://statsapi.mlb.com/api/v1';
const ESPN = 'https://site.api.espn.com/apis';
const n = v => Number(v) || 0;

// ---------- Supabase (aabl schema unless told otherwise) ----------
async function sb(env, path, opts = {}, schema = 'aabl') {
  const key = env.SUPABASE_SERVICE_KEY;
  const h = { apikey: key, 'Content-Type': 'application/json', 'Accept-Profile': schema, 'Content-Profile': schema, ...(opts.headers || {}) };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: h });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
const upsert = (env, table, rows, onConflict, resolution = 'merge-duplicates') => rows.length
  ? sb(env, `${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { Prefer: `resolution=${resolution},return=minimal` }, body: JSON.stringify(rows) })
  : null;
const rpc = (env, fn, args) => sb(env, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AASN)' } });
  if (!res.ok) throw new Error(`${url.split('?')[0]}: ${res.status}`);
  return res.json();
}

async function poolSeason(env) {
  const r = await sb(env, 'config?select=season&order=season.desc&limit=1');
  return r && r[0] ? Number(r[0].season) : new Date().getUTCFullYear() + 1;
}

// ---------- dispatcher ----------
// send(to, subject, text, html) is aasn-api's Gmail sender, used for site health alerts.
export async function aablJobs(env, tick, send) {
  if (!env.SUPABASE_SERVICE_KEY) return;
  const h = tick.getUTCHours(), m = tick.getUTCMinutes();
  const jobs = [];
  if (m % 15 === 12 && env.DB) jobs.push(logRun('health', siteHealth(env, send)));
  if (h === 8 && m >= 17 && m <= 36) jobs.push(logRun('nightly', aablNightly(env, { part: m - 17 })));
  else if (h === 9 && m >= 30 && env.DB) jobs.push(logRun('backup', aablBackup(env, tick)));
  else if (h === 10 && m >= 5 && m <= 8) jobs.push(logRun('schedule', aablSchedule(env, { chunk: m - 5 })));
  else if (h % 4 === 0 && m >= 41 && m <= 46) jobs.push(logRun('news', aablNews(env, { batch: m - 41 })));
  await Promise.all(jobs);
}
async function logRun(name, p) {
  const out = await p;
  if (out) console.log(`AABL ${name}: ${JSON.stringify(out)}`);
  return out;
}

// ---------- Nightly stats ----------
const FINAL = /^(final|game over|completed early)/i;
const PER_TICK = 3, PARTS = 20;
function yesterdayET() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function hitterLine(b) {
  const h = n(b.hits), d = n(b.doubles), t = n(b.triples), hr = n(b.homeRuns);
  return { singles: Math.max(0, h - d - t - hr), doubles: d, triples: t, hr, rbi: n(b.rbi), runs: n(b.runs),
    bb: n(b.baseOnBalls), hbp: n(b.hitByPitch), sb: n(b.stolenBases), so: n(b.strikeOuts), cs: n(b.caughtStealing) };
}
function pitcherLine(p) {
  const outs = n(p.outs), er = n(p.earnedRuns);
  return { outs, k: n(p.strikeOuts), w: n(p.wins), sv: n(p.saves), hld: n(p.holds), er, l: n(p.losses),
    bb_allowed: n(p.baseOnBalls), h_allowed: n(p.hits), qs: n(p.gamesStarted) > 0 && outs >= 18 && er <= 3 ? 1 : 0 };
}
const score = (line, w) => Math.round(Object.entries(w).reduce((t, [k, p]) => t + n(line[k]) * p, 0) * 10) / 10;
const ZERO = { singles: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, runs: 0, bb: 0, hbp: 0, sb: 0, so: 0, cs: 0,
  outs: 0, k: 0, w: 0, qs: 0, sv: 0, hld: 0, er: 0, l: 0, bb_allowed: 0, h_allowed: 0 };

// opts: part (0..), date (YYYY-MM-DD, default yesterday Eastern), dry (true = read only, no writes)
export async function aablNightly(env, { part = 0, date = yesterdayET(), dry = false } = {}) {
  const season = Number(date.slice(0, 4));
  const sched = await getJson(`${MLB}/schedule?sportId=1&date=${date}&gameType=R&fields=dates,games,gamePk,status,detailedState`);
  const games = (sched.dates || []).flatMap(d => d.games || []);
  const finals = games.filter(g => FINAL.test((g.status && g.status.detailedState) || '')).sort((a, b) => a.gamePk - b.gamePk);
  const slice = finals.slice(part * PER_TICK, part * PER_TICK + PER_TICK);
  const last = finals.length ? Math.ceil(finals.length / PER_TICK) - 1 : 0;
  if (part > last) return null;
  const out = { date, part, games: slice.length, of: finals.length, rows: 0, dry };
  try {
    if (slice.length) {
      const [scoring, teams] = await Promise.all([sb(env, 'scoring?select=player_type,stat,points'), getJson(`${MLB}/teams?sportId=1&season=${season}&fields=teams,id,abbreviation`)]);
      const weights = { hitter: {}, pitcher: {} };
      scoring.forEach(r => { weights[r.player_type][r.stat] = Number(r.points); });
      const abbr = new Map((teams.teams || []).map(x => [x.id, x.abbreviation]));
      const boxes = await Promise.all(slice.map(g => getJson(`${MLB}/game/${g.gamePk}/boxscore`).then(b => ({ g, b }))));
      const statRows = [], players = new Map(), now = new Date().toISOString();
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
            players.set(id, { mlb_id: id, full_name: p.person.fullName, team_abbr: tAbbr, position: (p.position && p.position.abbreviation) || null,
              headshot_url: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${id}/headshot/67/current`, updated_at: now });
            const base = { mlb_id: id, game_pk: g.gamePk, game_date: date, updated_at: now };
            if (batted) { const line = hitterLine(bat); statRows.push({ ...ZERO, ...line, ...base, role: 'hitter', points: score(line, weights.hitter) }); }
            if (pitched) { const line = pitcherLine(pit); statRows.push({ ...ZERO, ...line, ...base, role: 'pitcher', points: score(line, weights.pitcher) }); }
          }
        }
      }
      out.rows = statRows.length;
      out.points = Math.round(statRows.reduce((t, r) => t + r.points, 0) * 10) / 10;
      if (!dry) {
        const list = [...players.values()];
        // New players get inserted; existing ones only get their current team (and name) refreshed.
        await upsert(env, 'players', list, 'mlb_id', 'ignore-duplicates');
        await upsert(env, 'players', list.filter(p => p.team_abbr).map(p => ({ mlb_id: p.mlb_id, full_name: p.full_name, team_abbr: p.team_abbr, updated_at: now })), 'mlb_id');
        await upsert(env, 'stats_game', statRows, 'mlb_id,game_pk,role');
      }
    }
    if (part === last && !dry) {
      if (finals.length) {
        const ps = Number(env.AABL_POOL_SEASON || season);
        out.snapshots = n(await rpc(env, 'snapshot_standings', { p_pool_season: ps, p_stats_season: season, p_date: date }));
        out.rebuilt = n(await rpc(env, 'rebuild_season_stats', { p_season: season }));
      }
      const skipped = games.filter(g => !finals.includes(g)).map(g => `${date} ${g.gamePk} ${g.status && g.status.detailedState}`);
      await sb(env, 'job_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ job: 'nightly', run_date: date, finished_at: new Date().toISOString(), ok: true,
        detail: { start: date, end: date, source: 'cloudflare', days: finals.length ? 1 : 0, games: finals.length, snapshots: out.snapshots || 0, skipped: skipped.slice(0, 50) } }) });
    }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 400);
    if (!dry) await sb(env, 'job_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ job: 'nightly', run_date: date, finished_at: new Date().toISOString(), ok: false, detail: { source: 'cloudflare', part, error: out.error } }) }).catch(() => {});
  }
  return out;
}

// ---------- Schedule ----------
const CHUNKS = [['02-01', '04-30'], ['05-01', '06-30'], ['07-01', '08-31'], ['09-01', '11-30']];
export async function aablSchedule(env, { chunk = 0, season, dry = false } = {}) {
  season = Number(season || await poolSeason(env));
  const [from, to] = CHUNKS[chunk] || [];
  if (!from) return null;
  const fields = 'dates,date,games,gamePk,gameDate,officialDate,gameType,teams,away,home,team,id,name,score,venue,status,detailedState,startTimeTBD,doubleHeader,gameNumber';
  const [teams, data] = await Promise.all([
    getJson(`${MLB}/teams?sportId=1&season=${season}&fields=teams,id,abbreviation`),
    getJson(`${MLB}/schedule?sportId=1&gameType=R&hydrate=venue&startDate=${season}-${from}&endDate=${season}-${to}&fields=${fields}`)
  ]);
  const abbr = new Map((teams.teams || []).map(t => [t.id, t.abbreviation]));
  const now = new Date().toISOString(), seen = new Set(), rows = [];
  for (const d of data.dates || []) for (const g of d.games || []) {
    if (seen.has(g.gamePk)) continue;   // a postponed game can be listed on two dates
    seen.add(g.gamePk);
    const away = g.teams.away, home = g.teams.home;
    rows.push({ game_pk: g.gamePk, season, game_date: g.officialDate || d.date, start_time: g.gameDate || null, game_type: g.gameType || 'R',
      away_abbr: abbr.get(away.team.id) || away.team.name, home_abbr: abbr.get(home.team.id) || home.team.name,
      venue: (g.venue && g.venue.name) || null, status: (g.status && g.status.detailedState) || null,
      away_score: away.score ?? null, home_score: home.score ?? null, doubleheader: g.doubleHeader || 'N',
      _tbd: !!(g.status && g.status.startTimeTBD), game_number: g.gameNumber || 1, updated_at: now });
  }
  const out = { season, chunk, games: rows.length, dry };
  if (!rows.length) return out;
  if (!dry) await upsert(env, 'schedule', rows.map(({ _tbd, ...r }) => r), 'game_pk');
  if (chunk === 0) out.deadline = await setDeadline(env, season, rows, dry);
  return out;
}

// Pick deadline = first pitch of the first regular-season game. MLB lists unset times as 3:33am local
// (or flags startTimeTBD), so it's only set once a real time is posted, and never changes once passed.
async function setDeadline(env, season, rows, dry) {
  const firstDate = rows.map(r => r.game_date).sort()[0];
  const first = rows.filter(r => r.game_date === firstDate && r.start_time).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  if (!first) return 'no start time listed yet';
  const etTime = t => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t));
  const placeholder = r => r._tbd || !r.start_time || /^0[3-7]:33$/.test(etTime(r.start_time));
  const pending = rows.filter(r => r.game_date === firstDate && placeholder(r)).length;
  if (pending) return `${pending} Opening Day game(s) (${firstDate}) have no real start time yet - not set`;
  const [cfg] = await sb(env, `config?select=opening_day,picks_locked&season=eq.${season}`);
  if (!cfg) return 'no config row - not set';
  const now = Date.now();
  if (cfg.picks_locked || (cfg.opening_day && new Date(cfg.opening_day).getTime() <= now)) return 'already passed - left as is';
  if (new Date(first.start_time).getTime() <= now) return 'first pitch is in the past - not set';
  if (cfg.opening_day && new Date(cfg.opening_day).getTime() === new Date(first.start_time).getTime()) return `unchanged (${first.start_time})`;
  if (!dry) await sb(env, `config?season=eq.${season}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ opening_day: first.start_time }) });
  return `${dry ? 'would set' : 'set'} to ${first.away_abbr} @ ${first.home_abbr}, ${first.start_time} (${etTime(first.start_time)} ET)`;
}

// ---------- Player news ----------
const NEWS_BATCH = 25, ITEMS_PER_PLAYER = 2;
const OVERRIDES = { '650333': '39572', '643289': '35304', '673548': '4142424', '646240': '33859', '680777': '41587',
  '664023': '34945', '668227': '36488', '670280': '38303', '641343': '35013', '664040': '39961' };
const TEAM_FIX = { ARI: 'AZ', CHW: 'CWS', OAK: 'ATH', WSN: 'WSH' };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii)\b/g, '').replace(/[^a-z]/g, '');

export async function aablNews(env, { batch = 0, dry = false } = {}) {
  const opts = await sb(env, 'box_options?select=mlb_id');
  const ids = [...new Set(opts.map(o => o.mlb_id))].sort((a, b) => a - b);
  if (!ids.length) return null;
  const [players, stored] = await Promise.all([
    sb(env, `players?select=mlb_id,full_name,team_abbr&mlb_id=in.(${ids.join(',')})`),
    sb(env, `player_news?select=mlb_id,espn:data->>espnId&mlb_id=in.(${ids.join(',')})`)
  ]);
  const espn = new Map(stored.filter(r => r.espn).map(r => [String(r.mlb_id), String(r.espn)]));
  for (const [k, v] of Object.entries(OVERRIDES)) espn.set(k, v);
  const out = { batch, dry };

  // First tick: find ESPN ids for pool players we don't have yet (only their teams' rosters are read).
  if (batch === 0) {
    const missing = players.filter(p => !espn.has(String(p.mlb_id)));
    const unmatched = [], found = [];
    if (missing.length) {
      const tj = await getJson(`${ESPN}/site/v2/sports/baseball/mlb/teams`);
      const teams = (tj?.sports?.[0]?.leagues?.[0]?.teams || []).map(t => t.team);
      const byAbbr = new Map(teams.map(t => [TEAM_FIX[t.abbreviation] || t.abbreviation, t.id]));
      const want = [...new Set(missing.map(p => p.team_abbr).filter(a => byAbbr.has(a)))].slice(0, 10);
      const byName = new Map();
      for (const ab of want) {
        const roster = await getJson(`${ESPN}/site/v2/sports/baseball/mlb/teams/${byAbbr.get(ab)}/roster`).catch(() => null);
        for (const a of (roster?.athletes || []).flatMap(g => g.items ? g.items : [g])) {
          const key = norm(a.fullName || a.displayName);
          if (key) (byName.get(key) || byName.set(key, []).get(key)).push({ espnId: String(a.id), team: ab });
        }
      }
      for (const p of missing) {
        const hits = byName.get(norm(p.full_name)) || [];
        const pick = hits.length === 1 ? hits[0] : hits.find(h => h.team === p.team_abbr);
        if (pick) { espn.set(String(p.mlb_id), pick.espnId); found.push({ mlb_id: p.mlb_id, data: { espnId: pick.espnId, items: [] }, updated_at: new Date().toISOString() }); }
        else unmatched.push(`${p.full_name} (${p.team_abbr || '-'}, MLB ${p.mlb_id})`);
      }
    }
    // New matches get an empty row now; their news fills in on their batch's tick.
    if (!dry) await upsert(env, 'player_news', [...found, { mlb_id: 0, data: { lastRun: new Date().toISOString(), matched: espn.size, unmatched, source: 'cloudflare' }, updated_at: new Date().toISOString() }], 'mlb_id');
    out.newMatches = found.length; out.unmatched = unmatched.length;
  }

  const matched = ids.map(String).filter(id => espn.has(id));
  const chunk = matched.slice(batch * NEWS_BATCH, batch * NEWS_BATCH + NEWS_BATCH);
  if (!chunk.length) return batch === 0 ? out : null;
  const json = await getJson(`${ESPN}/fantasy/v2/games/flb/news/players?${chunk.map(id => 'playerId=' + espn.get(id)).join('&')}&limit=${chunk.length * 8}`).catch(() => null);
  if (!json || !Array.isArray(json.feed)) { out.error = 'ESPN batch failed - existing news left as is'; return out; }
  const byEspn = new Map();
  for (const it of json.feed) {
    if (it.type !== 'Rotowire' || it.premium) continue;
    const k = String(it.playerId);
    (byEspn.get(k) || byEspn.set(k, []).get(k)).push({ headline: it.headline, story: it.story || '', published: it.published });
  }
  const now = new Date().toISOString();
  const rows = chunk.map(id => ({ mlb_id: Number(id), updated_at: now, data: { espnId: espn.get(id),
    items: (byEspn.get(espn.get(id)) || []).sort((a, b) => (b.published || '').localeCompare(a.published || '')).slice(0, ITEMS_PER_PLAYER) } }));
  if (!dry) await upsert(env, 'player_news', rows, 'mlb_id');
  out.players = rows.length; out.withNews = rows.filter(r => r.data.items.length).length;
  return out;
}

// ---------- Backup (to D1, as CSV pages of 1,000 rows) ----------
// Restore: SELECT csv FROM aabl_backups WHERE day = '...' AND tbl = '...' ORDER BY off — each page is a
// CSV with a header row that can be imported in Supabase's table editor.
const BACKUP_TABLES = [
  ['aabl', 'config', 'season'], ['aabl', 'scoring', 'player_type,stat'], ['aabl', 'players', 'mlb_id'], ['aabl', 'boxes', 'season,box_id'],
  ['aabl', 'box_options', 'option_id'], ['aabl', 'entries', 'entry_id'], ['aabl', 'picks', 'entry_id,box_id'], ['aabl', 'division_picks', 'entry_id,division'],
  ['aabl', 'division_winners', 'season,division'], ['aabl', 'trades', 'trade_id'], ['aabl', 'il', 'mlb_id'], ['aabl', 'schedule', 'game_pk'],
  ['aabl', 'stats_season', 'season,mlb_id,role'], ['aabl', 'standings', 'season,snapshot_date,entry_id'], ['aabl', 'job_runs', 'id'],
  ['aabl', 'player_news', 'mlb_id'],
  ['public', 'champions', 'id'], ['public', 'aafl_config', 'season'], ['public', 'aafl_teams', 'id'], ['public', 'aafl_invites', 'code'],
  ['public', 'aafl_games', 'id'], ['public', 'aafl_picks', 'team_id,game_id'], ['public', 'aafl_credits', 'team_id,week'],
  ['aabl', 'stats_game', 'mlb_id,game_pk,role', 'weekly']
];
const PAGES_PER_TICK = 8, PAGE = 1000;

export async function aablBackup(env, tick = new Date()) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS aabl_backups (day TEXT, tbl TEXT, off INTEGER, n INTEGER, csv TEXT, at TEXT, PRIMARY KEY (day, tbl, off))').run();
  const day = tick.toISOString().slice(0, 10);
  const done = await env.DB.prepare('SELECT tbl, off, n FROM aabl_backups WHERE day = ?').bind(day).all();
  const have = new Map();
  for (const r of done.results) (have.get(r.tbl) || have.set(r.tbl, []).get(r.tbl)).push(r);
  if (have.has('__done')) return null;
  const firstEver = !(await env.DB.prepare("SELECT 1 FROM aabl_backups WHERE tbl = 'aabl.stats_game' AND n >= 0 AND n < 1000 LIMIT 1").first());
  const weekly = tick.getUTCDay() === 0 || firstEver || have.has('aabl.stats_game');  // Sundays, until one full copy exists, or to finish today's
  const key = env.SUPABASE_SERVICE_KEY, out = { day, pages: 0, rows: 0, errors: [] };
  let budget = PAGES_PER_TICK;
  for (const [schema, table, order, when] of BACKUP_TABLES) {
    if (when === 'weekly' && !weekly) continue;
    const name = `${schema}.${table}`;
    const pages = have.get(name) || [];
    if (pages.some(p => p.n < PAGE)) continue;          // table finished (last page short, or -1 = error)
    let off = pages.length ? Math.max(...pages.map(p => p.off)) + PAGE : 0;
    while (budget > 0) {
      budget--;
      const h = { apikey: key, 'Accept-Profile': schema, Accept: 'text/csv' };
      if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
      const q = `${env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${off}`;
      let res = await fetch(order ? `${q}&order=${order}` : q, { headers: h });
      if (res.status === 400 && order) res = await fetch(q, { headers: h });
      if (!res.ok) {
        const err = `${res.status} ${(await res.text()).slice(0, 200)}`;
        out.errors.push(`${name}: ${err}`);
        await env.DB.prepare('INSERT OR REPLACE INTO aabl_backups VALUES (?, ?, ?, -1, ?, ?)').bind(day, name, off, 'ERROR ' + err, new Date().toISOString()).run();
        break;
      }
      const csv = await res.text();
      const range = (res.headers.get('Content-Range') || '').match(/^(\d+)-(\d+)/);
      const rows = range ? Number(range[2]) - Number(range[1]) + 1 : 0;
      await env.DB.prepare('INSERT OR REPLACE INTO aabl_backups VALUES (?, ?, ?, ?, ?, ?)').bind(day, name, off, rows, csv, new Date().toISOString()).run();
      out.pages++; out.rows += rows;
      if (rows < PAGE) break;
      off += PAGE;
    }
    if (budget <= 0) return out;
  }
  await env.DB.prepare('INSERT OR REPLACE INTO aabl_backups VALUES (?, ?, 0, 0, ?, ?)').bind(day, '__done', weekly ? 'with stats_game' : 'without stats_game', new Date().toISOString()).run();
  // Keep 30 days of backups.
  out.removed = (await env.DB.prepare("DELETE FROM aabl_backups WHERE day < date(?, '-30 days')").bind(day).run()).meta.changes;
  out.finished = true;
  return out;
}

// ---------- Site health ----------
const HEALTH_PAGES = [
  ['AASN home', 'https://aasn.theaahl.ca/'], ['Death Pool', 'https://aasn.theaahl.ca/deathpool/'],
  ['AAFL', 'https://aasn.theaahl.ca/aafl/'], ['AABL', 'https://aasn.theaahl.ca/aabl/']
];
export async function siteHealth(env, send) {
  const check = async (name, fn) => { try { const d = await fn(); return [name, true, d]; } catch (e) { return [name, false, String(e.message || e).slice(0, 150)]; } };
  const results = await Promise.all([
    ...HEALTH_PAGES.map(([name, url]) => check(name, async () => {
      const r = await fetch(url, { headers: { 'User-Agent': 'AASN-health' } });
      const t = await r.text();
      if (!r.ok || t.length < 500) throw new Error(`HTTP ${r.status}`);
      return `HTTP ${r.status}`;
    })),
    check('Supabase', async () => { await sb(env, 'config?select=season&limit=1'); return 'ok'; })
  ]);
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS site_health (name TEXT PRIMARY KEY, ok INTEGER, fails INTEGER, alerted INTEGER, since TEXT, detail TEXT)').run();
  const prev = new Map((await env.DB.prepare('SELECT * FROM site_health').all()).results.map(r => [r.name, r]));
  const now = new Date().toISOString(), down = [], back = [], writes = [];
  for (const [name, ok, detail] of results) {
    const p = prev.get(name) || { ok: 1, fails: 0, alerted: 0, since: now };
    const fails = ok ? 0 : n(p.fails) + 1;
    let alerted = n(p.alerted);
    if (!ok && fails >= 2 && !alerted) { down.push(`${name}: ${detail}`); alerted = 1; }
    if (ok && alerted) { back.push(name); alerted = 0; }
    const since = n(p.ok) === (ok ? 1 : 0) ? p.since : now;
    writes.push(env.DB.prepare('INSERT OR REPLACE INTO site_health VALUES (?, ?, ?, ?, ?, ?)').bind(name, ok ? 1 : 0, fails, alerted, since, detail));
  }
  await env.DB.batch(writes);
  const to = env.DIGEST_TO || (String(env.GMAIL_FROM || '').match(/<([^>]+)>/) || [null, env.GMAIL_FROM])[1];
  if (send && to && (down.length || back.length)) {
    const lines = [...(down.length ? ['DOWN (failed two checks in a row):', ...down.map(x => '- ' + x)] : []), ...(back.length ? ['BACK UP:', ...back.map(x => '- ' + x)] : []),
      '', 'Checked every 15 minutes. You will get another email when anything changes.'];
    const subject = down.length ? `AASN alert: ${down.map(x => x.split(':')[0]).join(', ')} down` : `AASN: ${back.join(', ')} back up`;
    await send(to, subject, lines.join('\n'), '<pre style="font:14px monospace">' + lines.join('\n').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</pre>');
  }
  return { down: results.filter(r => !r[1]).map(r => r[0]), emailed: down.length + back.length };
}

// ---------- test hook (read-only for nightly/schedule/news; backup writes only to D1) ----------
export async function aablJobsTest(env, url) {
  const job = url.searchParams.get('job'), p = Number(url.searchParams.get('part') || 0);
  let r;
  if (job === 'nightly') r = await aablNightly(env, { part: p, date: url.searchParams.get('date') || yesterdayET(), dry: true });
  else if (job === 'schedule') r = await aablSchedule(env, { chunk: p, season: url.searchParams.get('season'), dry: true });
  else if (job === 'news') r = await aablNews(env, { batch: p, dry: true });
  else if (job === 'backup') r = await aablBackup(env, new Date());
  else r = { error: 'job?' };
  return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
}
