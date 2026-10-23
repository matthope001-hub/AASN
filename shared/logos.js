/* AASN team logos — shared by the AAHL, AABL and Death Pool sites.
 *   await aasnLogos.load('aabl')          -> loads that pool's logos (cached for the page)
 *   aasnLogos.badge('aabl', id, name, px) -> <img> if the team has a logo, else an initials circle
 *   aasnLogos.pick({ pool, team, proof }) -> file picker -> square crop -> upload; resolves { success, url }
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

  window.aasnLogos = { load, url, badge, pick, remove };
})();
