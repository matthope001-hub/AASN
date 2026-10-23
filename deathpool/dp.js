/* Death Pool 2026 on AASN — reads the pool sheet (via the AASN API) and renders
 * every page client-side. Hash routes: #home #standings #graveyard #deathrow
 * #birthdays #boxes #rules. Refreshes every 10 minutes while open. */
(function () {
  const VIEWS = ['home', 'standings', 'graveyard', 'deathrow', 'birthdays', 'boxes', 'rules', 'mine'];
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
    document.querySelectorAll('.tabs a').forEach(a => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + view));
    if (a11yFirst) a11yFirst = false; else window.scrollTo(0, 0);
  }
  let a11yFirst = true;
  window.addEventListener('hashchange', route);
  document.querySelectorAll('.tabs a').forEach(a => a.addEventListener('click', () => { if (a.getAttribute('href') === location.hash) route(); }));

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
    $('cdlg-body').innerHTML = `<div class="cstats">${stats.join('')}</div>
      ${g && g.bonuses.length ? `<p class="small" style="margin-bottom:10px">Bonuses: ${tags(g.bonuses)}</p>` : ''}
      <div class="sec-title" style="font-size:16px">PICKED BY</div>
      <div class="owners">${own.length ? own.map(o => `<span class="chip">${cemBtn(o.cem)} <span class="small">· ${esc(o.category)}</span></span>`).join('') : '<span class="small">Nobody picked them.</span>'}</div>
      ${c.wiki ? `<p style="margin-top:14px"><a href="${esc(c.wiki)}" target="_blank" rel="noopener">More on Wikipedia →</a></p>` : ''}`;
    if (dlg.open) dlg.close();
    if (typeof cdlg.showModal === 'function') cdlg.showModal(); else cdlg.setAttribute('open', '');
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
    const s = sortedStandings();
    $('k-grave').textContent = D.graveyard.length;
    $('k-row').textContent = D.deathRow.filter(x => !x.died).length;
    $('k-cem').textContent = s.length;
    $('k-lead').textContent = s[0] ? s[0].name : '—';
    $('k-lead').title = s[0] ? `${s[0].name} · ${fmt(s[0].points)} pts` : '';
    const latest = [...D.graveyard].sort((a, b) => (parseDate(b.died) || 0) - (parseDate(a.died) || 0)).slice(0, 5);
    $('h-latest').innerHTML = latest.map(g => `<li>${celebBtn(g.name)}<span>${esc(niceDate(g.died))} · ${fmt(g.points)} PTS</span></li>`).join('') || '<li class="small">Nobody yet.</li>';
    const up = upcomingBirthdays(14);
    $('h-bdays').innerHTML = up.map(b => `<span class="chip${b.days === 0 ? ' g' : ''}">${b.days === 0 ? '🎂 TODAY: ' : ''}${esc(b.name)} · ${b.turning}${b.days ? ' · ' + b.days + 'D' : ''}</span>`).join('') || '<span class="small">No birthdays in the next two weeks.</span>';
    const lead = leaderPts();
    $('h-top').innerHTML = s.slice(0, 10).map(r => `<tr class="${r.rank === 1 ? 'top1' : ''}"><td class="rk">${r.rank ?? ''}</td><td>${cemBtn(r.name)}</td><td class="num">${fmt(r.points)}</td><td class="hide-sm"><div class="bar"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></div></td></tr>`).join('');
  }

  const upside = c => !c ? null : c.picks.reduce((t, p) => {
    if (/mummy/i.test(p.category) || deadMap.has(key(p.celeb))) return t;
    const v = (celebMap.get(key(p.celeb)) || {}).value;
    return t + (v > 0 ? v : 0);
  }, 0);
  const move = r => {
    if (r.prevRank == null || r.rank == null) return '<span class="mv flat">—</span>';
    const d = r.prevRank - r.rank;
    return d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : '<span class="mv flat">–</span>';
  };
  function renderStandings() {
    const q = key($('s-search').value);
    const lead = leaderPts();
    if (D.prevDate) $('s-prev').textContent = niceDate(D.prevDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (m, y, mo, d) => `${+mo}/${+d}/${y}`));
    $('s-body').innerHTML = sortedStandings().filter(r => !q || key(r.name).includes(q)).map(r => {
      const c = cemByName.get(key(r.name));
      const dead = c ? c.picks.filter(p => deadMap.has(key(p.celeb))).length : null;
      const up = upside(c);
      return `<tr class="${r.rank === 1 ? 'top1' : ''}"><td class="rk">${r.rank ?? ''}</td><td>${cemBtn(r.name)}</td><td class="num">${fmt(r.points)}</td><td class="hide-sm">${move(r)}</td><td class="num">${up == null ? '—' : fmt(up)}</td><td class="num hide-sm">${dead ?? '—'}</td><td class="hide-sm"><div class="bar"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></div></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="small">No match.</td></tr>';
    renderRace();
  }

  // Points race: top 8 cemeteries over the daily snapshots.
  function renderRace() {
    const el = $('race'), h = D.history || { dates: [], rows: [] };
    if ((h.dates || []).length < 2) { el.innerHTML = '<p class="small">The race chart fills in as daily snapshots build up — check back tomorrow.</p>'; return; }
    const top = sortedStandings().slice(0, 8).map(s => s.name);
    const COLORS = ['#8BE37A', '#00D4FF', '#FFB800', '#F06A70', '#B79CFF', '#FF9F43', '#4FD1C5', '#E8ECF0'];
    const W = 800, H = 220, P = { l: 40, r: 10, t: 10, b: 22 };
    const dates = h.dates, max = Math.max(1, ...h.rows.filter(r => top.includes(r[1])).map(r => r[2]));
    const x = i => P.l + (W - P.l - P.r) * (dates.length === 1 ? 0 : i / (dates.length - 1));
    const y = v => P.t + (H - P.t - P.b) * (1 - v / max);
    const lines = top.map((name, k) => {
      const pts = dates.map((d, i) => { const r = h.rows.find(r => r[0] === d && r[1] === name); return r ? `${x(i).toFixed(1)},${y(r[2]).toFixed(1)}` : null; }).filter(Boolean);
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="${COLORS[k]}" stroke-width="2.2" vector-effect="non-scaling-stroke"><title>${esc(name)}</title></polyline>`;
    }).join('');
    const grid = [0, .25, .5, .75, 1].map(f => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="#1F252C"/><text x="${P.l - 6}" y="${y(max * f) + 4}" fill="#9AA4AF" font-size="10" text-anchor="end" font-family="JetBrains Mono">${Math.round(max * f)}</text>`).join('');
    const lab = i => { const [yy, mm, dd] = dates[i].split('-'); return `${+mm}/${+dd}`; };
    const xl = `<text x="${x(0)}" y="${H - 6}" fill="#9AA4AF" font-size="10" font-family="JetBrains Mono">${lab(0)}</text><text x="${x(dates.length - 1)}" y="${H - 6}" fill="#9AA4AF" font-size="10" text-anchor="end" font-family="JetBrains Mono">${lab(dates.length - 1)}</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Points race for the top 8 cemeteries">${grid}${lines}${xl}</svg>
      <div class="lg">${top.map((n, k) => `<span><i style="background:${COLORS[k]}"></i>${esc(n)}</span>`).join('')}</div>`;
  }

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
    renderMine();
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
      const up = upside(c);
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
          <div><span>RANK</span><b>${st.rank ?? '—'}${st.prevRank != null && st.rank != null && st.prevRank !== st.rank ? ` <span class="mv ${st.prevRank > st.rank ? 'up' : 'down'}">${st.prevRank > st.rank ? '▲' : '▼'}${Math.abs(st.prevRank - st.rank)}</span>` : ''}</b></div>
          <div><span>POINTS</span><b>${fmt(st.points)}</b></div>
          <div><span>BEHIND LEADER</span><b>${st.points != null ? fmt(Math.max(0, leaderPts() - st.points)) : '—'}</b></div>
          <div><span>UPSIDE</span><b>${up == null ? '—' : fmt(up)}</b></div>
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
    const out = b.dataset.dplogo === 'remove' ? await aasnLogos.remove(args) : await aasnLogos.pick(args);
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
  load().then(loadMe);
  setInterval(() => { if (!document.hidden) load(); }, 600000);
})();
