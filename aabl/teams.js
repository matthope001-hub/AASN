/**
 * teams.js — AABL team popup (like AAHL's team picks modal).
 * Any element with data-entry="<entry_id>" opens that pool team's roster:
 * every box pick with stats/points, plus division picks.
 * Picks are only readable once the season's picks are locked (RLS).
 * Needs ../shared/config.js and cards.js (players open their card).
 */
(function () {
  const STATS_SEASON = 2026;
  const css = `
  .aabl-team-ov { position: fixed; inset: 0; background: rgba(4,12,24,.8); display: none; align-items: flex-start; justify-content: center; z-index: 150; padding: 24px 16px; overflow-y: auto; }
  .aabl-team-ov.on { display: flex; }
  .aabl-tm { width: 100%; max-width: 720px; background: #0C2340; border: 1px solid #25446E; border-top: 4px solid #BD3039; color: #E8EDF1; position: relative; font-family: 'Barlow Condensed', sans-serif; }
  .aabl-tm-x { position: absolute; top: 6px; right: 8px; width: 44px; height: 44px; background: none; border: 0; color: #A9B8CC; font-size: 30px; cursor: pointer; }
  .aabl-tm-head { padding: 18px 56px 14px 20px; border-bottom: 1px solid #25446E; }
  .aabl-tm-name { font-family: 'Bosox', serif; font-size: 30px; line-height: 1.05; }
  .aabl-tm-meta { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #A9B8CC; margin-top: 6px; }
  .aabl-tm-meta b { color: #F06A70; font-size: 15px; }
  .aabl-tm-sec { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .5px; color: #A9B8CC; padding: 14px 20px 6px; }
  .aabl-tm-row { display: grid; grid-template-columns: 40px 32px minmax(0,1fr) auto 56px; align-items: center; gap: 8px; padding: 6px 20px; border-top: 1px solid #1A3860; cursor: pointer; }
  .aabl-tm-row:hover, .aabl-tm-row:focus-visible { background: #132E52; outline: none; }
  .aabl-tm-row .bx { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #F06A70; }
  .aabl-tm-row img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #0A1E38; }
  .aabl-tm-row .nm { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .aabl-tm-row .nm small { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 400; color: #A9B8CC; }
  .aabl-tm-row .ln { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A9B8CC; text-align: right; white-space: nowrap; }
  .aabl-tm-row .pt { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700; text-align: right; }
  .aabl-tm-div { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; padding: 6px 20px 20px; }
  .aabl-tm-div div { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #132E52; border: 1px solid #25446E; padding: 8px 12px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
  .aabl-tm-div b { font-family: 'Barlow Condensed', sans-serif; font-size: 17px; }
  .aabl-tm-div .ok { color: #7EE2A8; } .aabl-tm-div .no { color: #A9B8CC; }
  .aabl-tm-msg { padding: 20px; font-family: 'JetBrains Mono', monospace; color: #A9B8CC; }
  @media (max-width: 560px) { .aabl-tm-row { grid-template-columns: 32px 28px minmax(0,1fr) 50px; } .aabl-tm-row .ln { display: none; } }
  [data-entry] { cursor: pointer; }`;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v) || 0;
  const fmt = v => { const x = num(v); return Number.isInteger(x) ? x.toLocaleString() : x.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
  const line = (role, s) => !s ? '' : role === 'pitcher'
    ? `${num(s.w)} W · ${num(s.qs)} QS · ${num(s.k)} K${num(s.sv) ? ` · ${num(s.sv)} SV` : ''}`
    : `${num(s.hr)} HR · ${num(s.rbi)} RBI · ${num(s.runs)} R · ${num(s.sb)} SB`;

  function overlay() {
    let ov = document.getElementById('aabl-team-ov');
    if (!ov) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      ov = document.createElement('div');
      ov.id = 'aabl-team-ov'; ov.className = 'aabl-team-ov';
      ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.aabl-tm-x')) close(); });
      document.body.appendChild(ov);
    }
    return ov;
  }

  let lastFocus = null;
  function close() {
    const ov = document.getElementById('aabl-team-ov');
    if (ov && ov.classList.contains('on')) { ov.classList.remove('on'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  }

  async function open(el) {
    const entryId = el.dataset.entry;
    const ov = overlay();
    lastFocus = document.activeElement;
    const head = `<button type="button" class="aabl-tm-x" aria-label="Close">×</button>
      <div class="aabl-tm-head"><div class="aabl-tm-name">${esc(el.dataset.name || 'Team')}</div>
      <div class="aabl-tm-meta">${el.dataset.rank ? `RANK ${esc(el.dataset.rank)} · ` : ''}<b>${el.dataset.points ? fmt(el.dataset.points) : '—'}</b> PTS</div></div>`;
    ov.innerHTML = `<div class="aabl-tm" role="dialog" aria-modal="true" aria-label="${esc(el.dataset.name || 'Team')}">${head}<div class="aabl-tm-msg">Loading roster…</div></div>`;
    ov.classList.add('on');
    ov.querySelector('.aabl-tm-x').focus();

    try {
      const [picks, divPicks, winners] = await Promise.all([
        aasnSelect('picks', `select=box_id,season,banked_points,option:box_options(mlb_id,role,box_id,player:players(full_name,team_abbr,position,headshot_url))&entry_id=eq.${encodeURIComponent(entryId)}&order=box_id`, 'aabl'),
        aasnSelect('division_picks', `select=division,team_abbr&entry_id=eq.${encodeURIComponent(entryId)}`, 'aabl'),
        aasnSelect('division_winners', 'select=season,division,team_abbr&order=season.desc', 'aabl')
      ]);
      if (!picks.length) {
        ov.querySelector('.aabl-tm-msg').textContent = 'Picks are hidden until the pick deadline.';
        return;
      }
      const season = picks[0].season;
      const ids = [...new Set(picks.map(p => p.option.mlb_id))];
      const [stats, boxes, lv, snap] = await Promise.all([
        aasnSelect('stats_season', `select=*&season=eq.${STATS_SEASON}&mlb_id=in.(${ids.join(',')})`, 'aabl'),
        aasnSelect('boxes', `select=box_id,name&season=eq.${season}`, 'aabl'),
        window.aablLive ? aablLive.get() : Promise.resolve(null),
        aasnSelect('standings', `select=snapshot_date&season=eq.${season}&order=snapshot_date.desc&limit=1`, 'aabl').catch(() => [])
      ]);
      const live = window.aablLive && aablLive.active(lv, snap[0] && snap[0].snapshot_date) ? lv : null;
      const tonightTag = o => {
        const p = live && live.players[o.mlb_id + '|' + o.role];
        if (!p) return '';
        return ` <span style="color:#5BD08A;font-family:'JetBrains Mono',monospace;font-size:11px;white-space:nowrap" title="Tonight's live points (estimate until the 4am update)">● ${p.pts > 0 ? '+' : ''}${(Math.round(p.pts * 10) / 10)}</span>`;
      };
      const sMap = new Map(stats.map(s => [s.mlb_id + '|' + s.role, s]));
      const bMap = new Map(boxes.map(b => [b.box_id, b]));
      const latest = winners.length ? winners[0].season : null;
      const won = new Map(winners.filter(w => w.season === latest).map(w => [w.division, w.team_abbr]));

      const rows = picks.map(pk => {
        const o = pk.option, s = sMap.get(o.mlb_id + '|' + o.role);
        const key = 't|' + entryId + '|' + pk.box_id;
        if (window.aablCards) aablCards.register(key, { player: o.player, stats: s || {}, role: o.role, box: bMap.get(pk.box_id), statsSeason: STATS_SEASON });
        return `<div class="aabl-tm-row" data-key="${esc(key)}" role="button" tabindex="0" aria-label="${esc(o.player.full_name)} player card">
          <span class="bx">BOX ${pk.box_id}</span>
          <img src="${esc(o.player.headshot_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="nm">${esc(o.player.full_name)}<small>${esc(o.player.team_abbr || '—')} · ${esc(o.player.position || '')}${o.role === 'pitcher' ? ' · P' : ''}${tonightTag(o)}</small></span>
          <span class="ln">${esc(line(o.role, s))}</span>
          <span class="pt">${fmt(s && s.points)}</span></div>`;
      }).join('');
      const DIVS = ['AL East', 'AL Central', 'AL West', 'NL East', 'NL Central', 'NL West'];
      const dp = new Map(divPicks.map(d => [d.division, d.team_abbr]));
      const divHtml = DIVS.map(d => {
        const t = dp.get(d), w = won.get(d);
        const mark = !t ? '' : (w === t ? '<span class="ok">✓ +25</span>' : (w ? '<span class="no">✗</span>' : ''));
        return `<div><span>${esc(d.toUpperCase())}</span><b>${esc(t || '—')}</b>${mark}</div>`;
      }).join('');

      ov.querySelector('.aabl-tm').innerHTML = head +
        `<div class="aabl-tm-sec">BOX PICKS · ${STATS_SEASON} STATS</div>${rows}` +
        `<div class="aabl-tm-sec">DIVISION PICKS · +25 PTS AT SEASON END</div><div class="aabl-tm-div">${divHtml}</div>`;
      ov.querySelector('.aabl-tm-x').focus();
    } catch (e) {
      console.error(e);
      const m = ov.querySelector('.aabl-tm-msg'); if (m) m.textContent = 'Roster unavailable right now.';
    }
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-entry]');
    if (el) { e.preventDefault(); open(el); }
  });
  // Capture phase: check before cards.js closes an open player card, so
  // Escape closes the player card first and the team popup on the next press.
  document.addEventListener('keydown', e => {
    const card = document.getElementById('aabl-card-ov');
    if (e.key === 'Escape' && !(card && card.classList.contains('on'))) close();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && e.target.dataset.entry) { e.preventDefault(); open(e.target); }
  }, true);

  window.aablTeams = { open, close };
})();
