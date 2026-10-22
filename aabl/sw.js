// AABL service worker — makes the site installable and keeps pages usable
// offline. Pages and data always come from the network first (fresh scores);
// the cached copy is only used when the network is down.
const CACHE = 'aabl-v1';
const CORE = ['./', 'index.html', 'base.css', 'nav.js', 'manifest.json', 'assets/aabl-badge.png', 'assets/BosoxSemibold.ttf'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Supabase, Worker, fonts: straight to network
  const isHeadshot = url.pathname.includes('/headshots/');
  if (isHeadshot) {                                       // headshots: cache first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then(res => {                  // everything else: network first
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
