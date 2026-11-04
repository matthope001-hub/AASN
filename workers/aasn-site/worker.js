// AASN site front Worker (aasn-site / aasn-site-next).
// Files changed after the move off GitHub live in KV (binding SITE_FILES), keyed by path, e.g. "/deathpool/dp.js".
// Everything else is served unchanged: from the site's own static files (ASSETS binding) on the live site,
// or fetched from the live site (ORIGIN) on the side-by-side test copy.
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  ico: 'image/x-icon', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2', webmanifest: 'application/manifest+json'
};
const typeOf = p => TYPES[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

// AABL headshots: anything not already in the site's files is made on demand from MLB's photo with
// Cloudflare's background removal (Images "segment=foreground"), then kept in KV.
// Only players in the current AABL pool (Supabase aabl.box_options) are allowed, so random ids can't use up
// the free 5,000 transformations a month.
const SUPABASE_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';
let pool = null, poolAt = 0;
async function poolIds() {
  if (!pool || Date.now() - poolAt > 600000) {
    const s = await fetch(SUPABASE_URL + '/rest/v1/config?select=season&order=season.desc&limit=1', { headers: { apikey: SUPABASE_ANON, 'Accept-Profile': 'aabl' } }).then(r => r.json());
    const season = s && s[0] && s[0].season;
    const rows = season ? await fetch(SUPABASE_URL + '/rest/v1/box_options?select=mlb_id&season=eq.' + season, { headers: { apikey: SUPABASE_ANON, 'Accept-Profile': 'aabl' } }).then(r => r.json()) : [];
    pool = new Set((Array.isArray(rows) ? rows : []).map(r => String(r.mlb_id)));
    poolAt = Date.now();
  }
  return pool;
}
async function makeCutout(pid) {
  const src = 'https://img.mlbstatic.com/mlb-photos/image/upload/w_426,q_auto:best/v1/people/' + pid + '/headshot/67/current';
  const r = await fetch(src, { cf: { image: { segment: 'foreground', width: 300, height: 300, fit: 'scale-down', format: 'png' } } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.startsWith('image/')) return null;
  return r.arrayBuffer();
}
async function headshot(pid, preview, env, ctx) {
  const key = '/aabl/headshots/' + pid + '.png';
  const png = h => new Headers({ 'Content-Type': 'image/png', 'Cache-Control': h, 'x-aasn-source': 'cutout' });
  if (!preview) {
    const saved = await env.SITE_FILES.get(key, { type: 'arrayBuffer', cacheTtl: 3600 });
    if (saved) return new Response(saved, { headers: png('public, max-age=86400') });
  }
  if (!(await poolIds()).has(pid)) return new Response('Not found', { status: 404 });
  const buf = await makeCutout(pid);
  if (!buf) return new Response('Not found', { status: 404 });  // the site falls back to the original photo
  if (!preview) ctx.waitUntil(env.SITE_FILES.put(key, buf, { metadata: { type: 'image/png', source: 'cloudflare-segment', updated: new Date().toISOString() } }));
  return new Response(buf, { headers: png(preview ? 'no-store' : 'public, max-age=86400') });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const hs = url.pathname.match(/^\/aabl\/headshots(-preview)?\/(\d{4,7})\.png$/);
    if (hs && env.SITE_FILES && request.method === 'GET') return headshot(hs[2], !!hs[1], env, ctx);
    if (request.method === 'GET' || request.method === 'HEAD') {
      const hit = await fromKv(env, decodeURIComponent(url.pathname), url);
      if (hit) return request.method === 'HEAD' ? new Response(null, { headers: hit.headers }) : hit;
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    const origin = (env.ORIGIN || 'https://aasn.theaahl.ca') + url.pathname + url.search;
    const res = await fetch(origin, { method: request.method, headers: request.headers, redirect: 'manual' });
    const out = new Response(res.body, res);
    const loc = out.headers.get('Location');
    if (loc) out.headers.set('Location', loc.replace(env.ORIGIN || 'https://aasn.theaahl.ca', url.origin));
    out.headers.set('x-aasn-source', 'live');
    return out;
  }
};

// Same lookups as the static files: /x/ -> /x/index.html, /x -> /x.html or /x/index.html.
// The list of changed files ("__index" in KV) is read at most once a minute per server, so requests for
// unchanged files never touch KV.
let index = null, indexAt = 0;
async function changedFiles(env) {
  if (!index || Date.now() - indexAt > 60000) {
    const list = await env.SITE_FILES.get('__index', { type: 'json', cacheTtl: 60 });
    index = new Set(Array.isArray(list) ? list : []);
    indexAt = Date.now();
  }
  return index;
}

async function fromKv(env, path, url) {
  if (!env.SITE_FILES) return null;
  const changed = await changedFiles(env);
  if (!changed.size) return null;
  const tries = (path.endsWith('/') ? [path + 'index.html'] : [path, path + '.html', path + '/index.html']).filter(k => changed.has(k));
  for (const key of tries) {
    const { value, metadata } = await env.SITE_FILES.getWithMetadata(key, { type: 'arrayBuffer', cacheTtl: 60 });
    if (value === null) continue;
    if (key === path + '/index.html') return Response.redirect(new URL(path + '/' + url.search, url.origin).toString(), 307);
    const headers = new Headers({
      'Content-Type': (metadata && metadata.type) || typeOf(key),
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'x-aasn-source': 'kv'
    });
    if (metadata && metadata.sha) headers.set('ETag', '"' + metadata.sha + '"');
    return new Response(value, { headers });
  }
  return null;
}
