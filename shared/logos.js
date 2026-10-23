/* AASN team logos — shared by the AAHL, AABL and Death Pool sites.
 *   await aasnLogos.load('aabl')          -> loads that pool's logos (cached for the page)
 *   aasnLogos.badge('aabl', id, name, px) -> <img> if the team has a logo, else an initials circle
 *   aasnLogos.choose({ pool, team, proof }) -> small dialog: upload a photo OR paste a link; resolves { success, url }
 *   aasnLogos.pick({ pool, team, proof }) -> file picker -> square crop -> upload
 *   aasnLogos.fromUrl({ pool, team, proof, url }) -> the server copies the image at that link
 *   aasnLogos.remove({ pool, team, proof })
 * proof = { token } | { accessToken } | { email } — whatever the page already uses for My Team.
 * Self-contained: carries its own Supabase read key so the AAHL site can load it too. */
(function () {
  if (window.aasnLogos) return;
  const API = 'https://aasn-api.matt-hope001.workers.dev';
  const SB_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';
  const maps = {}, loading = {};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#00D4FF', '#F06A70', '#8BE37A', '#FFB800', '#B79CFF', '#FF9F43', '#4FD1C5', '#E879F9'];

  function load(pool) {
    if (maps[pool]) return Promise.resolve(maps[pool]);
    if (!loading[pool]) {
      loading[pool] = fetch(`${SB_URL}/rest/v1/team_logos?select=team_id,url&pool=eq.${encodeURIComponent(pool)}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } })
        .then(r => r.ok ? r.json() : []).catch(() => [])
        .then(rows => (maps[pool] = new Map(rows.map(r => [String(r.team_id), r.url]))));
    }
    return loading[pool];
  }
  function url(pool, id) { return maps[pool] ? maps[pool].get(String(id)) || null : null; }

  function initials(name) {
    const w = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : (w[0] || '')[1] || '')).toUpperCase();
  }
  function color(name) { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }

  function badge(pool, id, name, px = 24) {
    const u = url(pool, id);
    const box = `width:${px}px;height:${px}px;border-radius:50%;flex:none;display:inline-block;vertical-align:middle;margin-right:8px`;
    if (u) return `<img class="aasn-logo" src="${esc(u)}" alt="" loading="lazy" style="${box};object-fit:cover;background:#0B0D10;border:1px solid #2E353D" onerror="this.remove()">`;
    const c = color(name);
    return `<span class="aasn-logo" aria-hidden="true" style="${box};line-height:${px}px;text-align:center;font:700 ${Math.round(px * 0.42)}px 'JetBrains Mono',monospace;color:${c};background:#0B0D10;border:1px solid ${c}55">${esc(initials(name))}</span>`;
  }

  // Square-crop + shrink in the browser (256x256 WebP) so uploads are small.
  function toSquare(file) {
    return new Promise((resolve, reject) => {
      if (!/^image\/(png|jpe?g|webp|gif|heic|heif)$/i.test(file.type || '') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name || '')) { reject(new Error('Please choose a JPG, PNG or WebP image.')); return; }
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const cv = document.createElement('canvas'); cv.width = cv.height = 256;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
        let out = cv.toDataURL('image/webp', 0.85);
        if (!out.startsWith('data:image/webp')) out = cv.toDataURL('image/jpeg', 0.85);   // older Safari
        URL.revokeObjectURL(img.src);
        resolve(out);
      };
      img.onerror = () => reject(new Error("That image couldn't be read. Try a JPG or PNG."));
      img.src = URL.createObjectURL(file);
    });
  }

  async function send(body) {
    const res = await fetch(API + '/logo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({ success: false, error: 'Something went wrong.' }));
    if (out.success) {
      if (!maps[body.pool]) maps[body.pool] = new Map();
      if (out.url) maps[body.pool].set(String(body.team), out.url); else maps[body.pool].delete(String(body.team));
    }
    return out;
  }

  function pick({ pool, team, proof }) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp';
      input.style.display = 'none';
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        input.remove();
        if (!f) { resolve({ success: false, cancelled: true }); return; }
        try { resolve(await send({ action: 'upload', pool, team, image: await toSquare(f), ...(proof || {}) })); }
        catch (e) { resolve({ success: false, error: e.message }); }
      });
      document.body.appendChild(input);
      input.click();
    });
  }
  const remove = ({ pool, team, proof }) => send({ action: 'remove', pool, team, ...(proof || {}) });
  const fromUrl = ({ pool, team, proof, url }) => send({ action: 'upload', pool, team, imageUrl: url, ...(proof || {}) });

  // Upload-or-link chooser. Styled to sit on any of the three sites' dark themes.
  function choose(args) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = `<div role="dialog" aria-modal="true" aria-label="Team logo" style="width:min(420px,100%);background:#12161B;border:1px solid #2E353D;border-radius:8px;padding:18px;color:#E8ECF0;font-family:'Barlow Condensed',system-ui,sans-serif">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b style="font-size:22px;letter-spacing:1px">TEAM LOGO</b><button type="button" data-x aria-label="Close" style="min-width:44px;min-height:44px;background:none;border:0;color:#9AA4AF;font-size:26px;cursor:pointer">×</button></div>
        <button type="button" data-file style="width:100%;min-height:46px;background:#00D4FF;color:#0B0D10;border:0;border-radius:4px;font:800 17px 'Barlow Condensed',sans-serif;letter-spacing:1px;cursor:pointer">UPLOAD A PHOTO</button>
        <div style="text-align:center;margin:12px 0;font:12px 'JetBrains Mono',monospace;color:#9AA4AF">— OR PASTE A LINK TO AN IMAGE —</div>
        <form data-form style="display:flex;gap:8px"><label style="flex:1"><span style="position:absolute;left:-9999px">Image link</span><input data-url type="url" inputmode="url" placeholder="https://…/logo.png" required style="width:100%;min-height:44px;padding:0 10px;background:#0B0D10;border:1px solid #2E353D;border-radius:4px;color:#E8ECF0;font:14px 'JetBrains Mono',monospace;box-sizing:border-box"></label><button type="submit" style="min-height:44px;padding:0 16px;background:transparent;border:1px solid #00D4FF;color:#00D4FF;border-radius:4px;font:800 16px 'Barlow Condensed',sans-serif;cursor:pointer">USE LINK</button></form>
        <p data-msg role="status" style="min-height:18px;margin-top:10px;font:12px 'JetBrains Mono',monospace;color:#FF8A7A"></p>
        <p style="font:11px 'JetBrains Mono',monospace;color:#9AA4AF;line-height:1.5">Tip: right-click a logo on a website and choose "Copy image address". JPG, PNG, WebP or GIF. Square images look best.</p></div>`;
      const done = out => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(out); };
      const onKey = e => { if (e.key === 'Escape') done({ success: false, cancelled: true }); };
      document.addEventListener('keydown', onKey);
      const msg = t => { ov.querySelector('[data-msg]').textContent = t || ''; };
      ov.addEventListener('click', async e => {
        if (e.target === ov || e.target.closest('[data-x]')) return done({ success: false, cancelled: true });
        if (e.target.closest('[data-file]')) {
          const out = await pick(args);
          if (out.cancelled) return;
          if (out.success) done(out); else msg(out.error);
        }
      });
      ov.querySelector('[data-form]').addEventListener('submit', async e => {
        e.preventDefault();
        const url = ov.querySelector('[data-url]').value.trim();
        msg(''); ov.querySelector('[data-msg]').style.color = '#9AA4AF'; msg('Fetching…');
        const out = await fromUrl({ ...args, url });
        ov.querySelector('[data-msg]').style.color = '#FF8A7A';
        if (out.success) done(out); else msg(out.error || 'That link didn\'t work.');
      });
      document.body.appendChild(ov);
      ov.querySelector('[data-file]').focus();
    });
  }

  window.aasnLogos = { load, url, badge, pick, fromUrl, choose, remove };
})();
