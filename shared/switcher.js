/* AASN pool switcher — the thin network bar at the top of each pool's site.
 * Load on any page with:
 *   <script src="https://matthope001-hub.github.io/AASN/shared/switcher.js" data-pool="aahl" defer></script>
 * data-pool = the pool this page belongs to ("aahl" or "aabl"); that badge shows as current.
 * Self-contained: injects its own styles and reads each pool's status from Supabase (anon, read-only).
 * When the AASN domain arrives, only the URLs in LINKS need changing. */
(function () {
  if (window.__aasnSwitcher) return;
  window.__aasnSwitcher = true;

  const me = document.currentScript;
  const current = ((me && me.dataset.pool) || '').toLowerCase();
  const BASE = 'https://matthope001-hub.github.io/AASN/';
  const LINKS = {
    hub: BASE,
    aahl: 'https://theaahl.ca/',
    aabl: BASE + 'aabl/'
  };
  const SB_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';
  const POOLS = [
    { id: 'aahl', name: 'AAHL', year: '26/27', accent: '#00D4FF', logo: LINKS.aahl + 'aahl-logo.png', round: false },
    { id: 'aabl', name: 'AABL', year: '2027', accent: '#F06A70', logo: BASE + 'aabl/assets/aabl-badge.png', round: true }
  ];

  const css = `
  #aasn-bar { background: #07090C; border-bottom: 1px solid #1F252C; font-family: 'Barlow Condensed', system-ui, sans-serif; position: relative; z-index: 11; }
  #aasn-bar * { box-sizing: border-box; }
  #aasn-bar .ab-in { max-width: 1100px; margin: 0 auto; padding: 5px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  #aasn-bar a { text-decoration: none; }
  #aasn-bar .ab-hub { display: flex; align-items: baseline; gap: 10px; color: #E8ECF0; min-height: 40px; align-items: center; }
  #aasn-bar .ab-hub b { font-weight: 800; font-size: 16px; letter-spacing: 2px; }
  #aasn-bar .ab-hub span { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 1px; color: #9AA4AF; }
  #aasn-bar nav { display: flex; gap: 6px; }
  #aasn-bar .ab-pill { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 8px; background: transparent; border: 1px solid #1F252C; border-top: 2px solid transparent; color: #9AA4AF; transition: background .15s, color .15s; }
  #aasn-bar .ab-pill:hover { background: #161B21; color: #E8ECF0; }
  #aasn-bar .ab-pill:focus-visible, #aasn-bar .ab-hub:focus-visible { outline: 2px solid #00D4FF; outline-offset: 2px; }
  #aasn-bar .ab-pill[aria-current="page"] { background: #12161B; border-color: #2E353D; border-top-color: var(--ab-accent); color: #E8ECF0; }
  #aasn-bar .ab-pill img { width: 24px; height: 24px; object-fit: contain; flex: none; }
  #aasn-bar .ab-pill img.round { object-fit: cover; border-radius: 50%; }
  #aasn-bar .ab-txt { display: flex; flex-direction: column; line-height: 1.05; }
  #aasn-bar .ab-nm { font-weight: 700; font-size: 15px; letter-spacing: .5px; }
  #aasn-bar .ab-nm em { font-style: normal; color: var(--ab-accent); }
  #aasn-bar .ab-st { font-family: 'JetBrains Mono', monospace; font-size: 10px; min-height: 11px; white-space: nowrap; }
  #aasn-bar .ab-pill[aria-current="page"] .ab-st { color: #C9D1D9; }
  #aasn-bar .ab-live { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #FF5C5C; margin-right: 4px; vertical-align: 1px; animation: abPulse 1.6s ease-in-out infinite; }
  @keyframes abPulse { 50% { opacity: .35; } }
  @media (prefers-reduced-motion: reduce) { #aasn-bar .ab-live { animation: none; } #aasn-bar .ab-pill { transition: none; } }
  @media (max-width: 640px) {
    #aasn-bar .ab-in { padding: 5px 10px; gap: 6px; }
    #aasn-bar .ab-hub { min-width: 44px; justify-content: center; border: 1px solid #1F252C; padding: 0 6px; }
    #aasn-bar .ab-hub b { font-size: 12px; letter-spacing: 1px; color: #9AA4AF; }
    #aasn-bar .ab-hub span { display: none; }
    #aasn-bar nav { flex: 1; }
    #aasn-bar .ab-pill { flex: 1; min-height: 44px; padding: 0 8px 0 6px; }
    #aasn-bar .ab-nm em { display: none; }
  }
  @media print { #aasn-bar { display: none; } }`;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build() {
    if (document.getElementById('aasn-bar')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.id = 'aasn-bar';
    bar.innerHTML = `<div class="ab-in">
      <a class="ab-hub" href="${LINKS.hub}" aria-label="AASN home — Angry Alpaca Sports Network"><b>AASN</b><span>ANGRY ALPACA SPORTS NETWORK</span></a>
      <nav aria-label="Pools">${POOLS.map(p => `
        <a class="ab-pill" href="${LINKS[p.id]}" style="--ab-accent:${p.accent}"${p.id === current ? ' aria-current="page"' : ''}>
          <img src="${p.logo}" alt=""${p.round ? ' class="round"' : ''} onerror="this.style.visibility='hidden'">
          <span class="ab-txt"><span class="ab-nm">${p.name} <em>${p.year}</em></span><span class="ab-st" data-st="${p.id}"></span></span>
        </a>`).join('')}
      </nav></div>`;
    document.body.insertBefore(bar, document.body.firstChild);
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 120000);
  }

  async function sb(path, schema) {
    const headers = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
    if (schema) headers['Accept-Profile'] = schema;
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  const dayET = hoursBack => new Date(Date.now() - hoursBack * 3600000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 'S'}`;

  function set(id, text, live) {
    const el = document.querySelector(`#aasn-bar [data-st="${id}"]`);
    if (el) el.innerHTML = text ? (live ? '<span class="ab-live" aria-hidden="true"></span>' : '') + esc(text) : '';
  }

  async function aahlStatus() {
    const rows = await sb('config?id=eq.todaysGamesCache&select=data');
    const d = rows[0] && rows[0].data;
    if (!d || d.date !== dayET(5) || !(d.games || []).length) return ['NHL'];
    const g = d.games;
    const live = g.filter(x => x.state === 'live').length;
    if (live) return [plural(live, 'GAME') + ' LIVE', true];
    const left = g.filter(x => x.state !== 'final').length;
    if (left) return [plural(left, 'GAME') + ' TONIGHT'];
    return ['FINALS IN'];
  }

  async function aablStatus() {
    const today = dayET(6);
    const [cfg, live, sched] = await Promise.all([
      sb('config?select=signups_open,picks_locked,opening_day&order=season.desc&limit=1', 'aabl'),
      sb('live?select=game_date,games,updated_at&id=eq.1', 'aabl').catch(() => []),
      sb(`schedule?select=game_pk&game_date=eq.${today}&game_type=eq.R`, 'aabl').catch(() => [])
    ]);
    const L = live[0];
    if (L && L.game_date === today && Date.now() - new Date(L.updated_at).getTime() < 15 * 60000) {
      const n = (L.games || []).filter(x => x.state === 'Live').length;
      if (n) return [plural(n, 'GAME') + ' LIVE', true];
    }
    const c = cfg[0] || {};
    const locked = c.picks_locked || (c.opening_day && Date.now() >= new Date(c.opening_day).getTime());
    if (c.signups_open && !locked) return ['SIGN-UPS OPEN'];
    if (sched.length) return [plural(sched.length, 'GAME') + ' TODAY'];
    return ['MLB'];
  }

  function refresh() {
    aahlStatus().then(([t, l]) => set('aahl', t, l)).catch(() => set('aahl', 'NHL'));
    aablStatus().then(([t, l]) => set('aabl', t, l)).catch(() => set('aabl', 'MLB'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
