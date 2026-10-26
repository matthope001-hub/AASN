/* AAFL 2026 trial — mock league engine (front-end only).
 * 10 computer teams make fully random picks for every game. Picks are seeded by team + game,
 * so they never change between visits. Results come live from ESPN and are graded in the browser.
 * When the real Supabase tables arrive, only loadSeason()/picksFor() need to swap to the database. */
window.AAFL = (function () {
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  const WEEKS = 18;
  const TEAMS = [
    'Gridiron Goats', 'Blitz Llamas', 'Hail Mary Herd', 'Spit Happens', 'Fourth & Fluff',
    'Pack Animals', 'The Woolly Bullies', 'Llama Drama', 'Cria Kickers', 'Andes Avalanche'
  ].map((name, i) => ({ id: 'bot' + (i + 1), name, human: false }));

  const state = e => (e.status && e.status.type ? e.status.type.state : 'pre');
  const sides = e => { const cs = e.competitions[0].competitors; return [cs.find(x => x.homeAway === 'away'), cs.find(x => x.homeAway === 'home')]; };
  function winner(e) { if (state(e) !== 'post') return null; const [a, h] = sides(e); return a.winner ? a.team.abbreviation : h.winner ? h.team.abbreviation : 'TIE'; }

  // Seeded 0..1 random from a string.
  function rand(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }
  // A computer team's pick for a game: a coin flip.
  function pick(team, e) { const [a, h] = sides(e); return rand(team.id + ':' + e.id) < 0.5 ? a.team.abbreviation : h.team.abbreviation; }

  const cache = {};
  async function fetchWeek(n) {
    const key = n || 'cur';
    if (cache[key]) return cache[key];
    const r = await fetch(n ? `${ESPN}?seasontype=2&week=${n}&dates=2026` : ESPN);
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
  // Weeks 1..upTo, games sorted by kickoff.
  async function loadSeason(upTo) {
    const nums = Array.from({ length: upTo }, (_, i) => i + 1);
    const data = await Promise.all(nums.map(n => fetchWeek(n).catch(() => ({ events: [] }))));
    return nums.map((n, i) => ({ week: n, events: (data[i].events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date)), byes: (data[i].week && data[i].week.teamsOnBye) || [] }));
  }

  // Grade everything. Returns { teams:[...sorted], weeks:[{week, scores:{id:pts}, graded, winners:[ids], top}] }
  function standings(season) {
    const rows = TEAMS.map(t => ({ ...t, pts: 0, graded: 0, weekWins: 0, byWeek: {} }));
    const weeks = season.map(w => {
      const fin = w.events.filter(e => state(e) === 'post');
      const scores = {};
      rows.forEach(r => {
        const s = fin.reduce((n, e) => n + (pick(r, e) === winner(e) ? 1 : 0), 0);
        scores[r.id] = s; r.byWeek[w.week] = { pts: s, of: fin.length, games: w.events.length };
        r.pts += s; r.graded += fin.length;
      });
      const done = w.events.length > 0 && fin.length === w.events.length;
      const top = Math.max(0, ...Object.values(scores));
      const winners = done && fin.length ? rows.filter(r => scores[r.id] === top).map(r => r.id) : [];
      winners.forEach(id => rows.find(r => r.id === id).weekWins++);
      return { week: w.week, scores, graded: fin.length, games: w.events.length, done, top, winners };
    });
    // Rank (ties share a place), plus movement vs. the previous completed week.
    const rank = list => { const s = list.slice().sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name)); let place = 0, prev = null; s.forEach((r, i) => { if (r.pts !== prev) { place = i + 1; prev = r.pts; } r.rank = place; }); return s; };
    const lastDone = [...weeks].reverse().find(w => w.done);
    const before = rows.map(r => ({ id: r.id, name: r.name, pts: r.pts - (lastDone ? lastDone.scores[r.id] : 0) }));
    const prevRank = {}; rank(before).forEach(r => { prevRank[r.id] = r.rank; });
    const sorted = rank(rows);
    sorted.forEach(r => { r.move = lastDone ? prevRank[r.id] - r.rank : 0; r.pct = r.graded ? r.pts / r.graded : 0; });
    return { teams: sorted, weeks, lastDone };
  }

  return { WEEKS, TEAMS, state, sides, winner, pick, fetchWeek, currentWeek, loadSeason, standings };
})();
