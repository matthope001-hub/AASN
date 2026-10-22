// Shared AASN config (same Supabase project as AAHL; anon key is public by design)
const AASN_SUPABASE_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
const AASN_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';

// AASN member-saves API (Cloudflare Worker). Set once the Worker is deployed.
const AASN_API_URL = 'https://aasn-api.matt-hope001.workers.dev';

// Read rows from Supabase REST. schema: 'public' or 'aabl'.
async function aasnSelect(table, query = 'select=*', schema = 'public') {
  const res = await fetch(`${AASN_SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: AASN_SUPABASE_KEY,
      Authorization: `Bearer ${AASN_SUPABASE_KEY}`,
      'Accept-Profile': schema
    }
  });
  if (!res.ok) throw new Error(`${table}: ${res.status}`);
  return res.json();
}

// Count rows without downloading them (returns a number, or null if unavailable).
async function aasnCount(table, filter = '', schema = 'public') {
  const res = await fetch(`${AASN_SUPABASE_URL}/rest/v1/${table}?select=*${filter ? '&' + filter : ''}`, {
    method: 'HEAD',
    headers: { apikey: AASN_SUPABASE_KEY, Authorization: `Bearer ${AASN_SUPABASE_KEY}`, 'Accept-Profile': schema, Prefer: 'count=exact' }
  });
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return res.ok && Number.isFinite(total) ? total : null;
}

// Thin loading bar across the top of the page while data requests are running.
(function () {
  if (window.__aasnBar || !window.fetch) return;
  window.__aasnBar = true;
  let busy = 0, bar = null, hideT = null;
  function el() {
    if (bar || !document.body) return bar;
    bar = document.createElement('div');
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;width:0;z-index:10000;background:#BD3039;box-shadow:0 0 6px #BD3039;opacity:0;transition:width .4s ease,opacity .3s ease;pointer-events:none';
    document.body.appendChild(bar);
    return bar;
  }
  function start() {
    busy++; clearTimeout(hideT);
    const b = el(); if (!b) return;
    b.style.opacity = '1'; b.style.width = Math.min(90, 30 + busy * 15) + '%';
  }
  function done() {
    busy = Math.max(0, busy - 1);
    if (busy) return;
    const b = el(); if (!b) return;
    b.style.width = '100%';
    hideT = setTimeout(() => { b.style.opacity = '0'; setTimeout(() => { if (!busy) b.style.width = '0'; }, 300); }, 200);
  }
  const orig = window.fetch;
  window.fetch = function () {
    start();
    return orig.apply(this, arguments).finally(done);
  };
})();
