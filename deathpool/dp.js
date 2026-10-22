/* Death Pool 2026 on AASN — reads the pool sheet (via the AASN API) and renders
 * every page client-side. Hash routes: #home #standings #graveyard #deathrow
 * #birthdays #boxes #rules. Refreshes every 10 minutes while open. */
(function () {
  const VIEWS = ['home', 'standings', 'graveyard', 'deathrow', 'birthdays', 'boxes', 'rules'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = v => v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let D = null, deadMap = new Map(), picksCount = new Map(), cemByName = new Map();

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
    $('dlg-title').textContent = name;
    $('dlg-sub').textContent = (st ? `RANK ${st.rank} · ${fmt(st.points)} PTS` : '') + (c ? ` · ${c.picks.filter(p => deadMap.has(key(p.celeb))).length} OF ${c.picks.length} PICKS DEAD` : '');
    $('dlg-body').innerHTML = c ? c.picks.map(p => {
      const dead = deadMap.get(key(p.celeb));
      return `<tr><td class="small">${esc(p.category)}</td><td>${esc(p.celeb)}${dead ? `<span class="dead-mark">☠ ${esc(niceDate(dead.died))}</span>` : ''}</td><td class="num">${p.points ? fmt(p.points) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="small">Picks not available for this cemetery.</td></tr>';
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------- renderers
  const bonusText = code => { const b = (D.bonuses || []).find(x => x.code === code); return b ? b.text : code; };
  const tags = list => list.map(code => `<span class="btag${code === 'B16' ? ' neg' : ''}" title="${esc(bonusText(code))}">${esc(code)}</span>`).join('') || '<span class="small">—</span>';
  const cemBtn = name => `<button type="button" class="linkbtn" data-cem="${esc(name)}">${esc(name)}</button>`;
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
    $('h-latest').innerHTML = latest.map(g => `<li><b>${esc(g.name)}</b><span>${esc(niceDate(g.died))} · ${fmt(g.points)} PTS</span></li>`).join('') || '<li class="small">Nobody yet.</li>';
    const up = upcomingBirthdays(14);
    $('h-bdays').innerHTML = up.map(b => `<span class="chip${b.days === 0 ? ' g' : ''}">${b.days === 0 ? '🎂 TODAY: ' : ''}${esc(b.name)} · ${b.turning}${b.days ? ' · ' + b.days + 'D' : ''}</span>`).join('') || '<span class="small">No birthdays in the next two weeks.</span>';
    const lead = leaderPts();
    $('h-top').innerHTML = s.slice(0, 10).map(r => `<tr class="${r.rank === 1 ? 'top1' : ''}"><td class="rk">${r.rank ?? ''}</td><td>${cemBtn(r.name)}</td><td class="num">${fmt(r.points)}</td><td class="hide-sm"><div class="bar"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></div></td></tr>`).join('');
  }

  function renderStandings() {
    const q = key($('s-search').value);
    const lead = leaderPts();
    $('s-body').innerHTML = sortedStandings().filter(r => !q || key(r.name).includes(q)).map(r => {
      const c = cemByName.get(key(r.name));
      const dead = c ? c.picks.filter(p => deadMap.has(key(p.celeb))).length : null;
      return `<tr class="${r.rank === 1 ? 'top1' : ''}"><td class="rk">${r.rank ?? ''}</td><td>${cemBtn(r.name)}</td><td class="num">${fmt(r.points)}</td><td class="num hide-sm">${dead ?? '—'}</td><td class="hide-sm"><div class="bar"><i style="width:${lead ? Math.max(2, r.points / lead * 100) : 0}%"></i></div></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="small">No match.</td></tr>';
  }

  function renderGraveyard() {
    const q = key($('g-search').value);
    $('g-sub').textContent = `${D.graveyard.length} CONFIRMED · TAP A CEMETERY TO SEE ITS PICKS`;
    $('g-body').innerHTML = D.graveyard.map((g, i) => ({ ...g, n: i + 1 }))
      .filter(g => !q || key(g.name).includes(q) || g.cemeteries.some(c => key(c).includes(q)))
      .map(g => `<tr><td class="rk">${g.n}</td><td><b>${esc(g.name)}</b></td><td class="mono small">${esc(niceDate(g.died))}</td><td class="num">${fmt(g.base)}</td><td>${tags(g.bonuses)}</td><td class="num"><b>${fmt(g.points)}</b></td><td class="num hide-sm">${g.picked ?? '—'}</td><td class="hide-sm small">${g.cemeteries.map(cemBtn).join(', ') || '—'}</td></tr>`).join('')
      || '<tr><td colspan="8" class="small">No match.</td></tr>';
  }

  function renderDeathRow() {
    const when = d => parseDate(d.died) || parseDate(d.rescheduled) || new Date(d.rescheduled) || parseDate(d.scheduled);
    const rows = [...D.deathRow].sort((a, b) => (!!a.died - !!b.died) || (a.died ? (when(b) - when(a)) : (when(a) - when(b))));
    $('d-body').innerHTML = rows.map(d => {
      const when = d.rescheduled || d.scheduled;
      const status = d.died ? `<span class="status-dead">☠ EXECUTED ${esc(niceDate(d.died))}</span>`
        : (d.delayed ? `<span class="status-alive">● DELAYED${/^(true|yes|✓|x)$/i.test(d.delayed) ? '' : ' · ' + esc(d.delayed)}</span>` : '<span class="status-alive">● WAITING</span>');
      return `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.state || '—')}</td><td class="mono small">${when ? esc(niceDate(when)) : '—'}${d.rescheduled && d.scheduled && d.rescheduled !== d.scheduled ? `<br><s>${esc(niceDate(d.scheduled))}</s>` : ''}</td><td>${status}</td><td class="mono small hide-sm">${d.born ? esc(niceDate(d.born)) : '—'}</td></tr>`;
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
      .map(b => `<tr><td><b>${esc(b.name)}</b>${b.days === 0 ? ' <span class="chip g">TODAY</span>' : ''}</td><td class="mono small">${b.next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td><td class="num">${b.turning}</td><td class="num">${b.days === 0 ? 'TODAY' : b.days + 'D'}</td></tr>`).join('')
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
        return `<li class="${dead ? 'dead' : ''}"><span>${esc(c)}${dead ? '<span class="dead-mark">☠</span>' : ''}</span><span class="ct">${picksCount.get(key(c)) || 0}</span></li>`;
      }).join('')}</ul></div>`;
    }).join('') || '<p class="small">No match.</p>';
  }

  function renderRules() {
    $('r-bonuses').innerHTML = (D.bonuses || []).map(b => `<li><b>${esc(b.code)}</b><span>${esc(b.text)}</span></li>`).join('') || '<li class="small">Bonus list unavailable.</li>';
  }

  function renderAll() {
    deadMap = new Map(D.graveyard.map(g => [key(g.name), g]));
    cemByName = new Map(D.cemeteries.map(c => [key(c.name), c]));
    picksCount = new Map();
    D.cemeteries.forEach(c => c.picks.forEach(p => picksCount.set(key(p.celeb), (picksCount.get(key(p.celeb)) || 0) + 1)));
    renderHome(); renderStandings(); renderGraveyard(); renderDeathRow(); renderBirthdays(); renderBoxes(); renderRules();
    $('stamp').textContent = 'UPDATED ' + new Date(D.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  [['s-search', renderStandings], ['g-search', renderGraveyard], ['b-search', renderBirthdays], ['x-search', renderBoxes]]
    .forEach(([id, fn]) => $(id).addEventListener('input', () => D && fn()));

  async function load() {
    try {
      const res = await fetch(AASN_API_URL + '/deathpool/data');
      const d = await res.json();
      if (!d || !d.success) throw new Error('no data');
      D = d;
      renderAll();
      $('loading').hidden = true;
      route();
    } catch (e) {
      if (!D) $('loading').textContent = 'No pulse right now — the Death Pool data is unavailable. Try again shortly.';
    }
  }
  load();
  setInterval(() => { if (!document.hidden) load(); }, 600000);
})();
