/* AASN pre-launch gate.
 * <script src="../shared/gate.js" data-gate="aabl"></script>  (in <head>, before anything else)
 *   -> the page stays hidden unless the commissioner is signed in; everyone else sees a
 *      "Coming 2027" screen with a sign-in button.
 * <script src="shared/gate.js"></script> (no data-gate) -> only exposes window.aasnIsAdmin().
 * Commissioner emails are stored only as SHA-256 hashes. This is a front-door lock for an
 * unlaunched pool, not a security boundary: the public data itself is still readable.
 * To open a pool to everyone, remove its data-gate script tags (or set OPEN below). */
(function () {
  const OPEN = { aabl: false, aafl: false };
  // Lock-screen text per pool.
  const POOLS = {
    aabl: { title: 'AABL · COMING 2027', text: 'The Angry Alpaca Baseball League opens before the 2027 MLB season. Check back soon.', badge: 'aabl/assets/aabl-badge.png', who: 'the AABL', bg: '#0C2340', btn: '#BD3039' },
    aafl: { title: 'AAFL · COMING SOON', text: 'The Angry Alpaca Football League trial season opens soon, by invite only. Check back soon.', badge: 'aafl/assets/aafl-logo.png', who: 'the AAFL', bg: '#07101F', btn: '#003594' }
  };
  const ADMIN_HASHES = [
    '151d5c340cdf9463eb6a300de214c14dcbd2d6924ecae1711be2c870147b36f8',
    '4f6a82e70c1b2065606d552344f2606a9cc793196633b9d76b360900a1d52514'
  ];
  const AUTH_KEYS = ['aasn-auth', 'aahl-auth'];
  const me = document.currentScript;
  const gate = ((me && me.dataset.gate) || '').toLowerCase();
  const P = POOLS[gate] || POOLS.aabl;

  function signedInEmail() {
    for (const k of AUTH_KEYS) {
      try {
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        const u = v && (v.user || (v.currentSession && v.currentSession.user));
        if (u && u.email) return String(u.email).trim().toLowerCase();
      } catch (e) { /* ignore */ }
    }
    return '';
  }
  async function isAdmin() {
    const email = signedInEmail();
    if (!email || !(window.crypto && crypto.subtle)) return false;
    try {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
      return ADMIN_HASHES.includes([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''));
    } catch (e) { return false; }
  }
  window.aasnIsAdmin = isAdmin;
  if (!gate || OPEN[gate]) return;

  // Hide the page until we know who's looking.
  const root = document.documentElement;
  root.classList.add('aasn-gate-wait');
  const st = document.createElement('style');
  st.textContent = `
    html.aasn-gate-wait body { visibility: hidden; }
    #aasn-gate { visibility: visible; position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px; background: ${P.bg}; color: #E8EDF1; font-family: 'Barlow Condensed', system-ui, sans-serif; text-align: center; }
    #aasn-gate .g-in { max-width: 440px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
    #aasn-gate img { width: 120px; height: 120px; }
    #aasn-gate h1 { font-family: 'Bosox', 'Barlow Condensed', serif; font-weight: 400; font-size: 40px; line-height: 1; }
    #aasn-gate p { font-size: 18px; color: #A9B8CC; line-height: 1.4; }
    #aasn-gate .g-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    #aasn-gate a, #aasn-gate button { min-height: 46px; display: inline-flex; align-items: center; padding: 0 22px; font: 700 17px 'Barlow Condensed', sans-serif; letter-spacing: 1px; text-decoration: none; cursor: pointer; border-radius: 3px; }
    #aasn-gate a { background: ${P.btn}; color: #fff; border: 0; }
    #aasn-gate button { background: transparent; color: #E8EDF1; border: 1px solid #3A5A88; }
    #aasn-gate small { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A9B8CC; }`;
  document.head.appendChild(st);

  function showLock() {
    if (document.getElementById('aasn-gate')) return;
    const g = document.createElement('div');
    g.id = 'aasn-gate';
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-label', P.title);
    const base = location.pathname.replace(new RegExp('/' + gate + '/.*$'), '/');
    g.innerHTML = `<div class="g-in">
      <img src="${base}${P.badge}" alt="" onerror="this.remove()">
      <h1>${P.title}</h1>
      <p>${P.text}</p>
      <div class="g-row"><a href="${base}">AASN HOME</a><button type="button" id="aasn-gate-signin">COMMISSIONER SIGN IN</button></div>
      <small id="aasn-gate-msg"></small></div>`;
    document.body.appendChild(g);
    g.querySelector('#aasn-gate-signin').addEventListener('click', () => {
      if (window.aasnAuth && aasnAuth.open) aasnAuth.open();
    });
  }
  function unlock() {
    const g = document.getElementById('aasn-gate'); if (g) g.remove();
    root.classList.remove('aasn-gate-wait');
  }
  async function check() {
    if (await isAdmin()) { unlock(); return true; }
    return false;
  }

  async function start() {
    if (await check()) return;
    // Back from a Google/Microsoft/Yahoo/email sign-in? Let auth.js finish first.
    const returning = /access_token=|[?&]code=/.test(location.hash + location.search);
    if (window.aasnAuth && aasnAuth.ready) {
      if (returning) { try { await aasnAuth.ready(); } catch (e) { /* ignore */ } if (await check()) return; }
      aasnAuth.onChange(async () => {
        if (!(await check())) {
          const m = document.getElementById('aasn-gate-msg');
          if (m && signedInEmail()) m.textContent = 'Signed in as ' + signedInEmail() + ' — ' + P.who + ' is commissioner-only for now.';
        }
      });
    }
    showLock();
    const m = document.getElementById('aasn-gate-msg');
    if (m && signedInEmail()) m.textContent = 'Signed in as ' + signedInEmail() + ' — ' + P.who + ' is commissioner-only for now.';
  }
  // auth.js loads near the end of <body>; wait for the page to finish parsing.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.addEventListener('storage', () => { check(); });
})();
