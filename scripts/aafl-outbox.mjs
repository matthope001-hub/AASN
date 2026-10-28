// AAFL outbox — sends invite emails requested from the Admin page ("Send email").
// Runs in GitHub Actions (.github/workflows/aafl-outbox.yml) every 10 minutes.
// Sends from Matt's Gmail (GitHub secrets GMAIL_USER + GMAIL_APP_PASSWORD, same as reminders).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD

import { htmlEmail, textEmail } from './aafl-email.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_KEY: KEY, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
const JOIN = 'https://aasn.theaahl.ca/aafl/join.html?code=';
if (!SUPABASE_URL || !KEY) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, opts = {}) {
  const h = { apikey: KEY, 'Content-Type': 'application/json' };
  if (KEY.startsWith('eyJ')) h.Authorization = `Bearer ${KEY}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}

// Same wording as the Admin page's copy-and-paste email, as a branded HTML email with a button.
function inviteEmail(email, code, entries) {
  const msg = {
    title: "You're invited to the AAFL",
    paras: [
      "You're invited to the Angry Alpaca Football League, the NFL pick'em on the AASN. It's a free trial for the rest of the 2026 season: each week you pick the winner of every NFL game, 1 point per correct pick.",
      "Sign in with this email (" + email + "), then name your team. If you're joining mid-season you get the league average for the weeks you missed."
        + (entries > 1 ? " You can play up to " + entries + " teams: after joining, tap + Add entry on the Picks page." : ""),
      "Picks for each week lock at that week's first kickoff (usually Thursday night)."
    ],
    button: 'Join the AAFL', url: JOIN + code,
    footer: 'Invite only · this link works for ' + email + '.'
  };
  return { subject: "You're invited to the AAFL (Angry Alpaca Football League)", html: htmlEmail(msg), text: textEmail(msg) };
}

async function main() {
  const queued = (await sb('aafl_invites?select=code,email,entries,send_requested_at,sent_at&revoked=eq.false&send_requested_at=not.is.null'))
    .filter(i => !i.sent_at || new Date(i.sent_at) < new Date(i.send_requested_at));
  if (!queued.length) { console.log('No invite emails waiting.'); return; }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) { console.log('::error::Gmail secrets not set'); process.exitCode = 1; return; }
  const nodemailer = (await import('nodemailer')).default;
  const mailer = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USER.trim(), pass: GMAIL_APP_PASSWORD.replace(/[^A-Za-z0-9]/g, '') } });
  for (const i of queued) {
    const { subject, text, html } = inviteEmail(i.email, i.code, i.entries || 1);
    try {
      await mailer.sendMail({ from: `AAFL <${GMAIL_USER.trim()}>`, to: i.email, subject, text, html });
      await sb(`aafl_invites?code=eq.${i.code}`, { method: 'PATCH', body: JSON.stringify({ sent_at: new Date().toISOString(), send_error: null }) });
      console.log(`::notice::Invite emailed to ${i.email}`);
    } catch (e) {
      await sb(`aafl_invites?code=eq.${i.code}`, { method: 'PATCH', body: JSON.stringify({ send_error: String(e.message).slice(0, 300), send_requested_at: null }) });
      console.log(`::error::Invite to ${i.email} failed: ${e.message.split('\n')[0]}`);
      process.exitCode = 1;
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
