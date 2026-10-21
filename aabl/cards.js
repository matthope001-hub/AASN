/**
 * cards.js — AABL player cards.
 *
 * Built the same way as AAHL's cards.js: one shared popup overlay, opened by
 * clicking any element with data-key (registered via aablCards.register),
 * team-colour tint, team logo watermark, headshot, pool points, stat strips,
 * and an expandable points breakdown. Tilts with VanillaTilt when loaded.
 *
 * Needs ../shared/config.js (aasnSelect) loaded first.
 */
(function () {
  // MLB team ids (logos) and card tint colours, brightened where the official
  // colour is too dark to show on a navy card.
  const TEAMS = {
    AZ: [109, '#E3D4AD'], ARI: [109, '#E3D4AD'], ATL: [144, '#CE1141'], BAL: [110, '#DF4601'], BOS: [111, '#BD3039'],
    CHC: [112, '#2E6BD9'], CWS: [145, '#C4CED4'], CIN: [113, '#C6011F'], CLE: [114, '#E31937'], COL: [115, '#8E7CC3'],
    DET: [116, '#FA4616'], HOU: [117, '#EB6E1F'], KC: [118, '#3A86D1'], LAA: [108, '#BA0021'], LAD: [119, '#2E73D6'],
    MIA: [146, '#00A3E0'], MIL: [158, '#FFC52F'], MIN: [142, '#D31145'], NYM: [121, '#FF5910'], NYY: [147, '#8FA6C9'],
    ATH: [133, '#2E8B57'], OAK: [133, '#2E8B57'], PHI: [143, '#E81828'], PIT: [134, '#FDB827'], SD: [135, '#FFC425'],
    SF: [137, '#FD5A1E'], SEA: [136, '#2EA3A3'], STL: [138, '#C41E3A'], TB: [139, '#8FBCE6'], TEX: [140, '#3A6FD1'],
    TOR: [141, '#3A8DDE'], WSH: [120, '#AB0003']
  };
  // MLB headshots come on a solid background (no cut-outs like the NHL's),
  // so cards.css softens the edges with a fade instead.
  const cutout = url => String(url || '');
  const logo = t => TEAMS[t] ? `https://www.mlbstatic.com/team-logos/${TEAMS[t][0]}.svg` : '';
  const tint = t => TEAMS[t] ? ` data-team="${t}" style="--tc:${TEAMS[t][1]}"` : '';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => Number(v) || 0;
  const fmt = v => { const x = num(v); return Number.isInteger(x) ? String(x) : x.toFixed(1); };
  const ip = outs => `${Math.floor(num(outs) / 3)}.${num(outs) % 3}`;
  const era = s => num(s.outs) ? (num(s.er) * 27 / num(s.outs)).toFixed(2) : '—';
  const whip = s => num(s.outs) ? ((num(s.bb_allowed) + num(s.h_allowed)) * 3 / num(s.outs)).toFixed(2) : '—';

  function splitName(name) {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length < 2) return [parts[0] || '', ''];
    // Keep suffixes with the last name: "Bobby Witt Jr." -> Bobby / Witt Jr.
    const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
    let cut = parts.length - 1;
    if (suffix.test(parts[cut]) && cut > 1) cut--;
    return [parts.slice(0, cut).join(' '), parts.slice(cut).join(' ')];
  }

  function strips(role, s) {
    if (role === 'pitcher') return [
      [['W', s.w], ['QS', s.qs], ['K', s.k], ['SV', s.sv], ['HLD', s.hld]],
      [['IP', ip(s.outs)], ['ERA', era(s)], ['WHIP', whip(s)], ['L', s.l], ['G', s.games]]
    ];
    const hits = num(s.singles) + num(s.doubles) + num(s.triples) + num(s.hr);
    return [
      [['HR', s.hr], ['RBI', s.rbi], ['R', s.runs], ['SB', s.sb], ['H', hits]],
      [['2B', s.doubles], ['3B', s.triples], ['BB', s.bb], ['SO', s.so], ['G', s.games]]
    ];
  }
  const strip = cells => `<div class="aabl-fc-strip" style="grid-template-columns:repeat(${cells.length},1fr)">
    ${cells.map(([l, v]) => `<div><b>${esc(typeof v === 'string' ? v : fmt(v))}</b><small>${l}</small></div>`).join('')}</div>`;

  // Points breakdown from the aabl.scoring table (never hardcoded).
  let scoringPromise = null;
  const scoring = () => scoringPromise || (scoringPromise =
    aasnSelect('scoring', 'select=player_type,stat,label,points', 'aabl').catch(() => []));

  function breakdown(rows, role, s) {
    const list = rows.filter(r => r.player_type === role)
      .map(r => ({ label: r.label, count: num(s[r.stat]), each: num(r.points) }))
      .filter(r => r.count);
    if (!list.length) return '';
    const total = list.reduce((t, r) => t + r.count * r.each, 0);
    return `<details class="aabl-fc-break"><summary>POINTS BREAKDOWN ▾</summary><table><tbody>
      ${list.map(r => { const pts = r.count * r.each; return `<tr><td>${esc(r.label)}</td><td>${fmt(r.count)} × ${fmt(r.each)}</td><td class="${pts < 0 ? 'neg' : ''}">${pts > 0 ? '+' : ''}${fmt(pts)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td><td></td><td>${fmt(total)}</td></tr></tfoot></table></details>`;
  }

  function overlay() {
    let ov = document.getElementById('aabl-card-ov');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'aabl-card-ov';
      ov.className = 'aabl-card-ov';
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      document.body.appendChild(ov);
    }
    return ov;
  }

  let lastFocus = null;
  async function open(o) {
    const p = o.player || {}, s = o.stats || {};
    const [first, last] = splitName(p.full_name);
    const team = p.team_abbr || '';
    const rows = await scoring();
    const ov = overlay();
    lastFocus = document.activeElement;
    ov.innerHTML = `
      <div class="aabl-fc" role="dialog" aria-modal="true" aria-label="${esc(p.full_name)}"${tint(team)}>
        ${team ? `<img class="aabl-fc-wm" src="${logo(team)}" alt="" onerror="this.remove()">` : ''}
        <button type="button" class="aabl-fc-x" aria-label="Close">×</button>
        <div class="aabl-fc-top">
          <div class="aabl-fc-info">
            <div class="aabl-fc-nm">${esc(first)}<br>${esc(last)}</div>
            <div class="aabl-fc-meta">${team ? `<img src="${logo(team)}" alt="" onerror="this.remove()">` : ''}${esc(team || 'FA')} · ${esc(p.position || '')}</div>
            ${o.box ? `<div class="aabl-fc-sub">BOX ${esc(o.box.box_id)} · ${esc(o.box.name)}</div>` : ''}
            ${o.isTwoWay ? `<div class="aabl-fc-role">${o.role === 'pitcher' ? 'PITCHING' : 'HITTING'} POINTS ONLY</div>` : ''}
          </div>
          <div class="aabl-fc-hs">${p.headshot_url ? `<img src="${esc(cutout(p.headshot_url))}" alt="" onerror="this.remove()">` : ''}</div>
        </div>
        <div class="aabl-fc-pool">
          <div><small>${esc(o.statsSeason || '')} AABL PTS</small><br><b>${fmt(s.points)}</b></div>
          ${o.rank ? `<div class="rk"><small>BOX RANK</small><br>${o.rank} of ${o.boxSize}</div>` : ''}
        </div>
        ${strips(o.role, s).map(strip).join('')}
        ${breakdown(rows, o.role, s)}
      </div>`;
    ov.querySelector('.aabl-fc-x').addEventListener('click', close);
    ov.classList.add('on');
    ov.querySelector('.aabl-fc-x').focus();
    tilt(ov.querySelector('.aabl-fc'));
  }

  function close() {
    const ov = document.getElementById('aabl-card-ov');
    if (ov && ov.classList.contains('on')) {
      ov.classList.remove('on');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
  }

  function tilt(el) {
    if (typeof VanillaTilt === 'undefined' || !el) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    VanillaTilt.init(el, { max: 8, speed: 500, scale: 1, glare: true, 'max-glare': 0.25, gyroscope: true,
      gyroscopeMinAngleX: -20, gyroscopeMaxAngleX: 20, gyroscopeMinAngleY: -20, gyroscopeMaxAngleY: 20 });
  }

  // Pages register card data by key; any [data-key] element opens it.
  const store = new Map();
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-key]');
    if (el && store.has(el.dataset.key)) open(store.get(el.dataset.key));
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset && store.has(e.target.dataset.key)) {
      e.preventDefault();
      open(store.get(e.target.dataset.key));
    }
  });

  window.aablCards = { open, close, cutout, register: (key, data) => store.set(key, data) };
})();
