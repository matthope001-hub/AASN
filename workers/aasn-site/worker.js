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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
