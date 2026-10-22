/**
 * standings-table.js — AABL standings table, shared by Home and Standings
 * (same idea as AAHL's standingsTableHtml_). Columns: Rank, Team, Players,
 * Div (dots + bonus), Projected/Total, ±Pts, Move, Trades, Payout.
 *
 * aablStandings.load(season) -> data   (also used by the points race/compare)
 * aablStandings.render(el, data, { deltaLabel, maxHeight })
 * Needs ../shared/config.js; team names open teams.js popups.
 */
(function () {
  const DIVS = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v) || 0;
  const fmt = v => num(v).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  async function load(season) {
    const [teams, cfg, dates, winners] = await Promise.all([
      aasnSelect('teams', `select=entry_id,team_name,moves_used&season=eq.${season}`, 'aabl'),
      aasnSelect('config', `select=season_moves,entry_fee&season=eq.${season}`, 'aabl'),
      aasnSelect('standings', `select=snapshot_date&season=eq.${season}&order=snapshot_date.desc&limit=1`, 'aabl'),
      aasnSelect('division_winners', 'select=season,division,team_abbr&order=season.desc', 'aabl')
    ]);
    const latestDiv = winners.length ? winners[0].season : null;
    const data = {
      season, teams, rows: [], snaps: [], latest: null,
      seasonMoves: cfg.length ? (num(cfg[0].season_moves) || 2) : 2,
      pot: teams.length * (cfg.length && cfg[0].entry_fee != null ? num(cfg[0].entry_fee) : 10),
      divWon: new Map(winners.filter(w => w.season === latestDiv).map(w => [w.division, w.team_abbr])),
      finalBonus: latestDiv === season,      // final only once this season's winners are set
      divPicks: new Map()
    };
    if (!dates.length) return data;

    data.latest = dates[0].snapshot_date;
    if (window.aablLive) { const lv = await aablLive.get(); data.live = aablLive.active(lv, data.latest) && Object.keys(lv.entries || {}).length ? lv : null; }
    data.snaps = await aasnSelect('standings', `select=entry_id,snapshot_date,points,players_points,division_bonus,rank,tb_hr_rbi,tb_k&season=eq.${season}&order=snapshot_date.asc`, 'aabl');
    const allDates = [...new Set(data.snaps.map(s => s.snapshot_date))].sort();
    const prevDate = allDates.length > 1 ? allDates[allDates.length - 2] : null;
    const prev = new Map(data.snaps.filter(s => s.snapshot_date === prevDate).map(s => [s.entry_id, s]));
    const info = new Map(teams.map(t => [t.entry_id, t]));
    data.rows = data.snaps.filter(s => s.snapshot_date === data.latest).map(s => ({
      ...s,
      team_name: (info.get(s.entry_id) || {}).team_name || '—',
      moves_used: (info.get(s.entry_id) || {}).moves_used,
      prevRank: prev.has(s.entry_id) ? prev.get(s.entry_id).rank : null,
      prevPoints: prev.has(s.entry_id) ? num(prev.get(s.entry_id).points) : null
    }));
    try { // hidden by RLS until picks lock
      const dp = await aasnSelect('division_picks', `select=entry_id,division,team_abbr&entry_id=in.(${data.rows.map(r => '"' + r.entry_id + '"').join(',')})`, 'aabl');
      dp.forEach(d => { if (!data.divPicks.has(d.entry_id)) data.divPicks.set(d.entry_id, new Map()); data.divPicks.get(d.entry_id).set(d.division, d.team_abbr); });
    } catch (e) { /* ignore */ }
    return data;
  }

  // Same tiers as the AAHL, but the whole pot goes to the players (no 50/50 split).
  // Pot under $1,000: 1st 80%, 2nd 20%. Pot $1,000+: 1st 50%, 2nd 40%, 3rd 10%. Last place: free entry next season.
  function payout(rank, pot) {
    if (rank == null || rank > 3) return null;
    const split = pot < 1000 ? [0.80, 0.20] : [0.50, 0.40, 0.10];
    return split[rank - 1] != null ? pot * split[rank - 1] : null;
  }

  const SORTS = { tonight: r => num(r.tonight), rank: r => r.rank, players: r => num(r.players_points), div: r => num(r.division_bonus), total: r => num(r.points) };

  function render(el, data, opts = {}) {
    const lastRank = () => Math.max(...rowsForLast.map(r => r.rank || 0));
    let rowsForLast = data.rows;
    const payCell = r => {
      // Teams still tied after the tiebreakers split the prizes for the places they cover.
      const tied = rowsForLast.filter(x => x.rank === r.rank).length;
      let amt = null;
      for (let k = r.rank; k < r.rank + tied; k++) { const a = payout(k, data.pot); if (a != null) amt = (amt || 0) + a; }
      if (amt != null) amt = amt / tied;
      if (amt != null) return `<span style="color:#E5B53A;font-weight:700">$${amt.toFixed(2)}</span>`;
      if (data.rows.length > 1 && r.rank === lastRank()) return '<span style="color:var(--dim);font-size:12px">🎟️ Free entry</span>';
      return '<span style="color:var(--dim)">—</span>';
    };
    const state = el._stSort || { key: 'rank', dir: 'asc' };
    el._stSort = state;
    const deltaLabel = opts.deltaLabel || '±PTS (24H)';
    if (!data.rows.length) { el.innerHTML = '<p class="st-empty">No standings yet. They start after Opening Day.</p>'; return; }

    // Tonight: live points are added to the totals and teams re-ranked (an estimate until the 4am update).
    const L = data.live;
    let base = data.rows;
    if (L) {
      base = data.rows.map(r => {
        const t = (L.entries[r.entry_id] || {});
        return { ...r, tonight: num(t.pts), tonightN: t.n || 0, officialRank: r.rank, players_points: num(r.players_points) + num(t.pts), points: num(r.points) + num(t.pts) };
      });
      const ahead = (x, r) => x.points > r.points || (x.points === r.points && (num(x.tb_hr_rbi) > num(r.tb_hr_rbi) || (num(x.tb_hr_rbi) === num(r.tb_hr_rbi) && num(x.tb_k) > num(r.tb_k))));
      base.forEach(r => { r.rank = 1 + base.filter(x => ahead(x, r)).length; r.liveMove = r.officialRank - r.rank; });
    } else if (state.key === 'tonight') { state.key = 'rank'; state.dir = 'asc'; }
    const dir = state.dir === 'asc' ? 1 : -1;
    const f = SORTS[state.key];
    rowsForLast = base;
    const rows = [...base].sort((a, b) => (f(a) - f(b)) * dir || a.rank - b.rank);
    const head = (key, label, cls, title) => {
      const on = state.key === key;
      const arrow = on && key !== 'rank' ? (state.dir === 'desc' ? ' ▼' : ' ▲') : '';
      return `<th class="${cls || ''} ${on ? 'sorted' : ''}" title="${esc(title)}" aria-sort="${on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-st-sort="${key}">${label}${arrow}</button></th>`;
    };
    const move = r => {
      if (r.prevRank == null) return '<span class="flat">—</span>';
      const d = r.prevRank - r.rank;
      return d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : '<span class="flat">–</span>';
    };
    const delta = r => {
      if (r.prevPoints == null) return '<span class="flat">—</span>';
      const d = num(r.points) - r.prevPoints;
      return d > 0 ? `<span class="up">+${fmt(d)}</span>` : d < 0 ? `<span class="down">${fmt(d)}</span>` : '<span class="flat">0.0</span>';
    };
    const div = r => {
      const picks = data.divPicks.get(r.entry_id) || new Map();
      const dots = DIVS.map(d => {
        const on = picks.get(d) && data.divWon.get(d) === picks.get(d);
        return `<span class="st-dot${on ? ' on' : ''}" title="${esc(d)}: ${esc(picks.get(d) || '—')}${on ? ' (leading)' : ''}"></span>`;
      }).join('');
      const b = num(r.division_bonus);
      return `<span class="st-dots">${dots}</span><span class="st-bonus" style="color:${b ? 'var(--gold)' : 'var(--dim)'}">${b ? '+' + b : '—'}</span>`;
    };

    el.innerHTML = `<div class="st-wrap"${opts.maxHeight ? ` style="max-height:${opts.maxHeight}px; overflow-y:auto"` : ''}><table>
      <thead><tr>
        ${head('rank', 'RANK', '', 'Back to the normal ranking')}<th><span>TEAM</span></th>
        ${head('players', 'PLAYERS', 'num', 'Points earned by players - click to sort')}
        ${L ? head('tonight', '<span class="st-live">●</span> TONIGHT', 'num', "Live points from tonight's games, already included in the totals (estimate until the 4am update) - click to sort") : ''}
        ${head('div', 'DIV' + (data.finalBonus ? '' : '*'), '', 'Division picks leading now, +25 each - click to sort')}
        ${head('total', data.finalBonus ? 'TOTAL' : 'PROJECTED*', 'num col-hide-sm', 'Players plus the division bonus - click to sort')}
        <th class="num col-hide-sm"><span>${esc(deltaLabel)}</span></th><th class="col-hide-sm"><span>MOVE</span></th>
        <th class="num" title="In-season trades used out of the season limit"><span>TRADES</span></th><th class="col-hide-sm"><span>PAYOUT</span></th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="${r.rank === 1 ? 'rank1' : ''}">${r.rank}${L && r.liveMove ? ` <span class="${r.liveMove > 0 ? 'up' : 'down'}" style="font-size:10px" title="${r.liveMove > 0 ? 'Up' : 'Down'} ${Math.abs(r.liveMove)} tonight">${r.liveMove > 0 ? '▲' : '▼'}${Math.abs(r.liveMove)}</span>` : ''}</td>
        <td><button type="button" class="team-link" data-entry="${esc(r.entry_id)}" data-name="${esc(r.team_name)}" data-rank="${r.rank}" data-points="${r.points}">${esc(r.team_name)}</button></td>
        <td class="num pts">${fmt(r.players_points)}</td>
        ${L ? `<td class="num" style="color:${r.tonight ? '#5BD08A' : 'var(--dim)'}">${r.tonight ? '+' + fmt(r.tonight) : '—'}${r.tonightN ? ` <span style="color:var(--dim);font-size:11px">(${r.tonightN})</span>` : ''}</td>` : ''}
        <td>${div(r)}</td>
        <td class="num col-hide-sm" style="color:${data.finalBonus ? 'var(--red-text)' : 'var(--dim)'}">${fmt(r.points)}</td>
        <td class="num col-hide-sm">${delta(r)}</td>
        <td class="col-hide-sm">${move(r)}</td>
        <td class="num">${num(r.moves_used)}/${data.seasonMoves}</td>
        <td class="col-hide-sm">${payCell(r)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="st-foot">Trades = in-season trades used out of ${data.seasonMoves}.</p>
    ${L ? `<p class="st-foot"><span class="st-live">●</span> Tonight = live points from tonight's games so far (players who've played in brackets). While games are on, Rank, Points and Payout include tonight's points and update every minute or two (▲/▼ = spots gained or lost tonight). An estimate; the official points come in the 4am update.</p>` : ''}
    ${data.finalBonus ? '' : '<p class="st-foot">* <span class="st-dot on"></span> = a division pick that is leading now. Projected = players + 25 for each leading pick. The bonus is paid once, at the end of the regular season.</p>'}`;

    if (!el._stLiveTimer && window.aablLive && data.latest) {
      el._stLiveTimer = setInterval(async () => {
        if (document.hidden) return;
        const lv = await aablLive.get();
        const next = aablLive.active(lv, data.latest) && Object.keys(lv.entries || {}).length ? lv : null;
        if ((next && next.updated_at) !== (data.live && data.live.updated_at)) { data.live = next; render(el, data, opts); }
      }, 60000);
    }

    if (!el._stWired) {
      el._stWired = true;
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-st-sort]');
        if (!b) return;
        const k = b.dataset.stSort, s = el._stSort;
        el._stSort = k === 'rank' ? { key: 'rank', dir: 'asc' } : (s.key === k ? { key: k, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: k, dir: 'desc' });
        render(el, data, opts);
      });
    }
  }

  window.aablStandings = { load, render, payout };
})();
