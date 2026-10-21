// Shared AASN config (same Supabase project as AAHL; anon key is public by design)
const AASN_SUPABASE_URL = 'https://tetgrmgurobacdohhiby.supabase.co';
const AASN_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRldGdybWd1cm9iYWNkb2hoaWJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc4MTYsImV4cCI6MjEwNDU0MzgxNn0.Jn0MdAdYslGv7znS0DFiSUjlZ6rpw0qsvQwiNq63vWk';

// AASN member-saves API (Cloudflare Worker). Set once the Worker is deployed.
const AASN_API_URL = '';

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
