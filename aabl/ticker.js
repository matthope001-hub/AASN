/* AABL scores ticker — same look and position as the AAFL/AAHL tickers.
 * Usage (Home page, after the header): <script src="ticker.js" defer></script>
 * Shows today's MLB games from ESPN: start times, live scores and finals, always scrolling.
 * The label turns red "● LIVE" while games are on. Hidden on days with no MLB games. */
(function () {
  if (window.__aablTicker) return;
  window.__aablTicker = true;
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const state = e => (e.status && e.status.type ? e.status.type.state : 'pre');
  // ESPN's dark-background logos (navy/black logos stay visible on dark panels); falls back to the regular logo.
  const dl = u => String(u || '').replace('/500/', '/500-dark/');

  // Shared AASN ticker look (same as AAHL and AAFL).
  const CSS_URL = new URL('../shared/ticker.css?v=1', (document.currentScript && document.currentScript.src) || location.href).href;

  let el, refreshT = null;
  const last = {};

  function build() {
    if (!document.querySelector('link[href*="shared/ticker.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS_URL; document.head.appendChild(l); }
    el = document.createElement('div');
    el.id = 'aabl-ticker'; el.className = 'aasn-tk'; el.style.setProperty('--tk-accent', '#BD3039'); el.hidden = true; el.setAttribute('aria-label', "Today's MLB games");
    el.innerHTML = '<div class="tk-lbl">MLB</div><div class="tk-track"><div class="tk-run"></div></div>';
    const hdr = document.querySelector('header');
    if (hdr) hdr.after(el); else document.body.prepend(el);
    load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  function item(e) {
    const c = e.competitions[0], st = state(e);
    const away = c.competitors.find(x => x.homeAway === 'away'), home = c.competitors.find(x => x.homeAway === 'home');
    const score = away.score + '-' + home.score;
    const flash = st === 'in' && last[e.id] && last[e.id] !== score;
    const team = t => `<span class="${st === 'post' && t.winner === false ? 'lose' : ''}"><img src="${esc(dl(t.team.logo))}" data-o="${esc(t.team.logo || '')}" onerror="if(this.dataset.o&&this.src!==this.dataset.o){this.src=this.dataset.o}else{this.style.visibility='hidden'}" alt=""><b>${esc(t.team.abbreviation)}</b>${st === 'pre' ? '' : `<s>${esc(t.score)}</s>`}</span>`;
    const status = st === 'pre'
      ? new Date(e.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : e.status.type.shortDetail;
    return `<div class="tk-i ${st}${flash ? ' flash' : ''}">${team(away)}${team(home)}<em>${esc(status)}</em></div>`;
  }

  async function load() {
    clearTimeout(refreshT);
    let live = false;
    try {
      const r = await fetch(ESPN);
      if (!r.ok) throw new Error(r.status);
      const ev = ((await r.json()).events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!ev.length) { el.hidden = true; }
      else {
        live = ev.some(e => state(e) === 'in');
        const lbl = el.querySelector('.tk-lbl');
        lbl.className = 'tk-lbl' + (live ? ' live' : '');
        lbl.innerHTML = live ? '<i aria-hidden="true"></i>LIVE' : 'MLB';
        // Repeat until one set is wide enough, then double it so the loop has no gap.
        const ITEM_PX = 190, copies = Math.max(1, Math.ceil(2400 / (ev.length * ITEM_PX)));
        const one = []; for (let i = 0; i < copies; i++) one.push(...ev);
        const html = one.map(item).join('');
        const run = el.querySelector('.tk-run');
        run.innerHTML = html + html;
        ev.forEach(e => { const cs = e.competitions[0].competitors; last[e.id] = cs.find(x => x.homeAway === 'away').score + '-' + cs.find(x => x.homeAway === 'home').score; });
        run.style.setProperty('--tk-dur', Math.max(30, Math.round(one.length * ITEM_PX / 45)) + 's');
        el.hidden = false;
      }
    } catch (e) { el.hidden = true; }
    // Every 30 seconds while games are live, otherwise every 5 minutes.
    refreshT = setTimeout(() => { if (!document.hidden) load(); }, live ? 30000 : 300000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
