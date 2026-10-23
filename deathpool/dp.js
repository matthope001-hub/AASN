/* Death Pool 2026 on AASN — reads the pool sheet (via the AASN API) and renders
 * every page client-side. Hash routes: #home #standings #graveyard #deathrow
 * #birthdays #boxes #rules. Refreshes every 10 minutes while open. */
(function () {
  const VIEWS = ['home', 'standings', 'graveyard', 'deathrow', 'birthdays', 'boxes', 'rules', 'mine', 'whatsnew'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = v => v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let D = null, deadMap = new Map(), picksCount = new Map(), cemByName = new Map(), celebMap = new Map(), owners = new Map();

  const parseDate = s => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (!m) return null; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return new Date(y, m[1] - 1, +m[2]); };
  const niceDate = s => { const d = parseDate(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : esc(s || '—'); };
  const today = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); };

  // ---------- routing
  function route() {
    const v = (location.hash || '#home').slice(1);
    const view = VIEWS.includes(v) ? v : 'home';
    if (!D) return;
    VIEWS.forEach(x => { $('v-' + x).hidden = x !== view; });
    if (view === 'standings') renderRace();   // size the chart to the now-visible panel
    document.querySelectorAll('.tabs a').forEach(a => { if (a.getAttribute('href') === '#' + view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const more = $('more');
    if (more) { more.open = false; more.classList.toggle('on', !!more.querySelector('a[aria-current]')); }
    if (a11yFirst) a11yFirst = false; else window.scrollTo(0, 0);
  }
  let a11yFirst = true;
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', () => { if (a.getAttribute('href') === location.hash) route(); }));
  document.addEventListener('click', e => { const m = $('more'); if (m && m.open && !m.contains(e.target)) m.open = false; });

  // ---------- headshots
  // Photos come from Wikipedia's free page-summary API, looked up by the celeb's
  // Wikipedia link (or name). Kept in this browser for a week; misses show initials.
  const FACE_KEY = 'aasn-dp-faces-v2', FACE_TTL = 7 * 864e5;
  let faceCache = {};
  try { faceCache = JSON.parse(localStorage.getItem(FACE_KEY) || '{}'); } catch (e) { faceCache = {}; }
  const facePending = new Map();
  const initials = n => String(n || '').replace(/\(.*?\)/g, '').replace(/[^A-Za-z .'-]/g, '').split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(Rep|Sen|Dr|Mr|Mrs|Ms|Sir|Jr|Sr)\.?$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const face = (name, size) => `<span class="face${size ? ' ' + size : ''}${deadMap.has(key(name)) ? ' dead' : ''}" data-face="${esc(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
  function wikiTitle(name) {
    const c = celebMap.get(key(name));
    const m = c && c.wiki && String(c.wiki).match(/wikipedia\.org\/wiki\/([^?#]+)/);
    return m ? decodeURIComponent(m[1]) : String(name).replace(/^(Rep|Sen|Dr)\.?\s+/i, '').trim().replace(/ /g, '_');
  }
  function faceUrl(name) {
    const k = key(name), hit = faceCache[k];
    if (hit && Date.now() - hit.t < FACE_TTL) return Promise.resolve(hit.u);
    if (facePending.has(k)) return facePending.get(k);
    // Wikipedia's Action API (CORS via origin=*): follows redirects, skips disambiguation pages.
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1'
      + '&prop=pageimages%7Cpageprops&piprop=thumbnail&pithumbsize=240&ppprop=disambiguation&titles=' + encodeURIComponent(wikiTitle(name));
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => { const pg = j && j.query && j.query.pages && j.query.pages[0]; return (pg && !pg.missing && !(pg.pageprops && 'disambiguation' in pg.pageprops) && pg.thumbnail && pg.thumbnail.source) || ''; })
      .catch(() => null)
      .then(u => {
        facePending.delete(k);
        if (u === null) return '';   // network error: try again next time
        faceCache[k] = { u, t: Date.now() };
        try { localStorage.setItem(FACE_KEY, JSON.stringify(faceCache)); } catch (e) { /* ignore */ }
        return u;
      });
    facePending.set(k, p);
    return p;
  }
  function hydrateFaces(root) {
    (root || document).querySelectorAll('[data-face]:not([data-face-done])').forEach(el => {
      el.setAttribute('data-face-done', '');
      faceUrl(el.dataset.face).then(u => {
        if (!u) return;
        // Attached straight away (a detached lazy image never loads); shown once it arrives.
        const img = document.createElement('img');
        img.alt = ''; img.decoding = 'async'; img.style.opacity = '0';
        img.onload = () => { img.style.opacity = '1'; };
        img.onerror = () => img.remove();
        img.src = u;
        el.appendChild(img);
      });
    });
  }

  // ---------- cemetery dialog
  const dlg = $('dlg');
  $('dlg-x').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cem]');
    if (!b) return;
    openCemetery(b.dataset.cem);
  });
  function openCemetery(name) {
    const c = cemByName.get(key(name));
    const st = D.standings.find(s => key(s.name) === key(name));
    $('dlg-title').innerHTML = logo(name, 40) + esc(name);
    $('dlg-sub').textContent = (st ? `RANK ${st.rank} · ${fmt(st.points)} PTS` : '') + (c ? ` · ${c.picks.filter(p => deadMap.has(key(p.celeb))).length} OF ${c.picks.length} PICKS DEAD` : '');
    $('dlg-body').innerHTML = c ? c.picks.map(p => {
      const dead = deadMap.get(key(p.celeb));
      return `<tr><td class="small">${esc(p.category)}</td><td>${celebBtn(p.celeb)}${dead ? `<span class="dead-mark">☠ ${esc(niceDate(dead.died))}</span>` : ''}</td><td class="num">${p.points ? fmt(p.points) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="small">Picks not available for this cemetery.</td></tr>';
    if (cdlg.open) cdlg.close();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------- celeb card
  const cdlg = $('cdlg');
  $('cdlg-x').addEventListener('click', () => cdlg.close());
  cdlg.addEventListener('click', e => { if (e.target === cdlg) cdlg.close(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-celeb]');
    if (b) openCeleb(b.dataset.celeb);
  });
  function openCeleb(name) {
    const c = celebMap.get(key(name)) || { name };
    const g = deadMap.get(key(name));
    const own = owners.get(key(name)) || [];
    const died = (g && g.died) || c.died;
    $('cdlg-title').textContent = c.name || name;
    $('cdlg-sub').textContent = [c.category, died ? '☠ DIED ' + niceDate(died) : '● STILL BREATHING'].filter(Boolean).join(' · ');
    const stat = (l, v) => `<div><span>${l}</span><b>${v}</b></div>`;
    const stats = [
      stat(died ? 'AGE AT DEATH' : 'AGE', died ? esc(c.ageAtDeath || '—') : (c.age != null ? c.age : '—')),
      stat('BORN', c.born ? esc(niceDate(c.born)) : '—'),
      stat('POINT VALUE', fmt(c.value)),
      stat('TIMES PICKED', own.length || c.picked || 0)
    ];
    if (g) stats.push(stat('SCORED', fmt(g.points)));
    $('cdlg-body').innerHTML = `<div class="celeb-hd">${face(c.name || name, 'xl')}<div class="small">${esc(c.category || '')}</div></div><div class="cstats">${stats.join('')}</div>
      ${g && g.bonuses.length ? `<p class="small" style="margin-bottom:10px">Bonuses: ${tags(g.bonuses)}</p>` : ''}
      <div class="sec-title" style="font-size:16px">PICKED BY</div>
      <div class="owners">${own.length ? own.map(o => `<span class="chip">${cemBtn(o.cem)} <span class="small">· ${esc(o.category)}</span></span>`).join('') : '<span class="small">Nobody picked them.</span>'}</div>
      ${c.wiki ? `<p style="margin-top:14px"><a href="${esc(c.wiki)}" target="_blank" rel="noopener">More on Wikipedia →</a></p>` : ''}`;
    if (dlg.open) dlg.close();
    if (typeof cdlg.showModal === 'function') cdlg.showModal(); else cdlg.setAttribute('open', '');
    hydrateFaces($('cdlg-body'));
  }
  const celebBtn = name => `<button type="button" class="linkbtn celeb" data-celeb="${esc(name)}">${esc(name)}</button>`;

  // ---------- renderers
  const bonusText = code => { const b = (D.bonuses || []).find(x => x.code === code); return b ? b.text : code; };
  const tags = list => list.map(code => `<span class="btag${code === 'B16' ? ' neg' : ''}" title="${esc(bonusText(code))}">${esc(code)}</span>`).join('') || '<span class="small">—</span>';
  const logo = (name, px) => window.aasnLogos ? aasnLogos.badge('dp', name, name, px) : '';
  const cemBtn = name => `<button type="button" class="linkbtn" data-cem="${esc(name)}">${logo(name, 20)}${esc(name)}</button>`;
  const leaderPts = () => (D.standings[0] && D.standings[0].points) || 0;
  const sortedStandings = () => [...D.standings].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));

  function renderHome() {
    const s = sortedStandings(), lead = leaderPts();
    const byDeath = [...D.graveyard].sort((a, b) => (parseDate(b.died) || 0) - (parseDate(a.died) || 0));
    const lastDay = byDeath[0] && parseDate(byDeath[0].died);
    $('k-grave').textContent = D.graveyard.length;
    $('k-quiet').textContent = lastDay ? Math.max(0, Math.round((today() - lastDay) / 864e5)) : '—';
    $('k-row').textContent = D.deathRow.filter(x => !x.died).length;
    $('k-cem').textContent = s.length;
    $('h-count').textContent = s.length;

    const row = (r, cls) => `<div class="st-row ${cls || ''}"><span class="rk">${r.rank ?? ''}</span>${cemBtn(r.name)}<span class="num">${fmt(r.points)}</span><span class="hide-sm"><span class="bar" style="display:block"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></span></span></div>`;
    $('h-top').innerHTML = s.slice(0, 10).map(r => row(r, r.rank === 1 ? 'top1' : '')).join('');
    // Signed in: your cemeteries outside the top 10 are pinned underneath.
    const mine = (me && me.success && me.cemeteries) || [];
    $('h-mine').innerHTML = mine.map(n => s.find(r => key(r.name) === key(n))).filter(r => r && s.indexOf(r) >= 10).map(r => row(r, 'mine')).join('');

    // Everyone who died on the most recent death day gets a card (up to 2); the next few are listed.
    const feature = lastDay ? byDeath.filter(g => +parseDate(g.died) === +lastDay).slice(0, 2) : [];
    $('h-arr-date').textContent = lastDay ? lastDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase() : '';
    $('h-feature').className = 'arr-cards' + (feature.length === 1 ? ' one' : '');
    $('h-feature').innerHTML = feature.map(g => `<button type="button" class="arr-card" data-celeb="${esc(g.name)}">${face(g.name, 'lg')}<span class="nm">${esc(g.name)}</span><span style="display:flex;gap:6px;align-items:center"><span class="pt">+${fmt(g.points)}</span>${g.bonuses.length ? tags(g.bonuses) : ''}</span></button>`).join('');
    $('h-latest').innerHTML = byDeath.slice(feature.length, feature.length + 4).map(g => `<div class="mini">${face(g.name)}<div>${celebBtn(g.name)}<div class="sub">${esc(niceDate(g.died)).toUpperCase()}</div></div><span class="val">${fmt(g.points)}</span></div>`).join('') || (feature.length ? '' : '<p class="small">Nobody yet.</p>');

    const up = upcomingBirthdays(14).slice(0, 5);
    $('h-bdays').innerHTML = up.map(b => `<div class="mini">${face(b.name)}<div>${celebBtn(b.name)}<div class="sub">TURNS ${b.turning}</div></div><span class="val${b.days === 0 ? ' g' : ' small'}">${b.days === 0 ? '🎂 TODAY' : 'IN ' + b.days + 'D'}</span></div>`).join('') || '<p class="small" style="padding-top:6px">No birthdays in the next two weeks.</p>';
    hydrateFaces($('v-home'));
  }

  // Season history rebuilt from the deaths themselves: each cemetery's points step up
  // (or down, for Mummy's Curse) on the day each of its picks died, from Jan 1.
  function seasonTimeline() {
    const dayOf = name => { const g = deadMap.get(key(name)); const c = celebMap.get(key(name)); return parseDate((g && g.died) || (c && c.died)); };
    const events = [];   // { t, cem, pts, celeb }
    D.cemeteries.forEach(c => c.picks.forEach(p => {
      if (!p.points) return;
      const d = dayOf(p.celeb);
      events.push({ t: d ? d.getTime() : Date.now(), cem: c.name, pts: p.points, celeb: p.celeb });
    }));
    events.sort((a, b) => a.t - b.t);
    const days = [...new Set(events.map(e => e.t))];
    return { events, days };
  }
  // Points for every cemetery as of the end of a given day (ms timestamp).
  function pointsAt(tl, t) {
    const m = new Map(D.cemeteries.map(c => [c.name, 0]));
    tl.events.forEach(e => { if (e.t <= t) m.set(e.cem, (m.get(e.cem) || 0) + e.pts); });
    return m;
  }
  const ranksOf = m => { const arr = [...m.entries()]; return new Map(arr.map(([n, v]) => [key(n), 1 + arr.filter(x => x[1] > v).length])); };

  // Movement since the most recent death: standings the day before it vs now.
  function deathMove() {
    const tl = seasonTimeline();
    const last = tl.days[tl.days.length - 1];
    if (last == null || tl.days.length < 2) return null;
    const before = ranksOf(pointsAt(tl, last - 1));
    const now = ranksOf(pointsAt(tl, last));
    const map = new Map([...now.keys()].map(k => [k, before.has(k) ? before.get(k) - now.get(k) : null]));
    const who = tl.events.filter(e => e.t === last).map(e => e.celeb);
    return { map, death: { name: [...new Set(who)].join(' & '), t: last } };
  }
  let DM = null;
  const moveHtml = d => d == null ? '<span class="mv flat">—</span>' : d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : '<span class="mv flat">–</span>';
  const move = r => moveHtml(DM ? DM.map.get(key(r.name)) : null);
  function renderStandings() {
    const q = key($('s-search').value);
    const lead = leaderPts();
    DM = deathMove();
    document.querySelectorAll('.dm-col').forEach(x => { x.hidden = !DM; });
    if (DM) $('s-prev').textContent = `${DM.death.name} (${new Date(DM.death.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})`;
    $('s-body').innerHTML = sortedStandings().filter(r => !q || key(r.name).includes(q)).map(r => {
      const c = cemByName.get(key(r.name));
      const dead = c ? c.picks.filter(p => deadMap.has(key(p.celeb))).length : null;
      return `<tr class="${r.rank === 1 ? 'top1' : ''}"><td class="rk">${r.rank ?? ''}</td><td>${cemBtn(r.name)}</td><td class="num">${fmt(r.points)}</td>${DM ? `<td class="hide-sm">${move(r)}</td>` : ''}<td class="num hide-sm">${dead ?? '—'}</td><td class="hide-sm"><div class="bar"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></div></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="small">No match.</td></tr>';
    renderRace();
  }

  // Points race (Jan 1 -> today), built for reading:
  //  - tap a cemetery chip (or a line) to spotlight it; the rest fade to grey
  //  - hover / drag across the chart to see the standings on any death day, and who died
  //  - names sit at the end of each line instead of a separate legend
  let raceFocus = null;                 // cemetery key, or null = all in colour
  const RACE_COLORS = ['#8BE37A', '#00D4FF', '#FFB800', '#F06A70', '#B79CFF', '#FF9F43', '#4FD1C5', '#E8ECF0'];
  function renderRace() {
    const el = $('race');
    const tl = seasonTimeline();
    if (!tl.events.length) { el.innerHTML = '<p class="small">The race starts with the first death.</p>'; return; }
    if (raceFocus == null && me && me.cemeteries && me.cemeteries.length) raceFocus = key(me.cemeteries[0]);
    const top = sortedStandings().slice(0, 8).map(s => s.name);
    const year = new Date(tl.days[0]).getFullYear();
    const t0 = new Date(year, 0, 1).getTime(), t1 = Math.max(Date.now(), tl.days[tl.days.length - 1]);
    const series = top.map((name, k) => {
      let v = 0; const pts = [[t0, 0]];
      tl.events.filter(e => e.cem === name).forEach(e => { pts.push([e.t, v]); v += e.pts; pts.push([e.t, v]); });
      pts.push([t1, v]);
      return { name, k: key(name), color: RACE_COLORS[k], pts, end: v };
    });
    const W = Math.max(320, el.clientWidth || 800), narrow = W < 640;
    const H = narrow ? 240 : 300, P = { l: 38, r: narrow ? 10 : 170, t: 12, b: 26 };
    const max = Math.max(1, ...series.map(s => Math.max(...s.pts.map(p => p[1])))), min = Math.min(0, ...series.map(s => Math.min(...s.pts.map(p => p[1]))));
    const x = t => P.l + (W - P.l - P.r) * (t - t0) / (t1 - t0);
    const y = v => P.t + (H - P.t - P.b) * (1 - (v - min) / (max - min || 1));
    const focus = raceFocus && series.some(s => s.k === raceFocus) ? raceFocus : null;
    const dim = s => focus && s.k !== focus;
    // grid + axes
    const grid = [0, .25, .5, .75, 1].map(f => { const v = min + (max - min) * f; return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#1A1F26"/><text x="${P.l - 6}" y="${y(v) + 4}" fill="#6B7580" font-size="10" text-anchor="end" font-family="JetBrains Mono">${Math.round(v)}</text>`; }).join('');
    const months = []; for (let m = 0; m < 12; m++) { const t = new Date(year, m, 1).getTime(); if (t <= t1) months.push(t); }
    const xl = months.map(t => `<text x="${x(t) + 3}" y="${H - 8}" fill="#6B7580" font-size="10" font-family="JetBrains Mono">${new Date(t).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</text>`).join('');
    const ticks = tl.days.map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="${H - P.b}" y2="${H - P.b + 5}" stroke="#FF5C5C" stroke-width="1.5"/>`).join('');
    // lines: faded ones first, spotlight last so it sits on top
    const order = [...series].sort((a, b) => (dim(b) - dim(a)));
    const lines = order.map(s => `<polyline data-k="${esc(s.k)}" points="${s.pts.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${dim(s) ? '#2E353D' : s.color}" stroke-width="${focus && !dim(s) ? 3.2 : 2}" stroke-linejoin="round"/>
      <polyline data-k="${esc(s.k)}" points="${s.pts.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="transparent" stroke-width="12" style="cursor:pointer"/>`).join('');
    // end labels (desktop), nudged apart so they never overlap
    let labels = '';
    if (!narrow) {
      const L = series.map(s => ({ s, y: y(s.end) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < L.length; i++) if (L[i].y - L[i - 1].y < 14) L[i].y = L[i - 1].y + 14;
      const over = L.length ? L[L.length - 1].y - (H - P.b) : 0;
      if (over > 0) L.forEach(l => { l.y -= over; });
      labels = L.map(l => `<text data-k="${esc(l.s.k)}" x="${W - P.r + 8}" y="${l.y + 4}" fill="${dim(l.s) ? '#4A535D' : l.s.color}" font-size="12" font-weight="${focus && !dim(l.s) ? 700 : 500}" font-family="Barlow Condensed, sans-serif" style="cursor:pointer">${esc(l.s.name.length > 22 ? l.s.name.slice(0, 21) + '…' : l.s.name)} · ${Math.round(l.s.end)}</text>`).join('');
    }
    el.innerHTML = `
      <div class="race-chips" role="group" aria-label="Spotlight a cemetery">${series.map(s => `<button type="button" class="race-chip${focus === s.k ? ' on' : ''}${dim(s) ? ' dim' : ''}" data-k="${esc(s.k)}" aria-pressed="${focus === s.k}"><i style="background:${s.color}"></i>${esc(s.name)}</button>`).join('')}${focus ? '<button type="button" class="race-chip" data-k="">SHOW ALL</button>' : ''}</div>
      <div class="race-wrap">
        <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Points race for the top 8 cemeteries since January 1">${grid}${xl}${ticks}${lines}${labels}
          <line class="race-cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" stroke="#9AA4AF" stroke-dasharray="3 3" visibility="hidden"/>
          <g class="race-dots"></g>
          <rect class="race-hit" x="${P.l}" y="${P.t}" width="${W - P.l - P.r}" height="${H - P.t - P.b}" fill="transparent"/>
        </svg>
        <div class="race-tip" hidden></div>
      </div>
      <p class="small race-help">Tap a name to spotlight it · ${narrow ? 'touch' : 'hover'} the chart to see the standings on any death day · red ticks = deaths</p>`;

    const svg = el.querySelector('svg'), tip = el.querySelector('.race-tip'), cross = el.querySelector('.race-cross'), dots = el.querySelector('.race-dots');
    const byDay = new Map(); tl.events.forEach(e => { if (!byDay.has(e.t)) byDay.set(e.t, new Set()); byDay.get(e.t).add(e.celeb); });
    const valAt = (s, t) => { let v = 0; for (const [tt, vv] of s.pts) { if (tt <= t) v = vv; else break; } return v; };
    function show(clientX) {
      const r = svg.getBoundingClientRect();
      const px = (clientX - r.left) * (W / r.width);
      const t = t0 + (px - P.l) / (W - P.l - P.r) * (t1 - t0);
      // snap to the nearest death day
      let best = tl.days[0]; for (const d of tl.days) if (Math.abs(d - t) < Math.abs(best - t)) best = d;
      const cx = x(best);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const rows = series.map(s => ({ s, v: valAt(s, best), before: valAt(s, best - 1) })).sort((a, b) => b.v - a.v);
      dots.innerHTML = rows.map(rw => `<circle cx="${cx}" cy="${y(rw.v)}" r="${dim(rw.s) ? 2.5 : 4}" fill="${dim(rw.s) ? '#2E353D' : rw.s.color}" stroke="#0B0D10" stroke-width="1.5"/>`).join('');
      const died = [...(byDay.get(best) || [])];
      tip.innerHTML = `<div class="rt-date">${new Date(best).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</div>
        ${died.length ? `<div class="rt-died">☠ ${died.map(esc).join(', ')}</div>` : ''}
        <table>${rows.map((rw, i) => `<tr class="${dim(rw.s) ? 'dim' : ''}"><td>${i + 1}</td><td><i style="background:${rw.s.color}"></i>${esc(rw.s.name)}</td><td>${fmt(rw.v)}</td><td class="${rw.v - rw.before > 0 ? 'up' : rw.v - rw.before < 0 ? 'down' : ''}">${rw.v !== rw.before ? (rw.v > rw.before ? '+' : '') + fmt(rw.v - rw.before) : ''}</td></tr>`).join('')}</table>`;
      tip.hidden = false;
      const left = (cx / W) * r.width;
      tip.style.left = Math.min(Math.max(0, left + 14), r.width - tip.offsetWidth) + 'px';
      if (left + 14 + tip.offsetWidth > r.width) tip.style.left = Math.max(0, left - tip.offsetWidth - 14) + 'px';
    }
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; };
    const hit = el.querySelector('.race-hit');
    hit.addEventListener('mousemove', e => show(e.clientX));
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', e => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener('touchmove', e => show(e.touches[0].clientX), { passive: true });
    el.querySelectorAll('[data-k]').forEach(n => n.addEventListener('click', () => {
      const k = n.getAttribute('data-k');
      raceFocus = !k || raceFocus === k ? '' : k;
      renderRace();
    }));
  }
  let raceResizeT = null;
  window.addEventListener('resize', () => { clearTimeout(raceResizeT); raceResizeT = setTimeout(() => { if (D && !$('v-standings').hidden) renderRace(); }, 200); });

  function renderGraveyard() {
    const q = key($('g-search').value);
    $('g-sub').textContent = `${D.graveyard.length} CONFIRMED · TAP A CEMETERY TO SEE ITS PICKS`;
    $('g-body').innerHTML = D.graveyard.map((g, i) => ({ ...g, n: i + 1 }))
      .filter(g => !q || key(g.name).includes(q) || g.cemeteries.some(c => key(c).includes(q)))
      .map(g => `<tr><td class="rk">${g.n}</td><td>${celebBtn(g.name)}</td><td class="mono small">${esc(niceDate(g.died))}</td><td class="num">${fmt(g.base)}</td><td>${tags(g.bonuses)}</td><td class="num"><b>${fmt(g.points)}</b></td><td class="num hide-sm">${g.picked ?? '—'}</td><td class="hide-sm small">${g.cemeteries.map(cemBtn).join(', ') || '—'}</td></tr>`).join('')
      || '<tr><td colspan="8" class="small">No match.</td></tr>';
  }

  function renderDeathRow() {
    const when = d => parseDate(d.died) || parseDate(d.rescheduled) || new Date(d.rescheduled) || parseDate(d.scheduled);
    const rows = [...D.deathRow].sort((a, b) => (!!a.died - !!b.died) || (a.died ? (when(b) - when(a)) : (when(a) - when(b))));
    $('d-body').innerHTML = rows.map(d => {
      const when = d.rescheduled || d.scheduled;
      const status = d.died ? `<span class="status-dead">☠ EXECUTED ${esc(niceDate(d.died))}</span>`
        : (d.delayed ? `<span class="status-alive">● DELAYED${/^(true|yes|✓|x)$/i.test(d.delayed) ? '' : ' · ' + esc(d.delayed)}</span>` : '<span class="status-alive">● WAITING</span>');
      return `<tr><td>${celebBtn(d.name)}</td><td>${esc(d.state || '—')}</td><td class="mono small">${when ? esc(niceDate(when)) : '—'}${d.rescheduled && d.scheduled && d.rescheduled !== d.scheduled ? `<br><s>${esc(niceDate(d.scheduled))}</s>` : ''}</td><td>${status}</td><td class="mono small hide-sm">${d.born ? esc(niceDate(d.born)) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="small">Death Row is empty.</td></tr>';
  }

  function upcomingBirthdays(days) {
    const t = today();
    return D.birthdays.filter(b => !deadMap.has(key(b.name))).map(b => {
      const born = parseDate(b.born); if (!born) return null;
      let next = new Date(t.getFullYear(), born.getMonth(), born.getDate());
      if (next < t) next = new Date(t.getFullYear() + 1, born.getMonth(), born.getDate());
      return { name: b.name, born: b.born, next, days: Math.round((next - t) / 86400000), turning: next.getFullYear() - born.getFullYear() };
    }).filter(b => b && b.days <= days).sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
  }
  function renderBirthdays() {
    const q = key($('b-search').value);
    $('b-body').innerHTML = upcomingBirthdays(q ? 366 : 60).filter(b => !q || key(b.name).includes(q))
      .map(b => `<tr><td>${celebBtn(b.name)}${b.days === 0 ? ' <span class="chip g">TODAY</span>' : ''}</td><td class="mono small">${b.next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td class="num">${b.turning}</td><td class="num">${b.days === 0 ? 'TODAY' : b.days + 'D'}</td></tr>`).join('')
      || '<tr><td colspan="4" class="small">No birthdays found.</td></tr>';
  }

  function renderBoxes() {
    const q = key($('x-search').value);
    $('x-body').innerHTML = D.boxes.map(b => {
      const matchBox = !q || key(b.name).includes(q);
      const celebs = b.celebs.filter(c => matchBox || key(c).includes(q));
      if (!celebs.length) return '';
      return `<div class="box"><h3>${esc(b.name)}</h3><ul>${celebs.map(c => {
        const dead = deadMap.has(key(c));
        return `<li class="${dead ? 'dead' : ''}"><span>${celebBtn(c)}${dead ? '<span class="dead-mark">☠</span>' : ''}</span><span class="ct">${picksCount.get(key(c)) || 0}</span></li>`;
      }).join('')}</ul></div>`;
    }).join('') || '<p class="small">No match.</p>';
  }

  function renderRules() {
    const info = new Map((D.categoryInfo || []).map(c => [key(c.name), c.desc]));
    $('r-cats').innerHTML = D.boxes.map(b => `<button type="button" class="box cat-card" data-cat="${esc(b.name)}"><h3>${esc(b.name)}</h3>${info.get(key(b.name)) ? `<p>${esc(info.get(key(b.name)))}</p>` : ''}<span class="small">${b.celebs.length} CELEBS · ${b.celebs.filter(c => deadMap.has(key(c))).length} DEAD</span></button>`).join('');
    $('r-bonuses').innerHTML = (D.bonuses || []).map(b => `<li><b>${esc(b.code)}</b><span>${esc(b.text)}</span></li>`).join('') || '<li class="small">Bonus list unavailable.</li>';
  }

  // ---------- My Cemetery (sign in with the email from your entry form)
  let me = null;
  const openCems = new Set(), closedCems = new Set();   // remembers what you opened/closed between refreshes
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.matches || !d.matches('details.mine-card')) return;
    const k = d.dataset.cemkey;
    if (d.open) { openCems.add(k); closedCems.delete(k); } else { openCems.delete(k); closedCems.add(k); }
  }, true);
  async function loadMe() {
    if (!window.aasnAuth) return;
    const token = await aasnAuth.accessToken().catch(() => null);
    if (!token) { me = null; renderMine(); return; }
    try {
      const res = await fetch(AASN_API_URL + '/deathpool/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken: token }) });
      me = await res.json();
    } catch (e) { me = { success: false, error: 'Could not reach the server.' }; }
    renderMine(); if (D) renderHome();
  }
  function renderMine() {
    if (!D) return;
    const el = $('m-body');
    const session = window.aasnAuth && aasnAuth.session();
    if (!session) {
      $('m-sub').textContent = '';
      el.innerHTML = `<div class="mine-empty"><p>Sign in with the <b>same email you used on your Death Pool entry</b> to see your cemetery, your picks and how you stack up.</p><button type="button" class="btn-g" data-signin>SIGN IN</button></div>`;
      return;
    }
    if (!me) { el.innerHTML = '<p class="status">Finding your cemetery…</p>'; return; }
    if (!me.success) { el.innerHTML = `<div class="mine-empty"><p>${esc(me.error || 'Something went wrong.')}</p></div>`; return; }
    // Your own cemetery (or cemeteries) first and open; for the commissioner, everyone else follows, closed.
    const own = me.cemeteries || [];
    const others = me.admin ? sortedStandings().map(s => s.name).filter(n => !own.some(o => key(o) === key(n))) : [];
    const names = [...own, ...others];
    $('m-sub').textContent = (me.emails || []).join(' · ').toUpperCase() + (me.admin ? ' · COMMISSIONER (ALL CEMETERIES)' : '');
    if (!names.length) {
      el.innerHTML = `<div class="mine-empty"><p>No cemetery is registered to <b>${esc((me.emails || []).join(', '))}</b>. Sign in with the email from your entry form, or ask the commissioner to check it.</p></div>`;
      return;
    }
    el.innerHTML = names.map(n => {
      const st = D.standings.find(s => key(s.name) === key(n)) || {};
      const c = cemByName.get(key(n));
      const dead = c ? c.picks.filter(p => deadMap.has(key(p.celeb))).length : 0;
      const picks = c ? c.picks.map(p => {
        const g = deadMap.get(key(p.celeb));
        return `<tr><td class="small">${esc(p.category)}</td><td>${celebBtn(p.celeb)}${g ? `<span class="dead-mark">☠ ${esc(niceDate(g.died))}</span>` : ''}</td><td class="num">${p.points ? fmt(p.points) : '—'}</td></tr>`;
      }).join('') : '';
      const has = window.aasnLogos && aasnLogos.url('dp', n);
      const mine = own.some(o => key(o) === key(n));
      const isOpen = openCems.has(key(n)) || (mine && !closedCems.has(key(n)));
      return `<details class="mine-card" data-cemkey="${esc(key(n))}"${isOpen ? ' open' : ''}>
        <summary><span class="ms-name">${logo(n, 40)}${esc(n)}${mine ? ' <span class="chip g">YOURS</span>' : ''}</span><span class="ms-meta mono">${st.rank != null ? '#' + st.rank + ' · ' : ''}${fmt(st.points)} PTS</span></summary>
        <div class="ms-body">
        <div style="display:flex;gap:6px;margin:0 0 10px"><button type="button" class="dp-signin" style="min-height:34px;font-size:13px" data-dplogo="set" data-team="${esc(n)}">${has ? 'CHANGE LOGO' : 'ADD LOGO'}</button>${has ? `<button type="button" class="dp-signin" style="min-height:34px;font-size:13px" data-dplogo="remove" data-team="${esc(n)}">REMOVE</button>` : ''}<span class="small" id="dplogo-msg-${esc(key(n))}"></span></div>
        <div class="cstats">
          <div><span>RANK</span><b>${st.rank ?? '—'}${DM && DM.map.get(key(n)) ? ' ' + moveHtml(DM.map.get(key(n))) : ''}</b></div>
          <div><span>POINTS</span><b>${fmt(st.points)}</b></div>
          <div><span>BEHIND LEADER</span><b>${st.points != null ? fmt(Math.max(0, leaderPts() - st.points)) : '—'}</b></div>
          <div><span>DEAD PICKS</span><b>${c ? dead + ' / ' + c.picks.length : '—'}</b></div>
        </div>
        ${picks ? `<div class="tbl-wrap"><table><thead><tr><th>CATEGORY</th><th>PICK</th><th class="num">PTS</th></tr></thead><tbody>${picks}</tbody></table></div>` : ''}
        </div>
      </details>`;
    }).join('');
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-signin]') && window.aasnAuth) aasnAuth.open(); });
  // Cemetery logo: owners (signed in with their entry email) — goes live straight away.
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-dplogo]');
    if (!b || !window.aasnLogos || !window.aasnAuth) return;
    const team = b.dataset.team;
    const args = { pool: 'dp', team, proof: { accessToken: await aasnAuth.accessToken() } };
    b.disabled = true;
    const out = b.dataset.dplogo === 'remove' ? await aasnLogos.remove(args) : await aasnLogos.choose(args);
    b.disabled = false;
    if (out.cancelled) return;
    if (!out.success) { const m = document.getElementById('dplogo-msg-' + key(team)); if (m) m.textContent = out.error || 'Could not update the logo.'; return; }
    renderAll();
  });
  if (window.aasnAuth) aasnAuth.onChange(() => { me = null; renderMine(); loadMe(); });

  function renderAll() {
    deadMap = new Map(D.graveyard.map(g => [key(g.name), g]));
    cemByName = new Map(D.cemeteries.map(c => [key(c.name), c]));
    picksCount = new Map(); owners = new Map();
    celebMap = new Map((D.celebs || []).map(c => [key(c.name), c]));
    D.cemeteries.forEach(c => c.picks.forEach(p => {
      picksCount.set(key(p.celeb), (picksCount.get(key(p.celeb)) || 0) + 1);
      if (!owners.has(key(p.celeb))) owners.set(key(p.celeb), []);
      owners.get(key(p.celeb)).push({ cem: c.name, category: p.category });
    }));
    DM = deathMove();
    renderMine(); renderHome(); renderStandings(); renderGraveyard(); renderDeathRow(); renderBirthdays(); renderBoxes(); renderRules();
    $('stamp').textContent = 'UPDATED ' + new Date(D.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    $('x-search').value = b.dataset.cat;
    location.hash = '#boxes';
    renderBoxes();
  });

  [['s-search', renderStandings], ['g-search', renderGraveyard], ['b-search', renderBirthdays], ['x-search', renderBoxes]]
    .forEach(([id, fn]) => $(id).addEventListener('input', () => D && fn()));

  // Show the last copy this browser saw right away, then swap in fresh data.
  const LS = 'aasn-dp-data';
  try {
    const saved = JSON.parse(localStorage.getItem(LS) || 'null');
    if (saved && saved.success) { D = saved; renderAll(); $('loading').hidden = true; route(); }
  } catch (e) { /* ignore */ }

  async function load() {
    try {
      const res = await fetch(AASN_API_URL + '/deathpool/data');
      const d = await res.json();
      if (!d || !d.success) throw new Error('no data');
      const first = !D;
      if (window.aasnLogos) await aasnLogos.load('dp');
      D = d;
      renderAll();
      $('loading').hidden = true;
      if (first) route();
      try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) { /* storage full or blocked */ }
    } catch (e) {
      if (!D) $('loading').textContent = 'No pulse right now — the Death Pool data is unavailable. Try again shortly.';
    }
  }
  // What's New (deathpool/whatsnew.json) + a dot on the tab when there's something unseen.
  const WN_KEY = 'aasn-dp-wn-seen';
  fetch('whatsnew.json', { cache: 'no-cache' }).then(r => r.json()).then(list => {
    $('wn-body').innerHTML = list.map(e => `<div class="panel" style="margin-bottom:10px"><div class="mono small" style="color:var(--g)">${esc(new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase())}</div><h2 style="margin:4px 0 6px">${esc(e.title)}</h2><ul style="padding-left:18px">${e.items.map(i => `<li style="font-size:15px;line-height:1.5;color:var(--text-2);margin:3px 0">${esc(i)}</li>`).join('')}</ul></div>`).join('');
    let seen = 0; try { seen = Number(localStorage.getItem(WN_KEY) || 0); } catch (e) { /* ignore */ }
    const tab = document.querySelector('.tabs a[href="#whatsnew"]');
    const mark = () => { try { localStorage.setItem(WN_KEY, String(list.length)); } catch (e) { /* ignore */ } const d = tab && tab.querySelector('.wn-dot'); if (d) d.remove(); };
    if (tab && list.length > seen) tab.insertAdjacentHTML('beforeend', '<span class="wn-dot" aria-label="new" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF5C5C;margin-left:5px;vertical-align:middle"></span>');
    if (location.hash === '#whatsnew') mark();
    window.addEventListener('hashchange', () => { if (location.hash === '#whatsnew') mark(); });
  }).catch(() => { $('wn-body').innerHTML = '<p class="small">What\'s New is unavailable right now.</p>'; });

  load().then(loadMe);
  setInterval(() => { if (!document.hidden) load(); }, 600000);
})();
