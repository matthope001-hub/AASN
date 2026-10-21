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
      aasnSelect('config', `select=season_moves&season=eq.${season}`, 'aabl'),
      aasnSelect('standings', `select=snapshot_date&season=eq.${season}&order=snapshot_date.desc&limit=1`, 'aabl'),
      aasnSelect('division_winners', 'select=season,division,team_abbr&order=season.desc', 'aabl')
    ]);
    const latestDiv = winners.length ? winners[0].season : null;
    const data = {
      season, teams, rows: [], snaps: [], latest: null,
      seasonMoves: cfg.length ? (num(cfg[0].season_moves) || 2) : 2,
      divWon: new Map(winners.filter(w => w.season === latestDiv).map(w => [w.division, w.team_abbr])),
      finalBonus: latestDiv === season,      // final only once this season's winners are set
      divPicks: new Map()
    };
    if (!dates.length) return data;

    data.latest = dates[0].snapshot_date;
    data.snaps = await aasnSelect('standings', `select=entry_id,snapshot_date,points,players_points,division_bonus,rank&season=eq.${season}&order=snapshot_date.asc`, 'aabl');
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

  const SORTS = { rank: r => r.rank, players: r => num(r.players_points), div: r => num(r.division_bonus), total: r => num(r.points) };

  function render(el, data, opts = {}) {
    const state = el._stSort || { key: 'rank', dir: 'asc' };
    el._stSort = state;
    const deltaLabel = opts.deltaLabel || '±PTS (24H)';
    if (!data.rows.length) { el.innerHTML = '<p class="st-empty">No standings yet. They start after Opening Day.</p>'; return; }

    const dir = state.dir === 'asc' ? 1 : -1;
    const f = SORTS[state.key];
    const rows = [...data.rows].sort((a, b) => (f(a) - f(b)) * dir || a.rank - b.rank);
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
        ${head('div', 'DIV' + (data.finalBonus ? '' : '*'), '', 'Division picks leading now, +25 each - click to sort')}
        ${head('total', data.finalBonus ? 'TOTAL' : 'PROJECTED*', 'num col-hide-sm', 'Players plus the division bonus - click to sort')}
        <th class="num col-hide-sm"><span>${esc(deltaLabel)}</span></th><th class="col-hide-sm"><span>MOVE</span></th>
        <th class="num" title="In-season trades used out of the season limit"><span>TRADES</span></th><th class="col-hide-sm"><span>PAYOUT</span></th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="${r.rank === 1 ? 'rank1' : ''}">${r.rank}</td>
        <td><button type="button" class="team-link" data-entry="${esc(r.entry_id)}" data-name="${esc(r.team_name)}" data-rank="${r.rank}" data-points="${r.points}">${esc(r.team_name)}</button></td>
        <td class="num pts">${fmt(r.players_points)}</td>
        <td>${div(r)}</td>
        <td class="num col-hide-sm" style="color:${data.finalBonus ? 'var(--red-text)' : 'var(--dim)'}">${fmt(r.points)}</td>
        <td class="num col-hide-sm">${delta(r)}</td>
        <td class="col-hide-sm">${move(r)}</td>
        <td class="num">${num(r.moves_used)}/${data.seasonMoves}</td>
        <td class="col-hide-sm" style="color:var(--dim)">TBD</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="st-foot">Trades = in-season trades used out of ${data.seasonMoves}.</p>
    ${data.finalBonus ? '' : '<p class="st-foot">* <span class="st-dot on"></span> = a division pick that is leading now. Projected = players + 25 for each leading pick. The bonus is paid once, at the end of the regular season.</p>'}`;

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

  window.aablStandings = { load, render };
})();
