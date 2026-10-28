// AAFL email reminders (GitHub Actions: .github/workflows/aafl-reminders.yml).
//   KIND=open  Tuesday morning: "Week N picks are open" to every human player.
//   KIND=lock  Thursday noon:   "Picks lock tonight" to players still missing picks.
// Players can turn reminders off on the Picks page (aafl_teams.email_reminders).
// Sending uses Resend (free tier). Needs repo secrets RESEND_API_KEY and AAFL_FROM
// (e.g. "AAFL <aafl@theaahl.ca>", a verified Resend sender). Without them it just logs and exits.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, KIND, SEASON (2026), RESEND_API_KEY, AAFL_FROM, DRY_RUN (1 = don't send)

const { SUPABASE_URL, SUPABASE_SERVICE_KEY: KEY, RESEND_API_KEY, AAFL_FROM } = process.env;
const KIND = process.env.KIND || 'open';
const SEASON = Number(process.env.SEASON || 2026);
const DRY = process.env.DRY_RUN === '1';
const SITE = 'https://aasn.theaahl.ca/aafl/';
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, opts = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
const fmt = d => new Date(d).toLocaleString('en-US', { timeZone: 'America/Toronto', weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' ET';

async function send(to, subject, text) {
  if (DRY || !RESEND_API_KEY || !AAFL_FROM) { console.log(`[not sent] ${to}: ${subject}`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AAFL_FROM, to: [to], subject, text })
  });
  if (!res.ok) console.error(`Send to ${to} failed: ${res.status} ${await res.text()}`); else console.log(`Sent to ${to}`);
}

async function main() {
  if (!RESEND_API_KEY || !AAFL_FROM) console.log('Email sending not set up yet (RESEND_API_KEY / AAFL_FROM secrets). Running as a dry run.');
  const week = await sb(`rpc/aafl_current_week`, { method: 'POST', body: JSON.stringify({ p_season: SEASON }) });
  const games = await sb(`aafl_games?select=id,kickoff&season=eq.${SEASON}&week=eq.${week}`);
  if (!games.length) { console.log('No games this week.'); return; }
  const lock = new Date(Math.min(...games.map(g => +new Date(g.kickoff))));
  if (Date.now() >= +lock) { console.log(`Week ${week} already locked.`); return; }

  const teams = await sb(`aafl_teams?select=id,name,invite_code&season=eq.${SEASON}&is_bot=eq.false&email_reminders=eq.true`);
  const invites = await sb(`aafl_invites?select=code,email,team_id&season=eq.${SEASON}`);
  const ids = games.map(g => g.id).join(',');
  const picks = teams.length ? await sb(`aafl_picks?select=team_id&game_id=in.(${ids})&team_id=in.(${teams.map(t => t.id).join(',')})`) : [];
  const count = {}; picks.forEach(p => { count[p.team_id] = (count[p.team_id] || 0) + 1; });

  // One email per person, listing all their teams (a person can have several entries).
  const byEmail = {};
  for (const t of teams) {
    const inv = invites.find(i => i.code === t.invite_code) || invites.find(i => i.team_id === t.id);
    if (!inv) continue;
    (byEmail[inv.email.toLowerCase()] = byEmail[inv.email.toLowerCase()] || []).push({ ...t, have: count[t.id] || 0 });
  }
  const n = games.length;
  for (const [email, list] of Object.entries(byEmail)) {
    const hi = list.length === 1 ? list[0].name : 'there';
    if (KIND === 'open') {
      const lines = list.length > 1 ? `\nYour teams: ${list.map(t => t.name).join(', ')}\n` : '';
      await send(email, `AAFL: Week ${week} picks are open`,
        `Hi ${hi},\n\nWeek ${week} picks are open: ${n} games.${lines}\nPicks lock at the first kickoff: ${fmt(lock)}.\n\nMake your picks: ${SITE}picks.html\n\n(Turn these emails off on the Picks page.)`);
    } else if (KIND === 'lock') {
      const missing = list.filter(t => t.have < n);
      if (!missing.length) continue;
      const lines = missing.map(t => `- ${t.name}: ${t.have} of ${n} picked`).join('\n');
      await send(email, `AAFL: Week ${week} picks lock tonight`,
        `Hi ${hi},\n\nStill to pick for Week ${week}:\n${lines}\n\nPicks lock at ${fmt(lock)}.\n\nFinish your picks: ${SITE}picks.html\n\n(Turn these emails off on the Picks page.)`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
