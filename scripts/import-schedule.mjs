// AABL — import the MLB regular-season schedule into aabl.schedule.
// Runs in GitHub Actions (.github/workflows/import-schedule.yml).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SEASON (e.g. 2027)

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SEASON = Number(process.env.SEASON || 2027);
const MLB = 'https://statsapi.mlb.com/api/v1';

if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

function sbHeaders(extra = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json', ...extra };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  return h;
}

async function sbUpsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Profile': 'aabl', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows.slice(i, i + 500))
    });
    if (!res.ok) throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
  }
}

async function mlb(path) {
  const res = await fetch(`${MLB}${path}`);
  if (!res.ok) throw new Error(`MLB ${path}: ${res.status}`);
  return res.json();
}

async function main() {
  const teams = await mlb(`/teams?sportId=1&season=${SEASON}`);
  const abbr = new Map((teams.teams || []).map(t => [t.id, t.abbreviation]));

  const data = await mlb(`/schedule?sportId=1&season=${SEASON}&gameType=R&hydrate=venue`);
  const now = new Date().toISOString();
  const seen = new Set();
  const rows = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      if (seen.has(g.gamePk)) continue;   // a postponed game can be listed on two dates
      seen.add(g.gamePk);
      const away = g.teams && g.teams.away, home = g.teams && g.teams.home;
      rows.push({
        game_pk: g.gamePk,
        season: SEASON,
        game_date: g.officialDate || d.date,
        start_time: g.gameDate || null,
        game_type: g.gameType || 'R',
        away_abbr: abbr.get(away.team.id) || away.team.name,
        home_abbr: abbr.get(home.team.id) || home.team.name,
        venue: (g.venue && g.venue.name) || null,
        status: (g.status && g.status.detailedState) || null,
        away_score: away.score ?? null,
        home_score: home.score ?? null,
        doubleheader: g.doubleHeader || 'N',
        _tbd: !!(g.status && g.status.startTimeTBD),
        game_number: g.gameNumber || 1,
        updated_at: now
      });
    }
  }

  const summary = [`## AABL import — MLB ${SEASON} schedule`];
  if (!rows.length) {
    summary.push(`MLB has not published a ${SEASON} regular-season schedule yet. Nothing imported.`);
  } else {
    await sbUpsert('schedule', rows.map(({ _tbd, ...r }) => r), 'game_pk');
    const dates = rows.map(r => r.game_date).sort();
    summary.push(`Games: ${rows.length} · ${dates[0]} to ${dates[dates.length - 1]}`);
    summary.push(await setDeadline(rows));
  }
  console.log(summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) (await import('node:fs')).appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}

// Pick deadline = first pitch of the first regular-season game (Opening Day,
// including any international opener). MLB lists unset times as 3:33am ET
// (or flags startTimeTBD), so the deadline is only set once a real time is posted.
// It keeps following MLB's time until it passes, then never changes.
async function setDeadline(rows) {
  const firstDate = rows.map(r => r.game_date).sort()[0];
  const first = rows.filter(r => r.game_date === firstDate && r.start_time).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
  if (!first) return 'Deadline: no start time listed yet.';
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false }).format(new Date(first.start_time));
  if (first._tbd || et === '03:33') return `Deadline: first game (${firstDate}) has no real start time yet — not set.`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/config?select=opening_day,picks_locked&season=eq.${SEASON}`, { headers: sbHeaders({ 'Accept-Profile': 'aabl' }) });
  if (!res.ok) throw new Error(`config read: ${res.status} ${await res.text()}`);
  const [cfg] = await res.json();
  if (!cfg) return `Deadline: no ${SEASON} config row — not set.`;
  const now = Date.now();
  if (cfg.picks_locked || (cfg.opening_day && new Date(cfg.opening_day).getTime() <= now)) return 'Deadline: already passed — left as is.';
  if (new Date(first.start_time).getTime() <= now) return 'Deadline: first pitch is in the past — not set.';
  if (cfg.opening_day && new Date(cfg.opening_day).getTime() === new Date(first.start_time).getTime()) return `Deadline: unchanged (${first.start_time}).`;
  const up = await fetch(`${SUPABASE_URL}/rest/v1/config?season=eq.${SEASON}`, {
    method: 'PATCH', headers: sbHeaders({ 'Content-Profile': 'aabl', Prefer: 'return=minimal' }),
    body: JSON.stringify({ opening_day: first.start_time })
  });
  if (!up.ok) throw new Error(`config update: ${up.status} ${await up.text()}`);
  return `Deadline set to first pitch: ${first.away_abbr} @ ${first.home_abbr}, ${first.start_time} (${et} ET).`;
}

main().catch(err => { console.error(err); process.exit(1); });
