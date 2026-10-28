/* AAFL 2026 — league data for the website.
 * Teams, picks and late-joiner credits come from Supabase (public.aafl_* tables, see sql/015).
 * Game results come from ESPN (same source the sync job saves), and picks are graded the same way
 * as the aafl_week_scores view: 1 point per correct pick once a game is final.
 * The database decides what you can see: everyone's picks show only once that week has locked;
 * your own picks always show when you're signed in. */
window.AAFL = (function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  const WEEKS = 18;
  const SEASON = 2026;

  const state = e => (e.status && e.status.type ? e.status.type.state : 'pre');
  const sides = e => { const cs = e.competitions[0].competitors; return [cs.find(x => x.homeAway === 'away'), cs.find(x => x.homeAway === 'home')]; };
  function winner(e) { if (state(e) !== 'post') return null; const [a, h] = sides(e); return a.winner ? a.team.abbreviation : h.winner ? h.team.abbreviation : 'TIE'; }

  // ---------- Supabase (anon key; adds the signed-in player's token so RLS shows their own picks) ----------
  async function headers(write) {
    const h = { apikey: AASN_SUPABASE_KEY, Authorization: `Bearer ${AASN_SUPABASE_KEY}` };
    if (window.aasnAuth && aasnAuth.accessToken) { try { const t = await aasnAuth.accessToken(); if (t) h.Authorization = `Bearer ${t}`; } catch (e) { /* signed out */ } }
    if (write) h['Content-Type'] = 'application/json';
    return h;
  }
  async function db(path, opts = {}) {
    const res = await fetch(`${AASN_SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...(await headers(opts.method && opts.method !== 'GET')), ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { const j = await res.json(); m = j.message || m; } catch (e) { /* ignore */ } throw new Error(m); }
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }
  // Reads every row (PostgREST returns at most 1000 per request).
  async function dbAll(path) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await db(path, { headers: { Range: `${from}-${from + 999}` } });
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  // ---------- ESPN ----------
  const cache = {};
  async function fetchWeek(n) {
    const key = n || 'cur';
    if (cache[key]) return cache[key];
    const r = await fetch(n ? `${ESPN}?seasontype=2&week=${n}&dates=${SEASON}` : ESPN);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (n) cache[key] = j;
    return j;
  }
  async function currentWeek() {
    const cur = await fetchWeek();
    let wk = (cur.week && cur.week.number) || 1;
    if (cur.season && cur.season.type === 3) wk = WEEKS;
    cache[wk] = cur;
    return wk;
  }
  async function loadSeason(upTo) {
    const nums = Array.from({ length: upTo }, (_, i) => i + 1);
    const data = await Promise.all(nums.map(n => fetchWeek(n).catch(() => ({ events: [] }))));
    return nums.map((n, i) => ({ week: n, events: (data[i].events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date)), byes: (data[i].week && data[i].week.teamsOnBye) || [] }));
  }

  // ---------- League (teams, picks, credits) ----------
  let LEAGUE = null, CONFIG = { entry_fee: 0, pay_to: '' };
  async function loadLeague(force) {
    if (LEAGUE && !force) return LEAGUE;
    const [teams, picks, credits, cfg] = await Promise.all([
      db(`aafl_teams?select=id,name,is_bot,joined_week,user_id,paid&season=eq.${SEASON}&order=name`),
      dbAll('aafl_picks?select=team_id,game_id,pick'),
      db('aafl_credits?select=team_id,week,points'),
      db(`aafl_config?select=entry_fee,pay_to,max_entries&season=eq.${SEASON}`).catch(() => [])
    ]);
    CONFIG = cfg[0] || { entry_fee: 0, pay_to: '' };
    const fee = +CONFIG.entry_fee || 0;
    const byTeam = {};
    picks.forEach(p => { (byTeam[p.team_id] = byTeam[p.team_id] || {})[p.game_id] = p.pick; });
    const cred = {};
    credits.forEach(c => { (cred[c.team_id] = cred[c.team_id] || {})[c.week] = +c.points; });
    LEAGUE = {
      // unpaid: a human entry with an entry fee owing. Its picks don't count until it's marked paid.
      teams: teams.map(t => ({ id: t.id, name: t.name, human: !t.is_bot, joined: t.joined_week || 1, userId: t.user_id, paid: !!t.paid, unpaid: fee > 0 && !t.is_bot && !t.paid })),
      picks: byTeam, credits: cred
    };
    return LEAGUE;
  }
  // A team's pick for a game, or null if it has none (or it's still hidden).
  const pick = (team, e) => (LEAGUE && LEAGUE.picks[team.id] && LEAGUE.picks[team.id][e.id]) || null;

  // The signed-in player's team, or null.
  // The signed-in player's teams (a person can have several entries), oldest first.
  async function myTeams() {
    const s = window.aasnAuth && aasnAuth.session && aasnAuth.session();
    const uid = s && s.user && s.user.id;
    if (!uid) return [];
    return db(`aafl_teams?select=id,name,joined_week,email_reminders,invite_code,paid&season=eq.${SEASON}&user_id=eq.${uid}&order=created_at`);
  }
  async function myTeam() { return (await myTeams())[0] || null; }

  // Grade everything. Returns { teams:[...sorted], weeks:[{week, scores:{id:pts}, graded, winners:[ids], top}], lastDone }
  function standings(season) {
    const L = LEAGUE || { teams: [], picks: {}, credits: {} };
    const rows = L.teams.map(t => ({ ...t, pts: 0, graded: 0, weekWins: 0, byWeek: {} }));
    const weeks = season.map(w => {
      const fin = w.events.filter(e => state(e) === 'post');
      const scores = {};
      rows.forEach(r => {
        const credit = L.credits[r.id] && L.credits[r.id][w.week];
        let s, of;
        if (credit != null) { s = r.unpaid ? 0 : credit; of = fin.length; }   // league-average credit for a missed week
        else if (w.week < r.joined) { s = 0; of = 0; }
        else { s = r.unpaid ? 0 : fin.reduce((n, e) => n + (pick(r, e) === winner(e) ? 1 : 0), 0); of = fin.length; }
        scores[r.id] = s; r.byWeek[w.week] = { pts: s, of, games: w.events.length, credit: credit != null };
        r.pts += s; if (credit == null) r.graded += of;
      });
      const done = w.events.length > 0 && fin.length === w.events.length;
      const top = Math.max(0, ...rows.filter(r => !r.byWeek[w.week].credit).map(r => scores[r.id]));
      const winners = done && fin.length ? rows.filter(r => !r.byWeek[w.week].credit && scores[r.id] === top).map(r => r.id) : [];
      winners.forEach(id => rows.find(r => r.id === id).weekWins++);
      return { week: w.week, scores, graded: fin.length, games: w.events.length, done, top, winners };
    });
    const rank = list => { const s = list.slice().sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)); let place = 0, prev = null; s.forEach((r, i) => { if (r.pts !== prev) { place = i + 1; prev = r.pts; } r.rank = place; }); return s; };
    const lastDone = [...weeks].reverse().find(w => w.done);
    const before = rows.map(r => ({ id: r.id, name: r.name, pts: r.pts - (lastDone ? lastDone.scores[r.id] : 0) }));
    const prevRank = {}; rank(before).forEach(r => { prevRank[r.id] = r.rank; });
    const sorted = rank(rows);
    sorted.forEach(r => { r.move = lastDone ? prevRank[r.id] - r.rank : 0; r.pct = r.graded ? (r.pts - Object.values(L.credits[r.id] || {}).reduce((a, b) => a + b, 0)) / r.graded : 0; });
    return { teams: sorted, weeks, lastDone };
  }

  // ---------- Saving picks (signed-in member; the database rejects anything after lock) ----------
  async function savePicks(teamId, map) {
    const rows = Object.entries(map).map(([game_id, p]) => ({ team_id: teamId, game_id, pick: p }));
    if (!rows.length) return;
    await db('aafl_picks?on_conflict=team_id,game_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  }
  async function deletePicks(teamId, gameIds) {
    if (!gameIds.length) return;
    await db(`aafl_picks?team_id=eq.${teamId}&game_id=in.(${gameIds.map(encodeURIComponent).join(',')})`, { method: 'DELETE' });
  }
  async function join(code, name) {
    return db('rpc/aafl_join', { method: 'POST', body: JSON.stringify({ p_code: code, p_name: name }) });
  }

  return {
    WEEKS, SEASON, state, sides, winner, pick, fetchWeek, currentWeek, loadSeason, loadLeague, standings, myTeam, myTeams, savePicks, deletePicks, join, db,
    get TEAMS() { return LEAGUE ? LEAGUE.teams : []; },
    get CONFIG() { return CONFIG; }
  };
})();
