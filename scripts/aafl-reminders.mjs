import { htmlEmail, textEmail, UNSUB, unsubHeaders } from './aafl-email.mjs';

// AAFL email reminders (GitHub Actions: .github/workflows/aafl-reminders.yml).
//   KIND=open  Tuesday morning: "Week N picks are open" to every human player.
//   KIND=lock  Thursday noon:   "Picks lock tonight" to players still missing picks.
// Players can turn reminders off on the Picks page (aafl_teams.email_reminders).
// Sending, either way (free):
//   * Gmail: repo secrets GMAIL_USER (e.g. matt.hope001@gmail.com) and GMAIL_APP_PASSWORD
//     (a Google "App password", needs 2-Step Verification). Emails come from that Gmail.
//   * Resend: repo secrets RESEND_API_KEY and AAFL_FROM ("AAFL <aafl@theaahl.ca>", verified sender).
// Gmail is used when its secrets are set. With neither, it's a dry run that just logs.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, KIND, SEASON (2026), GMAIL_USER, GMAIL_APP_PASSWORD, RESEND_API_KEY, AAFL_FROM, DRY_RUN (1 = don't send)

const { SUPABASE_URL, SUPABASE_SERVICE_KEY: KEY, RESEND_API_KEY, AAFL_FROM, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const USE_GMAIL = !!(GMAIL_USER && GMAIL_APP_PASSWORD);
const CAN_SEND = USE_GMAIL || !!(RESEND_API_KEY && AAFL_FROM);
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

let mailer = null;
async function send(to, subject, msg) {
  const text = typeof msg === 'string' ? msg : textEmail(msg);
  const html = typeof msg === 'string' ? undefined : htmlEmail(msg);
  const headers = unsubHeaders(typeof msg === 'string' ? null : msg.unsub);
  if (DRY || !CAN_SEND) { console.log(`::warning::Not sent (${DRY ? 'dry run' : 'email secrets not set'}): ${to}: ${subject}`); return; }
  if (USE_GMAIL) {
    if (!mailer) {
      const nodemailer = (await import('nodemailer')).default;
      mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER.trim(), pass: GMAIL_APP_PASSWORD.replace(/[^A-Za-z0-9]/g, '') } });
    }
    try { await mailer.sendMail({ from: `AAFL <${GMAIL_USER.trim()}>`, to, subject, text, html, headers }); console.log(`::notice::Sent to ${to} (Gmail)`); }
    catch (e) {
      const pw = GMAIL_APP_PASSWORD.replace(/[^A-Za-z0-9]/g, '');
      console.log(`::error::Send to ${to} failed (Gmail): ${e.message.split('\n')[0]} | user looks like an email: ${/^[^@\s]+@[^@\s]+\.[a-z]+$/i.test(GMAIL_USER.trim())} | app password length: ${pw.length} (should be 16)`);
      process.exitCode = 1;
    }
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: AAFL_FROM, to: [to], subject, text, html })
  });
  if (!res.ok) { console.log(`::error::Send to ${to} failed (Resend): ${res.status} ${await res.text()}`); process.exitCode = 1; } else console.log(`::notice::Sent to ${to} (Resend)`);
}

async function main() {
  if (!CAN_SEND) console.log('Email sending not set up yet (GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY + AAFL_FROM secrets). Running as a dry run.');
  else console.log('Sending with ' + (USE_GMAIL ? 'Gmail' : 'Resend') + (DRY ? ' (dry run)' : ''));
  if (KIND === 'test') {
    const to = process.env.TEST_TO || GMAIL_USER;
    await send(to, 'AAFL: test email', { title: 'Test email', paras: ['This is a test from the AAFL reminder job. If you can read this, email reminders are working.'], button: 'Open the AAFL', url: SITE });
    return;
  }
  const week = await sb(`rpc/aafl_current_week`, { method: 'POST', body: JSON.stringify({ p_season: SEASON }) });
  const games = await sb(`aafl_games?select=id,kickoff&season=eq.${SEASON}&week=eq.${week}`);
  if (!games.length) { console.log('No games this week.'); return; }
  const lock = new Date(Math.min(...games.map(g => +new Date(g.kickoff))));
  if (Date.now() >= +lock) { console.log(`Week ${week} already locked.`); return; }

  const teams = await sb(`aafl_teams?select=id,name,invite_code&season=eq.${SEASON}&is_bot=eq.false&email_reminders=eq.true`);
  const invites = await sb(`aafl_invites?select=code,email,team_id,unsub_token&season=eq.${SEASON}`);
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
    const tok = (invites.find(i => i.email.toLowerCase() === email && i.unsub_token) || {}).unsub_token;
    const unsub = tok ? UNSUB + tok : null;
    const hi = list.length === 1 ? list[0].name : 'there';
    if (KIND === 'open') {
      await send(email, `AAFL: Week ${week} picks are open`, {
        title: `Week ${week} picks are open`,
        paras: [`Hi ${hi},`, `Week ${week} has ${n} games. Picks lock at the first kickoff: ${fmt(lock)}.`, ...(list.length > 1 ? [list.map(t => '- ' + t.name).join('\n')] : [])],
        button: 'Make your picks', url: `${SITE}picks.html`, footer: 'You can also turn these off on the Picks page.', unsub });
    } else if (KIND === 'lock') {
      const missing = list.filter(t => t.have < n);
      if (!missing.length) continue;
      await send(email, `AAFL: Week ${week} picks lock tonight`, {
        title: `Week ${week} picks lock tonight`,
        paras: [`Hi ${hi},`, `Still to pick for Week ${week}:`, missing.map(t => `- ${t.name}: ${t.have} of ${n} picked`).join('\n'), `Picks lock at ${fmt(lock)}.`],
        button: 'Finish your picks', url: `${SITE}picks.html`, footer: 'You can also turn these off on the Picks page.', unsub });
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
