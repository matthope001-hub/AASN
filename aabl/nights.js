/**
 * nights.js — shared "last night" data for the AABL Home and Last Night pages.
 * Reads per-game stats (aabl.stats_game, filled by the nightly pipeline) for
 * the players in the current boxes. Needs ../shared/config.js.
 */
(function () {
  const num = v => Number(v) || 0;
  const ip = outs => `${Math.floor(num(outs) / 3)}.${num(outs) % 3}`;

  let poolPromise = null;
  // Pool players for the current season: key "mlb_id|role" -> { option, player, box_id }
  function pool() {
    return poolPromise || (poolPromise = (async () => {
      const cfg = await aasnSelect('config', 'select=season&order=season.desc&limit=1', 'aabl');
      const season = cfg.length ? cfg[0].season : null;
      const opts = season ? await aasnSelect('box_options', `select=option_id,box_id,mlb_id,role,player:players(full_name,team_abbr,position,headshot_url)&season=eq.${season}`, 'aabl') : [];
      const map = new Map(opts.map(o => [o.mlb_id + '|' + o.role, o]));
      return { season, map, ids: [...new Set(opts.map(o => o.mlb_id))] };
    })());
  }

  // Most recent date with game stats (any season).
  async function latestDate() {
    const r = await aasnSelect('stats_game', 'select=game_date&order=game_date.desc&limit=1', 'aabl');
    return r.length ? r[0].game_date : null;
  }

  // Dates that have games, newest first (for prev/next navigation), within a year.
  async function datesAround(date) {
    const [before, after] = await Promise.all([
      aasnSelect('stats_game', `select=game_date&game_date=lt.${date}&order=game_date.desc&limit=1`, 'aabl'),
      aasnSelect('stats_game', `select=game_date&game_date=gt.${date}&order=game_date.asc&limit=1`, 'aabl')
    ]);
    return { prev: before.length ? before[0].game_date : null, next: after.length ? after[0].game_date : null };
  }

  // Pool players' game lines between two dates (inclusive), summed per player+role.
  async function lines(from, to) {
    const p = await pool();
    if (!p.ids.length) return [];
    const rows = [];
    // Chunk the id list to keep URLs short; page past the 1,000-row API limit.
    for (let i = 0; i < p.ids.length; i += 60) {
      const ids = p.ids.slice(i, i + 60).join(',');
      for (let off = 0; ; off += 1000) {
        const part = await aasnSelect('stats_game', `select=*&mlb_id=in.(${ids})&game_date=gte.${from}&game_date=lte.${to}&order=game_date&limit=1000&offset=${off}`, 'aabl');
        rows.push(...part);
        if (part.length < 1000) break;
      }
    }
    const sum = new Map();
    rows.forEach(r => {
      const key = r.mlb_id + '|' + r.role;
      const o = p.map.get(key);
      if (!o) return; // not in the boxes in that role
      const s = sum.get(key) || { key, role: r.role, mlb_id: r.mlb_id, option: o, player: o.player, games: 0, points: 0 };
      s.games++;
      for (const [k, v] of Object.entries(r)) if (typeof v === 'number' && !['mlb_id', 'game_pk'].includes(k)) s[k] = num(s[k]) + v;
      s.points = Math.round(num(s.points) * 10) / 10;
      sum.set(key, s);
    });
    return [...sum.values()].sort((a, b) => b.points - a.points);
  }

  function lineText(s) {
    if (s.role === 'pitcher') {
      const bits = [`${ip(s.outs)} IP`, `${num(s.k)} K`, `${num(s.er)} ER`];
      if (num(s.w)) bits.push(num(s.w) > 1 ? `${s.w} W` : 'W');
      if (num(s.l)) bits.push(num(s.l) > 1 ? `${s.l} L` : 'L');
      if (num(s.qs)) bits.push(num(s.qs) > 1 ? `${s.qs} QS` : 'QS');
      if (num(s.sv)) bits.push(num(s.sv) > 1 ? `${s.sv} SV` : 'SV');
      if (num(s.hld)) bits.push(num(s.hld) > 1 ? `${s.hld} HLD` : 'HLD');
      return bits.join(', ');
    }
    const hits = num(s.singles) + num(s.doubles) + num(s.triples) + num(s.hr);
    const bits = [`${hits} H`];
    if (num(s.hr)) bits.push(`${s.hr} HR`);
    if (num(s.triples)) bits.push(`${s.triples} 3B`);
    if (num(s.doubles)) bits.push(`${s.doubles} 2B`);
    if (num(s.rbi)) bits.push(`${s.rbi} RBI`);
    if (num(s.runs)) bits.push(`${s.runs} R`);
    if (num(s.sb)) bits.push(`${s.sb} SB`);
    if (num(s.bb) + num(s.hbp)) bits.push(`${num(s.bb) + num(s.hbp)} BB`);
    return bits.join(', ');
  }

  // Short "headline" for the performers ticker, or null if the line isn't notable.
  function highlight(s) {
    if (s.role === 'pitcher') {
      if (num(s.w) && num(s.k) >= 9) return `W · ${s.k} K`;
      if (num(s.outs) >= 27 && num(s.er) === 0) return 'SHUTOUT';
      if (num(s.qs) && num(s.k) >= 8) return `QS · ${s.k} K`;
      if (num(s.sv)) return 'SV';
      if (num(s.qs)) return 'QS';
      return null;
    }
    if (num(s.hr) >= 2) return `${s.hr} HR`;
    if (num(s.hr)) return num(s.rbi) >= 3 ? `HR · ${s.rbi} RBI` : 'HR';
    if (num(s.sb) >= 2) return `${s.sb} SB`;
    const hits = num(s.singles) + num(s.doubles) + num(s.triples);
    if (hits >= 3) return `${hits} H`;
    return null;
  }

  // How many pool teams own each player (only readable once picks lock).
  async function ownership() {
    try {
      const p = await pool();
      const picks = await aasnSelect('picks', `select=option_id&season=eq.${p.season}&limit=5000`, 'aabl');
      const byOpt = new Map();
      picks.forEach(r => byOpt.set(r.option_id, (byOpt.get(r.option_id) || 0) + 1));
      return byOpt;
    } catch (e) { return new Map(); }
  }

  const fmtDate = (d, opts) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...(opts || { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) });
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  window.aablNights = { pool, latestDate, datesAround, lines, lineText, highlight, ownership, fmtDate, addDays };
})();
