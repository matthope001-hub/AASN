// AABL player news puller - runs in GitHub Actions (Node 22, no dependencies).
// 1. Reads the pool's players (everyone in aabl.box_options) from Supabase.
// 2. Matches each to an ESPN player ID using ESPN MLB team rosters (name, then team as tiebreak).
// 3. Pulls RotoWire news from ESPN in batches of 25, keeps the newest 2 per player.
// 4. Upserts into aabl.player_news. Never touches any other table, and never AAHL.

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

const ESPN = 'https://site.api.espn.com/apis';
const ITEMS_PER_PLAYER = 2;
const BATCH = 25;

// Manual fixes for players the auto-match misses: { 'MLB id': 'ESPN id' }
const OVERRIDES = {
  '650333': '39572',   // Luis Arraez
  '643289': '35304',   // Mauricio Dubon
  '673548': '4142424', // Seiya Suzuki
  '646240': '33859',   // Rafael Devers
  '680777': '41587',   // Ryan Jeffers
  '664023': '34945',   // Ian Happ
  '668227': '36488',   // Randy Arozarena
  '670280': '38303',   // David Bednar
  '641343': '35013',   // Jake Bauers
  '664040': '39961',   // Brandon Lowe
};

// ESPN team abbreviations that differ from MLB's
const TEAM_FIX = { ARI: 'AZ', CHW: 'CWS', OAK: 'ATH', WSN: 'WSH' };

const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Accept-Profile': 'aabl', 'Content-Profile': 'aabl' };
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii)\b/g, '').replace(/[^a-z]/g, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) return await res.json();
      console.warn(`HTTP ${res.status} ${url}`);
    } catch (e) { console.warn(`Fetch error ${url}: ${e.message}`); }
    if (i < tries) await sleep(1500 * i);
  }
  return null;
}

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase read failed (${path}): ${res.status}`);
  return res.json();
}

async function loadPoolPlayers() {
  const opts = await sbGet('box_options?select=mlb_id');
  const ids = [...new Set(opts.map(o => o.mlb_id))];
  if (!ids.length) return [];
  const players = await sbGet(`players?select=mlb_id,full_name,team_abbr&mlb_id=in.(${ids.join(',')})`);
  return players.map(p => ({ id: String(p.mlb_id), name: p.full_name, team: p.team_abbr }));
}

async function loadEspnRosters() {
  const teamsJson = await getJson(`${ESPN}/site/v2/sports/baseball/mlb/teams`);
  const teams = teamsJson?.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team) || [];
  if (!teams.length) throw new Error('Could not load ESPN team list');

  const byName = new Map(); // normalized name -> [{ espnId, team }]
  for (const t of teams) {
    const roster = await getJson(`${ESPN}/site/v2/sports/baseball/mlb/teams/${t.id}/roster`);
    const groups = roster?.athletes || [];
    const athletes = groups.flatMap(g => (g.items ? g.items : [g]));
    const team = TEAM_FIX[t.abbreviation] || t.abbreviation;
    for (const a of athletes) {
      const key = norm(a.fullName || a.displayName);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ espnId: String(a.id), team });
    }
    await sleep(200);
  }
  return byName;
}

function matchPlayers(pool, byName) {
  const matched = [], unmatched = [];
  for (const p of pool) {
    if (OVERRIDES[p.id]) { matched.push({ ...p, espnId: OVERRIDES[p.id] }); continue; }
    const hits = byName.get(norm(p.name)) || [];
    const pick = hits.length === 1 ? hits[0] : hits.find(h => h.team === p.team);
    if (pick) matched.push({ ...p, espnId: pick.espnId });
    else unmatched.push(`${p.name} (${p.team || '-'}, MLB ${p.id})`);
  }
  return { matched, unmatched };
}

async function loadNews(matched) {
  const byEspn = new Map(); // espnId -> items[]
  let okBatches = 0;
  for (let i = 0; i < matched.length; i += BATCH) {
    const chunk = matched.slice(i, i + BATCH);
    const qs = chunk.map(p => `playerId=${p.espnId}`).join('&');
    const json = await getJson(`${ESPN}/fantasy/v2/games/flb/news/players?${qs}&limit=${chunk.length * 8}`);
    if (!json || !Array.isArray(json.feed)) continue;
    okBatches++;
    for (const it of json.feed) {
      if (it.type !== 'Rotowire' || it.premium) continue;
      const k = String(it.playerId);
      if (!byEspn.has(k)) byEspn.set(k, []);
      byEspn.get(k).push({ headline: it.headline, story: it.story || '', published: it.published });
    }
    await sleep(300);
  }
  return { byEspn, okBatches, totalBatches: Math.ceil(matched.length / BATCH) };
}

async function upsert(rows) {
  const res = await fetch(`${SB_URL}/rest/v1/player_news`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
}

const pool = await loadPoolPlayers();
if (!pool.length) { console.log('No pool players yet - nothing to do.'); process.exit(0); }
const byName = await loadEspnRosters();
const { matched, unmatched } = matchPlayers(pool, byName);
console.log(`Pool ${pool.length} | matched ${matched.length} | unmatched ${unmatched.length}`);

const { byEspn, okBatches, totalBatches } = await loadNews(matched);
if (okBatches === 0) { console.error('No news batches succeeded - leaving existing news untouched'); process.exit(1); }

const now = new Date().toISOString();
const rows = matched.map(p => {
  const items = (byEspn.get(p.espnId) || [])
    .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
    .slice(0, ITEMS_PER_PLAYER);
  return { mlb_id: Number(p.id), data: { espnId: p.espnId, items }, updated_at: now };
});
rows.push({ mlb_id: 0, data: { lastRun: now, matched: matched.length, unmatched, okBatches, totalBatches }, updated_at: now });

await upsert(rows);
const withNews = rows.filter(r => r.mlb_id && r.data.items.length).length;
console.log(`Saved ${rows.length - 1} players, ${withNews} with news (${okBatches}/${totalBatches} batches ok).`);
if (unmatched.length) console.log('Unmatched:\n  ' + unmatched.join('\n  '));
