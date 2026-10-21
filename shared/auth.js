/**
 * auth.js — optional AASN sign-in (Supabase Auth, same accounts as AAHL).
 *
 * Sign in with Google, Microsoft, Yahoo or an emailed link. Signing in is
 * never required: it just lists every team entered with your email(s) on
 * My Team, so you don't need your entry ID or email link. The Worker checks
 * the sign-in with Supabase before showing anything.
 *
 * Hooks every header button with class "signin" (or id "signin-btn").
 * Exposes window.aasnAuth = { session(), accessToken(), onChange(fn), open(), signOut() }.
 * Needs config.js (AASN_SUPABASE_URL, AASN_SUPABASE_KEY) loaded first.
 */
(function () {
  const PROVIDERS = [
    { id: 'google', label: 'Google', icon: 'G', bg: '#ffffff', fg: '#000000' },
    { id: 'azure', label: 'Hotmail / Outlook', icon: 'M', bg: '#00a4ef', fg: '#ffffff' },
    { id: 'custom:yahoo', label: 'Yahoo', icon: 'Y', bg: '#6001d2', fg: '#ffffff' }
  ];
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  const inAabl = /\/aabl\//.test(location.pathname);
  const MY_TEAMS = inAabl ? 'myteam.html' : 'aabl/myteam.html';

  let client = null, session = null;
  const listeners = [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const css = `
  .aasn-auth-ov { position: fixed; inset: 0; background: rgba(4,12,24,.8); display: none; align-items: center; justify-content: center; z-index: 300; padding: 16px; }
  .aasn-auth-ov.on { display: flex; }
  .aasn-auth { width: 100%; max-width: 380px; background: #0C2340; border: 1px solid #25446E; border-top: 4px solid #BD3039; color: #E8EDF1; padding: 22px; position: relative; font-family: 'Barlow Condensed', sans-serif; }
  .aasn-auth h2 { font-size: 24px; font-weight: 800; letter-spacing: 1px; margin: 0 0 4px; }
  .aasn-auth p { color: #A9B8CC; font-size: 15px; margin: 0 0 12px; }
  .aasn-auth-x { position: absolute; top: 6px; right: 8px; width: 44px; height: 44px; background: none; border: 0; color: #A9B8CC; font-size: 28px; cursor: pointer; }
  .aasn-auth-btn { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 46px; margin-top: 8px; padding: 0 14px; background: #132E52; color: #E8EDF1; border: 1px solid #25446E; font: 600 16px 'Barlow Condensed', sans-serif; cursor: pointer; text-align: left; }
  .aasn-auth-btn:hover { border-color: #F06A70; }
  .aasn-auth-ic { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font: 700 13px 'JetBrains Mono', monospace; flex-shrink: 0; }
  .aasn-auth-or { text-align: center; color: #A9B8CC; font: 12px 'JetBrains Mono', monospace; margin: 14px 0 6px; }
  .aasn-auth input { width: 100%; min-height: 44px; padding: 0 12px; background: #132E52; border: 1px solid #25446E; color: #E8EDF1; font: 16px 'Barlow Condensed', sans-serif; box-sizing: border-box; }
  .aasn-auth .go { width: 100%; min-height: 44px; margin-top: 8px; background: #BD3039; border: 0; color: #fff; font: 700 16px 'Barlow Condensed', sans-serif; letter-spacing: .5px; cursor: pointer; }
  .aasn-auth .msg { font: 12px 'JetBrains Mono', monospace; margin-top: 10px; min-height: 16px; }
  .aasn-auth .msg.ok { color: #7EE2A8; } .aasn-auth .msg.err { color: #FF9EA2; }
  .aasn-auth .note { font-size: 13px; color: #A9B8CC; margin-top: 12px; }
  .aasn-user-menu { position: absolute; z-index: 120; min-width: 200px; background: #132E52; border: 1px solid #25446E; border-top: 3px solid #BD3039; padding: 6px 0; box-shadow: 0 12px 28px rgba(0,0,0,.45); }
  .aasn-user-menu .who { padding: 6px 16px 8px; font: 12px 'JetBrains Mono', monospace; color: #A9B8CC; border-bottom: 1px solid #25446E; margin-bottom: 4px; word-break: break-all; }
  .aasn-user-menu a, .aasn-user-menu button { display: flex; align-items: center; width: 100%; min-height: 42px; padding: 0 16px; background: none; border: 0; color: #E8EDF1; text-decoration: none; font: 600 16px 'Barlow Condensed', sans-serif; cursor: pointer; text-align: left; }
  .aasn-user-menu a:hover, .aasn-user-menu button:hover { background: #1A3860; color: #F06A70; }`;

  function loadSdk() {
    return new Promise(resolve => {
      if (window.supabase && window.supabase.createClient) return resolve(true);
      const s = document.createElement('script');
      s.src = SDK; s.async = true;
      s.onload = () => resolve(!!(window.supabase && window.supabase.createClient));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function getClient() {
    if (client) return client;
    if (!(await loadSdk())) return null;
    client = window.supabase.createClient(AASN_SUPABASE_URL, AASN_SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'aasn-auth' }
    });
    client.auth.onAuthStateChange((event, s) => {
      const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
      session = s;
      paintButtons();
      if (changed || event === 'SIGNED_OUT') listeners.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } });
    });
    const { data } = await client.auth.getSession();
    session = data ? data.session : null;
    return client;
  }

  const returnUrl = () => location.origin + location.pathname;

  function overlay() {
    let ov = document.getElementById('aasn-auth-ov');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'aasn-auth-ov'; ov.className = 'aasn-auth-ov';
    ov.innerHTML = `<div class="aasn-auth" role="dialog" aria-modal="true" aria-labelledby="aasn-auth-title">
      <button type="button" class="aasn-auth-x" aria-label="Close">×</button>
      <h2 id="aasn-auth-title">SIGN IN</h2>
      <p>Optional — see every team on your email in one place. Use the account with the email you entered with.</p>
      ${PROVIDERS.map(p => `<button type="button" class="aasn-auth-btn" data-provider="${p.id}"><span class="aasn-auth-ic" style="background:${p.bg};color:${p.fg}">${p.icon}</span>Continue with ${esc(p.label)}</button>`).join('')}
      <div class="aasn-auth-or">— OR GET A SIGN-IN LINK BY EMAIL —</div>
      <form class="aasn-auth-email" novalidate><label for="aasn-auth-email" style="position:absolute;left:-9999px">Email</label>
        <input id="aasn-auth-email" type="email" autocomplete="email" placeholder="you@example.com"><button type="submit" class="go">EMAIL ME A LINK</button></form>
      <div class="msg" role="status"></div>
      <div class="note">Same account as the AAHL. You can still manage a team without signing in.</div>
    </div>`;
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.aasn-auth-x')) close(); });
    ov.querySelectorAll('[data-provider]').forEach(b => b.addEventListener('click', async () => {
      const c = await getClient(); if (!c) return msg('Sign-in is unavailable right now.', false);
      const p = b.dataset.provider;
      const { error } = await c.auth.signInWithOAuth({ provider: p, options: { redirectTo: returnUrl(), scopes: p === 'azure' ? 'email openid profile' : undefined } });
      if (error) msg(error.message, false);
    }));
    ov.querySelector('.aasn-auth-email').addEventListener('submit', async e => {
      e.preventDefault();
      const email = ov.querySelector('#aasn-auth-email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return msg('Enter a valid email.', false);
      const c = await getClient(); if (!c) return msg('Sign-in is unavailable right now.', false);
      const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl() } });
      msg(error ? error.message : 'Check your email for a sign-in link.', !error);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); closeMenu(); } });
    document.body.appendChild(ov);
    return ov;
  }
  function msg(t, ok) { const m = document.querySelector('#aasn-auth-ov .msg'); if (m) { m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); } }
  function open() { const ov = overlay(); ov.classList.add('on'); msg('', true); ov.querySelector('[data-provider]').focus(); }
  function close() { const ov = document.getElementById('aasn-auth-ov'); if (ov) ov.classList.remove('on'); }

  function closeMenu() { const m = document.getElementById('aasn-user-menu'); if (m) m.remove(); }
  function showMenu(btn) {
    if (document.getElementById('aasn-user-menu')) return closeMenu();
    const r = btn.getBoundingClientRect();
    const m = document.createElement('div');
    m.id = 'aasn-user-menu'; m.className = 'aasn-user-menu';
    m.style.top = (window.scrollY + r.bottom + 6) + 'px';
    m.style.left = Math.max(8, window.scrollX + r.right - 220) + 'px';
    m.innerHTML = `<div class="who">${esc(session.user.email || 'Signed in')}</div><a href="${MY_TEAMS}">⚾ My Teams</a><button type="button" data-out>Sign out</button>`;
    m.querySelector('[data-out]').addEventListener('click', signOut);
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target) && e.target !== btn) { closeMenu(); document.removeEventListener('click', off); } }), 0);
  }

  function buttons() { return [...document.querySelectorAll('button.signin, #signin-btn')].filter(b => b.id !== 'logout'); }
  function paintButtons() {
    buttons().forEach(b => {
      if (session && session.user) {
        const name = (session.user.user_metadata && (session.user.user_metadata.full_name || session.user.user_metadata.name)) || session.user.email || 'Account';
        b.textContent = String(name).split(/[\s@]/)[0].toUpperCase().slice(0, 14) + ' ▾';
        b.setAttribute('aria-label', 'Account menu');
      } else {
        b.textContent = 'SIGN IN';
        b.removeAttribute('aria-label');
      }
    });
  }

  async function signOut() {
    closeMenu();
    const c = await getClient();
    if (c) await c.auth.signOut();
  }

  function init() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    buttons().forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      if (session && session.user) showMenu(b); else open();
    }));
    // Restore a session (or finish a redirect back from Google/Microsoft/Yahoo/email link).
    getClient().then(() => { paintButtons(); listeners.forEach(fn => { try { fn(session); } catch (e) { console.error(e); } }); });
  }

  window.aasnAuth = {
    session: () => session,
    async accessToken() { const c = await getClient(); if (!c) return null; const { data } = await c.auth.getSession(); session = data ? data.session : null; return session ? session.access_token : null; },
    onChange(fn) { listeners.push(fn); },
    ready: () => getClient(),
    open, signOut
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
