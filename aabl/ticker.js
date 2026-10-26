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

  const css = `
  #aabl-ticker { display: flex; align-items: stretch; height: 40px; overflow: hidden; background: #081A30; border-bottom: 1px solid #25446E; font-family: 'Barlow Condensed', system-ui, sans-serif; color: #E8EDF1; }
  #aabl-ticker[hidden] { display: none; }
  #aabl-ticker .tk-lbl { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 14px; background: #25446E; color: #fff; font-weight: 700; font-size: 14px; letter-spacing: 1.5px; }
  #aabl-ticker .tk-lbl.live { background: #B3121B; }
  #aabl-ticker .tk-lbl i { width: 7px; height: 7px; border-radius: 50%; background: #fff; animation: aablTkPulse 1.4s ease-in-out infinite; }
  @keyframes aablTkPulse { 50% { opacity: .3; } }
  #aabl-ticker .tk-track { flex: 1; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent); mask-image: linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent); }
  #aabl-ticker .tk-run { display: flex; width: max-content; height: 100%; animation: aablTkScroll var(--tk-dur, 40s) linear infinite; }
  @media (hover: hover) and (pointer: fine) { #aabl-ticker:hover .tk-run { animation-play-state: paused; } }
  @keyframes aablTkScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  #aabl-ticker .tk-i { display: flex; align-items: center; gap: 8px; padding: 0 16px; border-right: 1px solid #25446E; white-space: nowrap; font-size: 15px; height: 100%; }
  #aabl-ticker .tk-t { display: inline-flex; align-items: center; gap: 5px; }
  #aabl-ticker .tk-t img { width: 20px; height: 20px; object-fit: contain; }
  #aabl-ticker .tk-t b { font-weight: 700; letter-spacing: .5px; }
  #aabl-ticker .tk-t s { text-decoration: none; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 15px; min-width: 14px; text-align: center; }
  #aabl-ticker .tk-lose { opacity: .45; }
  #aabl-ticker em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #A9B8CC; margin-left: 2px; }
  #aabl-ticker .tk-i.in em { color: #FF8A8A; }
  #aabl-ticker .tk-i.flash { animation: aablTkFlash 2.4s ease-out; }
  @keyframes aablTkFlash { 0%, 30% { background: rgba(63,209,122,.35); } 100% { background: transparent; } }
  @media (prefers-reduced-motion: reduce) { #aabl-ticker .tk-run { animation: none; } #aabl-ticker .tk-track { overflow-x: auto; } #aabl-ticker .tk-i.flash { animation: none; } }`;

  let el, refreshT = null;
  const last = {};

  function build() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    el = document.createElement('div');
    el.id = 'aabl-ticker'; el.hidden = true; el.setAttribute('aria-label', "Today's MLB games");
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
    const team = t => `<span class="tk-t${st === 'post' && t.winner === false ? ' tk-lose' : ''}"><img src="${esc(t.team.logo || '')}" alt="" onerror="this.style.visibility='hidden'"><b>${esc(t.team.abbreviation)}</b>${st === 'pre' ? '' : `<s>${esc(t.score)}</s>`}</span>`;
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
