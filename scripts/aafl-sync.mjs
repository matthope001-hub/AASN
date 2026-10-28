// AAFL sync — NFL games from ESPN into Supabase, plus the computer teams' picks.
// Runs in GitHub Actions (.github/workflows/aafl-sync.yml) every 15 minutes.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SEASON (default 2026)
//
// 1. Games: weeks 1..(current week + 1) from ESPN -> public.aafl_games
//    (schedule, scores, live status, winner, odds). Grading is automatic: the
//    aafl_week_scores view counts a pick as correct once its game is final.
// 2. Computer teams: once a week's pick window opens (previous week has kicked off),
//    each bot gets a random pick for every game that week that it hasn't picked yet.
//    Existing picks are never changed. The random pick is seeded by bot + game, the
//    same formula the website used for the demo, so the standings stay the same.

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SEASON = Number(process.env.SEASON || 2026);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

// ---------- Supabase ----------
function sbHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}
async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: sbHeaders(opts.headers || {}) });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function upsert(table, rows, onConflict, resolution = 'merge-duplicates') {
  for (let i = 0; i < rows.length; i += 500) {
    await sb(`${table}?on_conflict=${onConflict}`, { method: 'POST', headers: { Prefer: `resolution=${resolution},return=minimal` }, body: JSON.stringify(rows.slice(i, i + 500)) });
  }
}

// ---------- ESPN ----------
async function espn(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}
const weekUrl = n => `${ESPN}?seasontype=2&week=${n}&dates=${SEASON}`;

function gameRow(e, week) {
  const c = e.competitions[0];
  const away = c.competitors.find(x => x.homeAway === 'away');
  const home = c.competitors.find(x => x.homeAway === 'home');
  const state = (e.status && e.status.type && e.status.type.state) || 'pre';
  const odds = (c.odds || [])[0] || {};
  const num = v => (v === undefined || v === null || v === '' || isNaN(+v) ? null : Math.round(+v));
  let winner = null;
  if (state === 'post') winner = away.winner ? away.team.abbreviation : home.winner ? home.team.abbreviation : 'TIE';
  return {
    id: String(e.id), season: SEASON, week,
    kickoff: e.date,
    away: away.team.abbreviation, home: home.team.abbreviation,
    away_name: away.team.displayName || null, home_name: home.team.displayName || null,
    away_score: state === 'pre' ? null : num(away.score), home_score: state === 'pre' ? null : num(home.score),
    state, status_detail: (e.status && e.status.type && e.status.type.shortDetail) || null,
    winner,
    spread: odds.details || null,
    over_under: typeof odds.overUnder === 'number' ? odds.overUnder : null,
    away_ml: num(odds.awayTeamOdds && odds.awayTeamOdds.moneyLine),
    home_ml: num(odds.homeTeamOdds && odds.homeTeamOdds.moneyLine),
    updated_at: new Date().toISOString()
  };
}

// Same seeded coin flip as aafl/league.js (FNV-1a + mix), so picks match the demo.
function rand(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}

async function main() {
  // Current week from ESPN's default scoreboard.
  const cur = await espn(ESPN);
  let current = (cur.week && cur.week.number) || 1;
  if (cur.season && cur.season.type === 3) current = 18;          // playoffs: regular season is over
  if (cur.season && cur.season.type === 1) current = 1;           // preseason
  const last = Math.min(18, current + 1);

  // 1. Games
  const weeks = {};
  for (let w = 1; w <= last; w++) {
    const data = await espn(weekUrl(w));
    weeks[w] = (data.events || []).map(e => gameRow(e, w));
  }
  const all = Object.values(weeks).flat();
  await upsert('aafl_games', all, 'id');
  console.log(`Games: ${all.length} saved (weeks 1-${last}), current week ${current}.`);

  // 2. Computer team picks for every week whose pick window is open.
  //    Week N opens as soon as week N-1 locks at its first kickoff (week 1 is always open).
  const bots = await sb(`aafl_teams?select=id,bot_key&season=eq.${SEASON}&is_bot=eq.true`);
  const openWeeks = [];
  for (let w = 1; w <= last; w++) {
    // Week N opens as soon as week N-1 locks (its first kickoff), so players get the whole week to pick.
    const prev = weeks[w - 1] || [];
    const prevLocked = w === 1 || (prev.length > 0 && Date.now() >= Math.min(...prev.map(g => +new Date(g.kickoff))));
    if (prevLocked && (weeks[w] || []).length) openWeeks.push(w);
  }
  const games = openWeeks.flatMap(w => weeks[w]);
  if (!games.length || !bots.length) { console.log('No open weeks or no bots.'); return; }
  const rows = [];
  for (const b of bots) for (const g of games) {
    rows.push({ team_id: b.id, game_id: g.id, pick: rand(b.bot_key + ':' + g.id) < 0.5 ? g.away : g.home });
  }
  // ignore-duplicates: a pick that already exists is never changed.
  await upsert('aafl_picks', rows, 'team_id,game_id', 'ignore-duplicates');
  console.log(`Bot picks: ensured ${rows.length} (${bots.length} bots x ${games.length} games, weeks ${openWeeks[0]}-${openWeeks[openWeeks.length - 1]}).`);
}

main().catch(e => { console.error(e); process.exit(1); });
