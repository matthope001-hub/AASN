/* AAFL jobs that run inside the AASN worker (reliable every-minute cron; GitHub's scheduler can lag hours).
 *  - aaflOutbox: emails invites queued from the AAFL Admin page ("Send email"), from the same Gmail as the worker.
 *  - aaflSync:   every 10 min, saves this week's + next week's NFL games/scores/odds from ESPN and makes the
 *                computer teams' picks once a week opens. (The GitHub jobs still run as a backup.)
 * Uses the public schema (aafl_* tables). Email look copied from scripts/aafl-email.mjs. */

// AAFL email look: a simple branded HTML email with a big button, plus a plain-text version.
// Used by aafl-outbox.mjs (invites) and aafl-reminders.mjs (weekly reminders).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGO = 'https://aasn.theaahl.ca/aafl/assets/icon-180.png';

// paras: array of strings (plain text; a line starting with "- " becomes a bullet)
const UNSUB = 'https://aasn.theaahl.ca/aafl/unsubscribe.html?t=';

// unsub: the person's unsubscribe link (adds a footer link; see aafl/unsubscribe.html)
function htmlEmail({ title, paras, button, url, footer, unsub }) {
  const body = paras.map(p => {
    const lines = String(p).split('\n');
    if (lines.every(l => l.startsWith('- '))) return `<ul style="margin:0 0 16px;padding-left:20px;color:#1f2a3c;font-size:16px;line-height:1.5">${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    return `<p style="margin:0 0 16px;color:#1f2a3c;font-size:16px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');
  const btn = button && url ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:#003594">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">${esc(button)}</a></td></tr></table>
      <p style="margin:0 0 16px;color:#6b7686;font-size:13px;line-height:1.4">Button not working? Copy this link:<br><a href="${esc(url)}" style="color:#003594;word-break:break-all">${esc(url)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f5">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef1f5;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,sans-serif">
      <tr><td style="background:#07101F;padding:16px 22px;border-bottom:3px solid #869397">
        <img src="${LOGO}" width="44" height="44" alt="" style="vertical-align:middle;border:0">
        <span style="vertical-align:middle;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:1px;margin-left:10px">AAFL</span>
        <span style="vertical-align:middle;color:#93A1B3;font-size:12px;letter-spacing:1px;margin-left:6px">ANGRY ALPACA FOOTBALL LEAGUE</span>
      </td></tr>
      <tr><td style="padding:24px 22px 8px">
        <h1 style="margin:0 0 14px;color:#07101F;font-size:22px">${esc(title)}</h1>
        ${body}${btn}
      </td></tr>
      ${footer || unsub ? `<tr><td style="padding:12px 22px 20px;border-top:1px solid #e3e7ee;color:#6b7686;font-size:12px;line-height:1.4">${esc(footer || '')}${unsub ? `${footer ? '<br>' : ''}Don't want AAFL emails? <a href="${esc(unsub)}" style="color:#6b7686">Unsubscribe</a>` : ''}</td></tr>` : ''}
    </table>
  </td></tr></table></body></html>`;
}

function textEmail({ title, paras, button, url, footer, unsub }) {
  return [title, '', ...paras.flatMap(p => [p, '']), button && url ? `${button}: ${url}` : '', footer ? `\n${footer}` : '', unsub ? `Unsubscribe from AAFL emails: ${unsub}` : ''].join('\n').trim();
}

// Mail headers so Gmail/Yahoo show their own "Unsubscribe" link too.
const unsubHeaders = unsub => (unsub ? { 'List-Unsubscribe': `<${unsub}>` } : {});


const JOIN = 'https://aasn.theaahl.ca/aafl/join.html?code=';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const SEASON = 2026;

async function pub(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json', 'Accept-Profile': 'public', 'Content-Profile': 'public', ...(init.headers || {}) };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Supabase ${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

function inviteEmail(email, code, entries, token) {
  const msg = {
    title: "You're invited to the AAFL",
    paras: [
      "You're invited to the Angry Alpaca Football League, the NFL pick'em on the AASN. It's a free trial for the rest of the 2026 season: each week you pick the winner of every NFL game, 1 point per correct pick.",
      "Sign in with this email (" + email + "), then name your team. If you're joining mid-season you get the league average for the weeks you missed."
        + (entries > 1 ? " You can play up to " + entries + " teams: after joining, tap + Add entry on the Picks page." : ""),
      "Picks for each week lock at that week's first kickoff (usually Thursday night)."
    ],
    button: 'Join the AAFL', url: JOIN + code,
    footer: 'Invite only · this link works for ' + email + '.',
    unsub: token ? UNSUB + token : null
  };
  return { subject: "You're invited to the AAFL (Angry Alpaca Football League)", html: htmlEmail(msg), text: textEmail(msg), unsub: msg.unsub };
}

// With a GH_TOKEN secret, the worker just starts the GitHub "AAFL outbox" job right away (it sends from
// Matt's Gmail with the app password). A started job is marked "Sending <time>" so it isn't started
// again every minute; if nothing went out after 15 minutes it's started again.
async function dispatchOutbox(env, queued) {
  const stale = i => { const m = /^Sending (\S+)/.exec(i.send_error || ''); return !m || Date.now() - new Date(m[1]) > 15 * 60e3; };
  const need = queued.filter(i => !i.email_opt_out && stale(i));
  if (!need.length) return;
  const res = await fetch('https://api.github.com/repos/matthope001-hub/AASN/actions/workflows/aafl-outbox.yml/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'aasn-api', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' })
  });
  if (!res.ok) throw new Error(`GitHub dispatch: ${res.status} ${await res.text()}`);
  const mark = 'Sending ' + new Date().toISOString();
  await pub(env, `aafl_invites?code=in.(${need.map(i => i.code).join(',')})`, { method: 'PATCH', body: JSON.stringify({ send_error: mark }) });
  console.log('AAFL outbox job started for ' + need.length + ' invite(s)');
}

export async function aaflOutbox(env, send) {
  const queued = (await pub(env, 'aafl_invites?select=code,email,entries,send_requested_at,sent_at,send_error,unsub_token,email_opt_out&revoked=eq.false&send_requested_at=not.is.null'))
    .filter(i => !i.sent_at || new Date(i.sent_at) < new Date(i.send_requested_at));
  if (!queued.length) return;
  if (env.GH_TOKEN) return dispatchOutbox(env, queued);
  for (const i of queued) {
    if (i.email_opt_out) {
      await pub(env, `aafl_invites?code=eq.${i.code}`, { method: 'PATCH', body: JSON.stringify({ send_error: 'They unsubscribed from AAFL emails', send_requested_at: null }) });
      continue;
    }
    // Claim it first so a second cron tick can't send it twice.
    const claimed = await pub(env, `aafl_invites?code=eq.${i.code}&send_requested_at=eq.${encodeURIComponent(i.send_requested_at)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ sent_at: new Date().toISOString(), send_error: null }) });
    if (!claimed || !claimed.length) continue;
    const m = inviteEmail(i.email, i.code, i.entries || 1, i.unsub_token);
    try { await send(i.email, m.subject, m.text, m.html, m.unsub); console.log('AAFL invite emailed to ' + i.email); }
    catch (e) {
      await pub(env, `aafl_invites?code=eq.${i.code}`, { method: 'PATCH', body: JSON.stringify({ sent_at: i.sent_at, send_error: String(e.message || e).slice(0, 300), send_requested_at: null }) });
      console.log('AAFL invite to ' + i.email + ' failed: ' + e.message);
    }
  }
}

// Same seeded coin flip as aafl/league.js and scripts/aafl-sync.mjs.
function rand(str) {
  let h = 2166136261;
  for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^= h >>> 16) >>> 0) / 4294967296;
}
function gameRow(e, week) {
  const c = e.competitions[0];
  const away = c.competitors.find(x => x.homeAway === 'away'), home = c.competitors.find(x => x.homeAway === 'home');
  const state = (e.status && e.status.type && e.status.type.state) || 'pre';
  const odds = (c.odds || [])[0] || {};
  const num = v => (v === undefined || v === null || v === '' || isNaN(+v) ? null : Math.round(+v));
  let winner = null;
  if (state === 'post') winner = away.winner ? away.team.abbreviation : home.winner ? home.team.abbreviation : 'TIE';
  return {
    id: String(e.id), season: SEASON, week, kickoff: e.date,
    away: away.team.abbreviation, home: home.team.abbreviation,
    away_name: away.team.displayName || null, home_name: home.team.displayName || null,
    away_score: state === 'pre' ? null : num(away.score), home_score: state === 'pre' ? null : num(home.score),
    state, status_detail: (e.status && e.status.type && e.status.type.shortDetail) || null, winner,
    spread: odds.details || null, over_under: typeof odds.overUnder === 'number' ? odds.overUnder : null,
    away_ml: num(odds.awayTeamOdds && odds.awayTeamOdds.moneyLine), home_ml: num(odds.homeTeamOdds && odds.homeTeamOdds.moneyLine),
    updated_at: new Date().toISOString()
  };
}

export async function aaflSync(env) {
  const cur = await (await fetch(ESPN)).json();
  if (cur.season && cur.season.type !== 2) return;                 // regular season only
  const wk = (cur.week && cur.week.number) || 1;
  const rows = (cur.events || []).map(e => gameRow(e, wk));
  if (wk < 18) {
    const nxt = await (await fetch(`${ESPN}?seasontype=2&week=${wk + 1}&dates=${SEASON}`)).json();
    rows.push(...(nxt.events || []).map(e => gameRow(e, wk + 1)));
  }
  if (rows.length) await pub(env, 'aafl_games?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
  // Bots pick week N as soon as week N-1 has kicked off.
  const first = {};
  rows.forEach(g => { first[g.week] = Math.min(first[g.week] || Infinity, +new Date(g.kickoff)); });
  const prevLock = await pub(env, `aafl_games?select=kickoff&season=eq.${SEASON}&week=eq.${wk - 1}&order=kickoff&limit=1`).catch(() => []);
  const lockOf = w => (w === wk - 1 ? (prevLock[0] ? +new Date(prevLock[0].kickoff) : 0) : first[w]);
  const open = [wk, wk + 1].filter(w => rows.some(g => g.week === w) && (w === 1 || (lockOf(w - 1) && Date.now() >= lockOf(w - 1))));
  if (!open.length) return;
  const bots = await pub(env, `aafl_teams?select=id,bot_key&season=eq.${SEASON}&is_bot=eq.true`);
  const picks = [];
  for (const b of bots) for (const g of rows.filter(r => open.includes(r.week))) picks.push({ team_id: b.id, game_id: g.id, pick: rand(b.bot_key + ':' + g.id) < 0.5 ? g.away : g.home });
  if (picks.length) await pub(env, 'aafl_picks?on_conflict=team_id,game_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(picks) });
}
