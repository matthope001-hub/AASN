/**
 * AASN member-saves API — Cloudflare Worker (AABL first).
 *
 *   GET  /health                    - config check (no secrets shown)
 *   POST /aabl  { action: 'createEntry', entry, idempotencyKey }
 *   POST /aabl  { action: 'getMyTeam',      entryId, token | email }
 *   POST /aabl  { action: 'makeTrade',      entryId, token | email, boxId, optionId }
 *   POST /aabl  { action: 'changeDivision', entryId, token | email, division, team }
 *   POST /aabl  { action: 'checkLateInvite', token }   - is a late-entry link still good?
 *   POST /aabl  { action: 'admin…', password, … }      - commissioner tools
 *
 * All writes use the Supabase secret key (bypasses RLS), so every rule is
 * enforced here: sign-ups open, before the deadline, picks not locked, one
 * valid pick per box, one valid team per division, clean text fields.
 * Confirmation emails go out from Matt's Gmail via the Gmail API.
 */

import { aaflOutbox, aaflSync } from './aafl.js';

const VERSION = '2026-10-23';
const TOTAL_BOXES = 21;
const TOTAL_PICKS = 27; // 21 boxes + 6 division picks
const DIVISIONS = {
  'AL East': ['BAL', 'BOS', 'NYY', 'TB', 'TOR'],
  'AL Central': ['CLE', 'CWS', 'DET', 'KC', 'MIN'],
  'AL West': ['ATH', 'HOU', 'LAA', 'SEA', 'TEX'],
  'NL East': ['ATL', 'MIA', 'NYM', 'PHI', 'WSH'],
  'NL Central': ['CHC', 'CIN', 'MIL', 'PIT', 'STL'],
  'NL West': ['AZ', 'COL', 'LAD', 'SD', 'SF']
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------------------------------------------------------- HTTP

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || '*'),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (request, env, obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
});

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json(request, env, {
        ok: true, version: VERSION,
        supabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY),
        email: !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM)
      });
    }
    if (url.pathname === '/logo' && request.method === 'POST') {
      try {
        let body = {}; try { body = JSON.parse(await request.text()); } catch (e) { /* ignore */ }
        return json(request, env, await teamLogo(env, body));
      } catch (err) { console.log('Logo failed: ' + (err && err.stack || err)); return json(request, env, { success: false, error: 'Something went wrong. Please try again.' }, 500); }
    }
    if (url.pathname === '/deathpool/me' && request.method === 'POST') {
      try {
        let body = {}; try { body = JSON.parse(await request.text()); } catch (e) { /* ignore */ }
        return json(request, env, await deathPoolMe(env, body));
      } catch (err) { console.log('Death Pool me failed: ' + (err && err.stack || err)); return json(request, env, { success: false, error: 'Something went wrong.' }, 500); }
    }
    if (url.pathname === '/deathpool/data') {
      try { return await deathPoolData(request, env, ctx); }
      catch (err) { console.log('Death Pool data failed: ' + (err && err.stack || err)); return json(request, env, { success: false }, 502); }
    }
    if (url.pathname === '/deathpool') {
      try { return await deathPool(request, env, ctx); }
      catch (err) { console.log('Death Pool failed: ' + (err && err.stack || err)); return json(request, env, { success: false }, 502); }
    }
    if (url.pathname !== '/aabl') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return json(request, env, { success: false, error: 'Method not allowed' }, 405);

    let body;
    try { body = JSON.parse(await request.text()); } catch (e) { return json(request, env, { success: false, error: 'Invalid JSON body' }, 400); }

    try {
      switch (body.action) {
        case 'createEntry': return json(request, env, await createEntry(env, ctx, body));
        case 'getMyTeam': return json(request, env, await getMyTeam(env, body));
        case 'makeTrade': return json(request, env, await makeTrade(env, ctx, body));
        case 'changeDivision': return json(request, env, await changeDivision(env, body));
        case 'myEntries': return json(request, env, await myEntries(env, body));
        case 'checkLateInvite': return json(request, env, await checkLateInvite(env, body.token));
        default:
          if (String(body.action || '').startsWith('admin')) return json(request, env, await admin(env, ctx, body));
          return json(request, env, { success: false, error: 'Unknown action' }, 400);
      }
    } catch (err) {
      console.log('Worker error: ' + (err && err.stack || err));
      return json(request, env, { success: false, error: 'Something went wrong. Please try again.' }, 500);
    }
  },

  // Cron (wrangler.toml [triggers]): Monday-morning digest, emailed to the commissioner.
  async scheduled(event, env, ctx) {
    // AAFL: send queued invite emails every tick; refresh this/next week's games every 10 minutes.
    const tick = new Date(event.scheduledTime || Date.now());
    if (event.cron !== DIGEST_CRON) {
      const sendAs = (to, subject, text, html, unsub) => gmailSend(env, to, subject, text, html, { from: aaflFrom(env), unsub });
      ctx.waitUntil(aaflOutbox(env, sendAs).catch(err => console.log('AAFL outbox failed: ' + (err && err.stack || err))));
      if (tick.getUTCMinutes() % 10 === 4) ctx.waitUntil(aaflSync(env).catch(err => console.log('AAFL sync failed: ' + (err && err.stack || err))));
    }
    // Live points only run noon-3:59am Eastern (16:00-07:59 UTC), as before; mornings are AAFL-only.
    const h = tick.getUTCHours();
    if (event.cron !== DIGEST_CRON && h >= 8 && h < 16) return;
    if (event.cron === DIGEST_CRON) {
      ctx.waitUntil(sendWeeklyDigest(env).catch(err => console.log('Digest failed: ' + (err && err.stack || err))));
      return;
    }
    const at = new Date(event.scheduledTime || Date.now());
    if (at.getUTCMinutes() % 10 === 0) {
      ctx.waitUntil(refreshDeathPool(env).catch(err => console.log('Death Pool refresh failed: ' + err)));
    }
    if (env.LIVE_POINTS === 'off') return;
    ctx.waitUntil(runLivePoints(env).catch(err => console.log('Live points failed: ' + (err && err.stack || err))));
  }
};

// ------------------------------------------------------------- Supabase

async function sb(env, path, init = {}) {
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json', 'Accept-Profile': 'aabl', 'Content-Profile': 'aabl', ...(init.headers || {}) };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`Supabase ${init.method || 'GET'} ${path.split('?')[0]}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

async function currentSeason(env) {
  const rows = await sb(env, 'config?select=season,opening_day,picks_locked,signups_open,payment_info,entry_fee&order=season.desc&limit=1');
  return rows[0] || null;
}

// ---------------------------------------------------------- validation

function cleanText(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function validateEntry(env, cfg, e) {
  const team = cleanText(e.teamName, 40), manager = cleanText(e.managerName, 40);
  const email = String(e.email || '').trim().toLowerCase();
  if (team.length < 2) return { error: 'Please enter a team name (at least 2 characters).' };
  if (manager.length < 2) return { error: 'Please enter your name.' };
  if (!EMAIL_RE.test(email) || email.length > 120) return { error: 'Please enter a valid email address.' };

  // Box picks: { boxId: optionId } — exactly one valid option for each of the 21 boxes.
  const picks = e.picks && typeof e.picks === 'object' ? e.picks : {};
  const options = await sb(env, `box_options?select=option_id,box_id&season=eq.${cfg.season}`);
  const optBox = new Map(options.map(o => [o.option_id, o.box_id]));
  const boxIds = [...new Set(options.map(o => o.box_id))];
  if (boxIds.length !== TOTAL_BOXES) return { error: 'The boxes for this season are not ready yet.' };
  const clean = [];
  for (const b of boxIds) {
    const opt = Number(picks[b]);
    if (!opt || optBox.get(opt) !== b) return { error: `Please pick one player in Box ${b}.` };
    clean.push({ box_id: b, option_id: opt });
  }

  // Division picks: { 'AL East': 'NYY', ... } — one real team per division.
  const div = e.divisionPicks && typeof e.divisionPicks === 'object' ? e.divisionPicks : {};
  const divs = [];
  for (const [d, teams] of Object.entries(DIVISIONS)) {
    const t = String(div[d] || '').toUpperCase();
    if (!teams.includes(t)) return { error: `Please pick the ${d} winner.` };
    divs.push({ division: d, team_abbr: t });
  }
  if (clean.length + divs.length !== TOTAL_PICKS) return { error: 'Your entry is missing picks.' };
  return { team, manager, email, picks: clean, divs };
}

// ------------------------------------------------------------- actions

async function createEntry(env, ctx, body) {
  if (body.website) return { success: true }; // honeypot field: bots fill it, people never see it
  const cfg = await currentSeason(env);
  if (!cfg) return { success: false, error: 'No season is set up yet.' };
  const locked = !!(cfg.picks_locked || (cfg.opening_day && new Date() >= new Date(cfg.opening_day)));

  // Commissioner adding a team (any time), or a member using a private late-entry link.
  let byAdmin = false, invite = null;
  if (body.adminPassword) {
    if (!env.ADMIN_PASSWORD || !safeEqual(body.adminPassword, env.ADMIN_PASSWORD)) return { success: false, error: 'Wrong admin password. Sign in to the Commissioner page again.' };
    byAdmin = true;
  } else if (body.lateToken) {
    const v = await validateLateInvite(env, body.lateToken);
    if (!v.valid) return { success: false, error: v.error };
    invite = v;
  } else {
    if (!cfg.signups_open) return { success: false, error: 'Sign-ups are not open yet.' };
    if (locked) return { success: false, error: 'Picks are locked — the season has started and new entries are no longer accepted.' };
  }

  // A retried save (double-click, flaky connection) returns the entry that already went through.
  const key = UUID_RE.test(body.idempotencyKey || '') ? body.idempotencyKey : null;
  if (key) {
    const prior = await sb(env, `entries?select=entry_id,team_name&idempotency_key=eq.${key}`);
    if (prior.length) return { success: true, entryId: prior[0].entry_id, teamName: prior[0].team_name, repeat: true };
  }

  const v = await validateEntry(env, cfg, body.entry || {});
  if (v.error) return { success: false, error: v.error };

  const existing = await sb(env, `entries?select=entry_id&season=eq.${cfg.season}&email=eq.${encodeURIComponent(v.email)}`);
  const token = randomHex(24);
  const [entry] = await sb(env, 'entries', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      season: cfg.season, email: v.email, manager_name: v.manager, team_name: v.team,
      entry_num: existing.length + 1, access_token_hash: await sha256(token), idempotency_key: key,
      approved: byAdmin, approved_at: byAdmin ? new Date().toISOString() : null, late_entry: locked || !!invite
    })
  });
  try {
    await sb(env, 'picks', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(v.picks.map(p => ({ entry_id: entry.entry_id, season: cfg.season, ...p }))) });
    await sb(env, 'division_picks', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(v.divs.map(d => ({ entry_id: entry.entry_id, ...d }))) });
  } catch (err) {
    // Don't leave a half-saved entry behind (picks cascade with it).
    await sb(env, `entries?entry_id=eq.${entry.entry_id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
    throw err;
  }
  if (invite) await sb(env, `late_invites?token_hash=eq.${invite.hash}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ used_at: new Date().toISOString(), entry_id: entry.entry_id }) });

  ctx.waitUntil(sendConfirmation(env, cfg, entry, v, token).catch(err => console.log('Email failed: ' + (err && err.stack || err))));
  return { success: true, entryId: entry.entry_id, teamName: entry.team_name, entryNum: entry.entry_num, paymentInfo: cfg.payment_info || null };
}

// --------------------------------------------------------- late invites
// A private link (signup.html?late=TOKEN) that lets one person enter after the
// deadline. Only the token's hash is stored; it works once and for 7 days.

function authAdminHeaders(env) {
  const key = env.SUPABASE_SERVICE_KEY, h = { apikey: key };
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function validateLateInvite(env, token) {
  token = String(token || '');
  if (!/^[0-9a-f]{48}$/.test(token)) return { valid: false, error: 'This late-entry link is not valid.' };
  const hash = await sha256(token);
  const [row] = await sb(env, `late_invites?select=expires_at,used_at&token_hash=eq.${hash}`);
  if (!row) return { valid: false, error: 'This late-entry link is not valid.' };
  if (row.used_at) return { valid: false, error: 'This late-entry link has already been used.' };
  if (new Date() > new Date(row.expires_at)) return { valid: false, error: 'This late-entry link has expired.' };
  return { valid: true, hash, expiresAt: row.expires_at };
}

async function checkLateInvite(env, token) {
  const v = await validateLateInvite(env, token);
  return v.valid ? { success: true, expiresAt: v.expiresAt } : { success: false, error: v.error };
}

// ------------------------------------------------- my team + trades

// A manager proves it's their team with the private emailed link (token),
// or with their entry ID plus the email they signed up with.
// Verified sign-in (Supabase Auth): the user's id and every confirmed email
// across their linked accounts (Google, Microsoft, Yahoo, email link…).
async function verifyUser(env, accessToken) {
  if (!accessToken) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const user = await res.json();
  const clean = e => String(e || '').trim().toLowerCase();
  const emails = new Set();
  (user.identities || []).forEach(i => {
    const d = i.identity_data || {};
    const email = clean(d.email || (i.provider === 'email' ? user.email : ''));
    if (!email || d.email_verified === false) return;
    if (i.provider === 'email' && !user.email_confirmed_at) return; // link not clicked yet
    emails.add(email);
  });
  if (user.email && user.email_confirmed_at) emails.add(clean(user.email));
  return { id: user.id, emails };
}

async function authEntry(env, body) {
  const id = String(body.entryId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  const rows = await sb(env, `entries?select=entry_id,season,email,manager_name,team_name,moves_used,access_token_hash,entry_num,user_id&entry_id=eq.${encodeURIComponent(id)}`);
  const e = rows[0];
  if (!e) return null;
  if (body.token && e.access_token_hash && await sha256(String(body.token)) === e.access_token_hash) return e;
  if (body.accessToken) {
    const u = await verifyUser(env, body.accessToken);
    if (u && (e.user_id === u.id || u.emails.has(e.email))) return e;
    return null;
  }
  if (body.email && String(body.email).trim().toLowerCase() === e.email) return e;
  return null;
}

// Signed-in member: every team entered with one of their verified emails.
// Also links those entries to their account (entries.user_id).
async function myEntries(env, body) {
  const u = await verifyUser(env, body.accessToken);
  if (!u) return { success: false, error: 'Your sign-in expired. Sign out and sign in again.' };
  const cfg = await currentSeason(env);
  const list = u.emails.size
    ? await sb(env, `entries?select=entry_id,team_name,email,entry_num,user_id&season=eq.${cfg.season}&or=(user_id.eq.${u.id},email.in.(${[...u.emails].map(e => '"' + e.replace(/"/g, '') + '"').join(',')}))&order=created_at`)
    : await sb(env, `entries?select=entry_id,team_name,email,entry_num,user_id&season=eq.${cfg.season}&user_id=eq.${u.id}&order=created_at`);
  const unlinked = list.filter(e => !e.user_id).map(e => e.entry_id);
  if (unlinked.length) {
    await sb(env, `entries?entry_id=in.(${unlinked.map(x => '"' + x + '"').join(',')})&user_id=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: u.id }) });
  }
  return { success: true, emails: [...u.emails], entries: list.map(e => ({ entryId: e.entry_id, teamName: e.team_name, email: e.email, entryNum: e.entry_num })) };
}
const NOT_FOUND = { success: false, error: "We couldn't find that team. Check the entry ID and email, or use the link in your confirmation email." };

async function getMyTeam(env, body) {
  const e = await authEntry(env, body);
  if (!e) return NOT_FOUND;
  const cfg = await currentSeason(env);
  const [picks, divs, trades] = await Promise.all([
    sb(env, `picks?select=box_id,option_id,banked_points,picked_at&entry_id=eq.${e.entry_id}&order=box_id`),
    sb(env, `division_picks?select=division,team_abbr&entry_id=eq.${e.entry_id}`),
    sb(env, `trades?select=box_id,old_option_id,new_option_id,points_banked,preseason,official,made_at&entry_id=eq.${e.entry_id}&order=made_at.desc`)
  ]);
  const cfg2 = (await sb(env, `config?select=trade_deadline,season_moves&season=eq.${cfg.season}`))[0] || {};
  const preseason = !cfg.picks_locked && (!cfg.opening_day || new Date() < new Date(cfg.opening_day));
  return {
    success: true,
    entry: { entryId: e.entry_id, teamName: e.team_name, managerName: e.manager_name, entryNum: e.entry_num, movesUsed: e.moves_used },
    season: cfg.season, preseason, openingDay: cfg.opening_day, tradeDeadline: cfg2.trade_deadline || null, seasonMoves: cfg2.season_moves || 2,
    picks, divisionPicks: divs, trades
  };
}

async function makeTrade(env, ctx, body) {
  const e = await authEntry(env, body);
  if (!e) return NOT_FOUND;
  const boxId = Number(body.boxId), optionId = Number(body.optionId);
  if (!boxId || !optionId) return { success: false, error: 'Pick a player to trade for.' };
  const r = await sb(env, 'rpc/make_trade', { method: 'POST', body: JSON.stringify({ p_entry: e.entry_id, p_box: boxId, p_option: optionId }) });
  if (!r || !r.ok) return { success: false, error: (r && r.error) || 'The trade could not be made.' };
  ctx.waitUntil(sendTradeEmail(env, e, boxId, optionId, r).catch(err => console.log('Trade email failed: ' + (err && err.stack || err))));
  return { success: true, preseason: r.preseason, banked: r.banked, movesUsed: r.moves_used, seasonMoves: r.season_moves };
}

async function changeDivision(env, body) {
  const e = await authEntry(env, body);
  if (!e) return NOT_FOUND;
  const division = String(body.division || ''), team = String(body.team || '').toUpperCase();
  if (!DIVISIONS[division] || !DIVISIONS[division].includes(team)) return { success: false, error: 'Pick a team from that division.' };
  const r = await sb(env, 'rpc/change_division_pick', { method: 'POST', body: JSON.stringify({ p_entry: e.entry_id, p_division: division, p_team: team }) });
  return r && r.ok ? { success: true } : { success: false, error: (r && r.error) || 'Could not change the pick.' };
}

async function sendTradeEmail(env, e, boxId, optionId, r) {
  if (!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM)) return;
  const [t] = await sb(env, `trades?select=old_option_id,new_option_id&entry_id=eq.${e.entry_id}&box_id=eq.${boxId}&order=made_at.desc&limit=1`);
  const opts = await sb(env, `box_options?select=option_id,player:players(full_name,team_abbr)&option_id=in.(${t.old_option_id},${t.new_option_id})`);
  const name = id => { const o = opts.find(x => x.option_id === id); return o ? `${o.player.full_name} (${o.player.team_abbr || '—'})` : '—'; };
  const line = r.preseason ? 'Pre-season change — free, and it doesn\'t count against your trades.'
    : `Points banked from the outgoing player: ${r.banked}. Trades used: ${r.moves_used} of ${r.season_moves}.`;
  const html = `<div style="font-family:Arial,sans-serif;background:#0C2340;color:#E8EDF1;padding:24px"><div style="max-width:560px;margin:0 auto;background:#132E52;border-top:4px solid #BD3039;padding:20px">
    <h2 style="margin:0 0 10px">⚾ Trade confirmed — ${esc(e.team_name)}</h2>
    <p style="margin:0 0 6px">Box ${boxId}: <b>${esc(name(t.old_option_id))}</b> ➜ <b>${esc(name(t.new_option_id))}</b></p>
    <p style="margin:0;color:#A9B8CC">${esc(line)}</p></div></div>`;
  await gmailSend(env, e.email, `AABL trade confirmed: ${e.team_name}`, `Trade confirmed for ${e.team_name}\nBox ${boxId}: ${name(t.old_option_id)} -> ${name(t.new_option_id)}\n${line}`, html);
}

// --------------------------------------------------------------- admin
// Commissioner tools. Every admin action needs the ADMIN_PASSWORD secret
// (set in the Cloudflare dashboard); admin-only features stay out of What's New.

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function admin(env, ctx, body) {
  if (!env.ADMIN_PASSWORD) return { success: false, error: 'Admin is not set up yet (ADMIN_PASSWORD secret missing).' };
  if (!safeEqual(body.password, env.ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 800)); // slow down guessing
    return { success: false, error: 'Wrong admin password.' };
  }
  const cfg = await currentSeason(env);
  const season = cfg.season;
  switch (body.action) {
    case 'adminLogin': return { success: true };

    case 'adminDigest': {
      const d = await buildDigest(env);
      return d ? { success: true, text: d.text, asOf: d.asOf } : { success: false, error: 'No standings yet — the digest starts once the season does.' };
    }

    case 'adminOverview': {
      const [config, entries, il, jobs] = await Promise.all([
        sb(env, `config?select=*&season=eq.${season}`),
        sb(env, `entries?select=entry_id,email,manager_name,team_name,entry_num,paid,paid_at,free_entry,moves_used,created_at,approved,late_entry&season=eq.${season}&order=created_at.asc`),
        sb(env, 'il?select=mlb_id,note,flagged_at,player:players(full_name,team_abbr)&order=flagged_at.desc'),
        sb(env, 'job_runs?select=job,run_date,started_at,finished_at,ok,detail&order=id.desc&limit=5')
      ]);
      return { success: true, season, config: config[0], entries, il, jobs, email: !!(env.GMAIL_CLIENT_ID && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM) };
    }

    case 'adminUpdateConfig': {
      const c = body.config || {}, patch = { updated_at: new Date().toISOString() };
      for (const k of ['signups_open', 'picks_locked']) if (k in c) patch[k] = !!c[k];
      for (const k of ['opening_day', 'trade_deadline']) if (k in c) patch[k] = c[k] ? new Date(c[k]).toISOString() : null;
      if ('entry_fee' in c) patch.entry_fee = Math.max(0, Number(c.entry_fee) || 0);
      if ('season_moves' in c) patch.season_moves = Math.max(0, Math.min(10, parseInt(c.season_moves, 10) || 0));
      if ('payment_info' in c) patch.payment_info = cleanText(c.payment_info, 300) || null;
      if ('digest_day' in c) patch.digest_day = cleanText(c.digest_day, 12).toUpperCase() || 'MONDAY';
      await sb(env, `config?season=eq.${season}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      return { success: true };
    }

    case 'adminSetPaid': {
      const id = String(body.entryId || '');
      await sb(env, `entries?entry_id=eq.${encodeURIComponent(id)}&season=eq.${season}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ paid: !!body.paid, paid_at: body.paid ? new Date().toISOString() : null, free_entry: !!body.free }) });
      return { success: true };
    }

    case 'adminResendEmail': {
      const id = String(body.entryId || '');
      const [e] = await sb(env, `entries?select=entry_id,email,manager_name,team_name,entry_num&entry_id=eq.${encodeURIComponent(id)}`);
      if (!e) return { success: false, error: 'Entry not found.' };
      if (!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM)) return { success: false, error: 'Email is not set up yet (Gmail secrets missing).' };
      const [picks, divs] = await Promise.all([
        sb(env, `picks?select=box_id,option_id&entry_id=eq.${e.entry_id}`),
        sb(env, `division_picks?select=division,team_abbr&entry_id=eq.${e.entry_id}`)
      ]);
      const token = randomHex(24); // a fresh private link; the old one stops working
      await sb(env, `entries?entry_id=eq.${e.entry_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ access_token_hash: await sha256(token) }) });
      await sendConfirmation(env, cfg, e, { email: e.email, picks, divs }, token);
      return { success: true };
    }

    case 'adminSetIL': {
      const id = Number(body.mlbId);
      if (!id) return { success: false, error: 'Pick a player.' };
      if (body.remove) await sb(env, `il?mlb_id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      else await sb(env, 'il?on_conflict=mlb_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ mlb_id: id, note: cleanText(body.note, 120) || null, flagged_at: new Date().toISOString() }) });
      return { success: true };
    }

    case 'adminTrade': {
      // Official trade recorded by the commissioner: same process and rules as a
      // manager's own trade (same box, banked points, counts as a move), marked official.
      const id = String(body.entryId || ''), boxId = Number(body.boxId), optionId = Number(body.optionId);
      const r = await sb(env, 'rpc/make_trade', { method: 'POST', body: JSON.stringify({ p_entry: id, p_box: boxId, p_option: optionId }) });
      if (!r || !r.ok) return { success: false, error: (r && r.error) || 'Trade failed.' };
      const [t] = await sb(env, `trades?select=trade_id&entry_id=eq.${encodeURIComponent(id)}&box_id=eq.${boxId}&order=made_at.desc&limit=1`);
      if (t) await sb(env, `trades?trade_id=eq.${t.trade_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ official: true }) });
      const [e] = await sb(env, `entries?select=entry_id,email,team_name&entry_id=eq.${encodeURIComponent(id)}`);
      if (e) ctx.waitUntil(sendTradeEmail(env, e, boxId, optionId, r).catch(err => console.log('Trade email failed: ' + err)));
      return { success: true, banked: r.banked, preseason: r.preseason, movesUsed: r.moves_used };
    }

    case 'adminApprove': {
      const id = String(body.entryId || '');
      await sb(env, `entries?entry_id=eq.${encodeURIComponent(id)}&season=eq.${season}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ approved: body.approved !== false, approved_at: body.approved !== false ? new Date().toISOString() : null }) });
      return { success: true };
    }

    case 'adminGetEntry': {
      const id = String(body.entryId || '');
      const [e] = await sb(env, `entries?select=entry_id,email,manager_name,team_name,entry_num,approved,late_entry,moves_used,created_at&entry_id=eq.${encodeURIComponent(id)}`);
      if (!e) return { success: false, error: 'Entry not found.' };
      const [picks, divs, trades] = await Promise.all([
        sb(env, `picks?select=box_id,option_id,banked_points,opt:box_options(role,player:players(full_name,team_abbr))&entry_id=eq.${e.entry_id}&order=box_id`),
        sb(env, `division_picks?select=division,team_abbr&entry_id=eq.${e.entry_id}`),
        sb(env, `trades?select=box_id,old_option_id,new_option_id,points_banked,preseason,official,made_at&entry_id=eq.${e.entry_id}&order=made_at.desc`)
      ]);
      return { success: true, entry: e, picks, divisionPicks: divs, trades };
    }

    case 'adminUpdatePicks': {
      // A correction: swaps the chosen player in a box without counting as a
      // trade, so it scores from the original pick date like the old pick did.
      const id = String(body.entryId || '');
      const [e] = await sb(env, `entries?select=entry_id,email,manager_name,team_name&entry_id=eq.${encodeURIComponent(id)}&season=eq.${season}`);
      if (!e) return { success: false, error: 'Entry not found.' };
      const v = await validateEntry(env, cfg, { teamName: e.team_name, managerName: e.manager_name, email: e.email, picks: body.picks, divisionPicks: body.divisionPicks });
      if (v.error) return { success: false, error: v.error };
      const cur = await sb(env, `picks?select=box_id,option_id&entry_id=eq.${e.entry_id}`);
      const curMap = new Map(cur.map(p => [p.box_id, p.option_id]));
      let changed = 0;
      for (const p of v.picks) {
        if (curMap.get(p.box_id) === p.option_id) continue;
        if (curMap.has(p.box_id)) await sb(env, `picks?entry_id=eq.${e.entry_id}&box_id=eq.${p.box_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ option_id: p.option_id }) });
        else await sb(env, 'picks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ entry_id: e.entry_id, season, ...p }) });
        changed++;
      }
      await sb(env, `division_picks?entry_id=eq.${e.entry_id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      await sb(env, 'division_picks', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(v.divs.map(d => ({ entry_id: e.entry_id, ...d }))) });
      return { success: true, changed };
    }

    case 'adminRename': {
      const id = String(body.entryId || ''), team = cleanText(body.teamName, 40);
      if (team.length < 2) return { success: false, error: 'Team name needs at least 2 characters.' };
      await sb(env, `entries?entry_id=eq.${encodeURIComponent(id)}&season=eq.${season}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ team_name: team }) });
      return { success: true, teamName: team };
    }

    case 'adminDeleteEntries': {
      // Permanent: picks, division picks, trades and standings go with each team.
      const ids = (Array.isArray(body.entryIds) ? body.entryIds : []).map(String).filter(x => /^[A-Za-z0-9_-]{4,64}$/.test(x));
      if (!ids.length) return { success: false, error: 'No teams selected.' };
      await sb(env, `entries?season=eq.${season}&entry_id=in.(${ids.map(x => '"' + x + '"').join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return { success: true, deleted: ids.length };
    }

    case 'adminCreateLateLink': {
      const token = randomHex(24), expires = new Date(Date.now() + 7 * 864e5).toISOString();
      await sb(env, 'late_invites', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ token_hash: await sha256(token), expires_at: expires }) });
      return { success: true, url: `${env.SITE_URL || 'https://aasn.theaahl.ca'}/aabl/signup.html?late=${token}`, expiresAt: expires };
    }

    case 'adminSignins': {
      // Every signed-in member (shared AASN login), newest sign-in first, with the AABL teams their emails match.
      const users = [];
      for (let page = 1; page <= 10; page++) {
        const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authAdminHeaders(env) });
        if (!res.ok) return { success: false, error: 'Could not load sign-ins (' + res.status + ').' };
        const batch = (await res.json()).users || [];
        users.push(...batch);
        if (batch.length < 200) break;
      }
      const ents = await sb(env, `entries?select=entry_id,team_name,email,user_id&season=eq.${season}`);
      const list = users.map(u => {
        const emails = new Set([u.email, ...(u.identities || []).map(i => (i.identity_data || {}).email)].filter(Boolean).map(x => String(x).toLowerCase()));
        return {
          email: u.email || [...emails][0] || '',
          providers: [...new Set((u.identities || []).map(i => i.provider))],
          lastSignIn: u.last_sign_in_at || null, created: u.created_at,
          teams: ents.filter(e => e.user_id === u.id || emails.has(e.email)).map(e => e.team_name)
        };
      }).sort((a, b) => String(b.lastSignIn || '').localeCompare(String(a.lastSignIn || '')));
      return { success: true, users: list };
    }

    case 'adminDeleteTestData': {
      // Only the test teams (entry IDs starting "test"); picks, trades and standings go with them.
      if (body.confirm !== 'DELETE TEST TEAMS') return { success: false, error: 'Type DELETE TEST TEAMS to confirm.' };
      await sb(env, 'entries?entry_id=like.test*', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return { success: true };
    }

    default: return { success: false, error: 'Unknown admin action.' };
  }
}

// ----------------------------------------------------------- death pool
// GET /deathpool -> small public summary of the Death Pool sheet for the AASN
// home page (graveyard count, death row, entries, leader, today's birthdays).
// The sheet id lives in public.aasn_private (service-role only), never in the
// public repo, because the sheet itself also holds entrants' contact details.
// Cached at the edge for 30 minutes.

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function deathPool(request, env, ctx) {
  const cache = caches.default;
  const key = new Request('https://aasn-cache.internal/deathpool-v1');
  const hit = await cache.match(key);
  if (hit) return json(request, env, await hit.json());

  const [row] = await sb(env, 'aasn_private?select=value&key=eq.deathpool_sheet_id', { headers: { 'Accept-Profile': 'public' } });
  if (!row) return json(request, env, { success: false }, 404);
  const tab = async name => {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${row.value}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`sheet ${name}: ${res.status}`);
    return parseCsv(await res.text());
  };
  const [standings, grave, deathRow] = await Promise.all([tab('Standings'), tab('GraveYard'), tab('Death Row')]);
  const clean = v => String(v || '').trim();
  const isDate = v => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(clean(v));
  const out = { success: true, updatedAt: new Date().toISOString() };

  // Standings: find the "Cemetery Name" column; rows with a name and numeric points are entries.
  const sHead = standings.findIndex(r => r.some(c => clean(c) === 'Cemetery Name'));
  if (sHead >= 0) {
    const nameCol = standings[sHead].findIndex(c => clean(c) === 'Cemetery Name');
    const ptsCol = standings[sHead].findIndex(c => clean(c) === 'Total Points');
    const list = standings.slice(sHead + 1)
      .map(r => ({ name: clean(r[nameCol]), pts: parseFloat(r[ptsCol]) }))
      .filter(x => x.name && Number.isFinite(x.pts));
    out.entries = list.length;
    if (list.length) { const top = list.reduce((a, b) => (b.pts > a.pts ? b : a)); out.leader = top.name; out.leaderPts = top.pts; }
    const bday = standings.flat().map(clean).find(c => /^Today's Birthdays:/i.test(c));
    if (bday) out.birthdays = bday.replace(/^Today's Birthdays:\s*/i, '');
  }
  // GraveYard: rows under the "Head Stone" header with a name and a date of death.
  const gHead = grave.findIndex(r => r.some(c => clean(c) === 'Head Stone'));
  if (gHead >= 0) {
    const nc = grave[gHead].findIndex(c => clean(c) === 'Head Stone');
    out.graveyard = grave.slice(gHead + 1).filter(r => clean(r[nc]) && isDate(r[nc + 1])).length;
  }
  // Death Row: names under the "Death Row" header that don't have a D.o.D. yet.
  const dHead = deathRow.findIndex(r => r.some(c => clean(c) === 'Death Row'));
  if (dHead >= 0) {
    const nc = deathRow[dHead].findIndex(c => clean(c) === 'Death Row');
    const dod = deathRow[dHead].findIndex(c => clean(c) === 'D.o.D.');
    out.deathRow = deathRow.slice(dHead + 1).filter(r => clean(r[nc]) && (dod < 0 || !clean(r[dod]))).length;
  }

  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1800' } })));
  return json(request, env, out);
}

// GET /deathpool/data -> everything the Death Pool site shows, read from the
// sheet and reduced to public fields only (no emails, phones, real names or
// paid status). Cached 10 minutes at the edge.
// Fast path: edge cache (per data centre) -> last saved copy in Supabase (served
// instantly, refreshed in the background when over 10 minutes old) -> live sheet.
const DP_FRESH_MS = 10 * 60 * 1000;
const DP_EDGE_KEY = 'https://aasn-cache.internal/deathpool-data-v8';

async function deathPoolData(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(DP_EDGE_KEY);
  // ?only=a,b returns just those keys (handy for checking one section).
  const only = new URL(request.url).searchParams.get('only');
  const pickKeys = o => only ? Object.fromEntries(Object.entries(o).filter(([k]) => k === 'success' || only.split(',').includes(k))) : o;
  // ?fresh=1 re-reads the sheet now (used after the commissioner changes the sheet); reports any error.
  if (new URL(request.url).searchParams.get('fresh') === '1') {
    try { const o = await refreshDeathPool(env); return json(request, env, pickKeys(o || { success: false })); }
    catch (e) { return json(request, env, { success: false, error: String(e && e.message || e) }, 500); }
  }
  const hit = await cache.match(key);
  if (hit) return json(request, env, pickKeys(await hit.json()));

  let saved = null;
  try { [saved] = await sb(env, 'deathpool_cache?select=data,updated_at&id=eq.1', { headers: { 'Accept-Profile': 'public' } }); } catch (e) { /* ignore */ }
  if (saved && saved.data) {
    const age = Date.now() - new Date(saved.updated_at).getTime();
    if (age > 3 * DP_FRESH_MS) { try { const o = await refreshDeathPool(env); if (o) return json(request, env, pickKeys(o)); } catch (e) { console.log('refresh: ' + e); } }
    else if (age > DP_FRESH_MS) ctx.waitUntil(refreshDeathPool(env).catch(e => console.log('refresh: ' + e)));
    else ctx.waitUntil(cache.put(key, new Response(JSON.stringify(saved.data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${Math.max(30, Math.round((DP_FRESH_MS - age) / 1000))}` } })));
    return json(request, env, pickKeys(saved.data));
  }
  const out = await refreshDeathPool(env);
  if (!out) return json(request, env, { success: false }, 404);
  return json(request, env, pickKeys(out));
}

// POST /deathpool/me {accessToken} -> the cemeteries owned by the signed-in email(s).
const DP_ADMIN_HASHES = ['151d5c340cdf9463eb6a300de214c14dcbd2d6924ecae1711be2c870147b36f8', '4f6a82e70c1b2065606d552344f2606a9cc793196633b9d76b360900a1d52514'];
async function sha256Hex(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function deathPoolMe(env, body) {
  const user = await verifyUser(env, String(body.accessToken || ''));
  if (!user) return { success: false, error: 'Please sign in again.' };
  const emails = [...user.emails];
  if (!emails.length) return { success: true, emails, cemeteries: [] };
  const list = emails.map(e => '"' + e.replace(/"/g, '') + '"').join(',');
  const rows = await sb(env, `deathpool_owners?select=cemetery&email=in.(${encodeURIComponent(list)})`, { headers: { 'Accept-Profile': 'public' } });
  let admin = false;
  for (const e of emails) if (DP_ADMIN_HASHES.includes(await sha256Hex(e))) admin = true;
  return { success: true, emails, admin, cemeteries: [...new Set(rows.map(r => r.cemetery))] };
}

// ---------------------------------------------------------------- logos
// POST /logo { action: 'upload'|'remove', pool: 'aabl'|'aahl'|'dp', team, image (data URL), + proof }
// Proof: AABL -> emailed token / signed-in accessToken / email (same as My Team);
//        AAHL -> signed-in accessToken matching the entry email, or entryId + email;
//        Death Pool -> signed-in accessToken whose email owns the cemetery.
// The commissioner (signed in) can change any team. Logos go live immediately.
const LOGO_MAX = 300 * 1024;
async function teamLogo(env, body) {
  const pool = String(body.pool || '');
  const team = String(body.team || '').trim();
  if (!['aabl', 'aahl', 'dp'].includes(pool) || !team || team.length > 120) return { success: false, error: 'Unknown team.' };
  let ok = false;
  if (body.accessToken) {
    const u = await verifyUser(env, String(body.accessToken));
    if (u) for (const e of u.emails) if (DP_ADMIN_HASHES.includes(await sha256Hex(e))) ok = true;
  }
  if (!ok && pool === 'aabl') ok = !!(await authEntry(env, { entryId: team, token: body.token, accessToken: body.accessToken, email: body.email }));
  if (!ok && pool === 'aahl') {
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(team)) return { success: false, error: 'Unknown team.' };
    const [e] = await sb(env, `entries?select=id,data->>email&id=eq.${encodeURIComponent(team)}`, { headers: { 'Accept-Profile': 'public' } });
    const email = e && String(e.email || '').trim().toLowerCase();
    if (email) {
      if (body.accessToken) { const u = await verifyUser(env, String(body.accessToken)); ok = !!(u && u.emails.has(email)); }
      else if (body.email) ok = String(body.email).trim().toLowerCase() === email;
    }
  }
  if (!ok && pool === 'dp' && body.accessToken) {
    const u = await verifyUser(env, String(body.accessToken));
    if (u && u.emails.size) {
      const list = [...u.emails].map(e => '"' + e.replace(/"/g, '') + '"').join(',');
      const rows = await sb(env, `deathpool_owners?select=cemetery&email=in.(${encodeURIComponent(list)})`, { headers: { 'Accept-Profile': 'public' } });
      ok = rows.some(r => r.cemetery === team);
    }
  }
  if (!ok) return { success: false, error: 'Only the team owner can change this logo. Use your team link or sign in with your entry email.' };

  const slug = team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '-' + (await sha256Hex(team)).slice(0, 8);
  const path = `${pool}/${slug}.webp`;
  const storage = `${env.SUPABASE_URL}/storage/v1/object/logos/${path}`;
  const auth = { apikey: env.SUPABASE_SERVICE_KEY, ...(env.SUPABASE_SERVICE_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } : {}) };

  if (body.action === 'remove') {
    await fetch(storage, { method: 'DELETE', headers: auth });
    await sb(env, `team_logos?pool=eq.${pool}&team_id=eq.${encodeURIComponent(team)}`, { method: 'DELETE', headers: { 'Accept-Profile': 'public', 'Content-Profile': 'public', Prefer: 'return=minimal' } });
    return { success: true, removed: true };
  }
  let bytes, type, maxBytes = LOGO_MAX;
  if (body.imageUrl) {
    // A link to a logo: fetch it here and keep our own copy, so it never breaks or tracks visitors.
    let u;
    try { u = new URL(String(body.imageUrl).trim()); } catch (e) { return { success: false, error: "That doesn't look like a web link." }; }
    if (!/^https?:$/.test(u.protocol)) return { success: false, error: 'Use an http or https link to an image.' };
    let res;
    try { res = await fetch(u.toString(), { redirect: 'follow', headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(8000) }); }
    catch (e) { return { success: false, error: "Couldn't reach that link." }; }
    if (!res.ok) return { success: false, error: `That link didn't work (error ${res.status}).` };
    maxBytes = 2 * 1024 * 1024;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) return { success: false, error: 'That image is too big (2 MB max).' };
    bytes = new Uint8Array(await res.arrayBuffer());
  } else {
    const m = String(body.image || '').match(/^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return { success: false, error: 'Please choose a JPG, PNG or WebP image.' };
    bytes = Uint8Array.from(atob(m[2]), ch => ch.charCodeAt(0));
  }
  if (bytes.length > maxBytes) return { success: false, error: 'That image is too big. Try a smaller one.' };
  const sig = [...bytes.slice(0, 12)];
  if (sig[0] === 0x52 && sig[1] === 0x49 && sig[8] === 0x57 && sig[9] === 0x45) type = 'image/webp';
  else if (sig[0] === 0x89 && sig[1] === 0x50) type = 'image/png';
  else if (sig[0] === 0xFF && sig[1] === 0xD8) type = 'image/jpeg';
  else if (sig[0] === 0x47 && sig[1] === 0x49 && sig[2] === 0x46) type = 'image/gif';
  else return { success: false, error: body.imageUrl ? "That link isn't a JPG, PNG, WebP or GIF image. Right-click the logo and use 'Copy image address'." : 'That file is not a valid image.' };
  const up = await fetch(storage, { method: 'POST', headers: { ...auth, 'Content-Type': type, 'x-upsert': 'true', 'Cache-Control': 'max-age=3600' }, body: bytes });
  if (!up.ok) { console.log('logo upload: ' + up.status + ' ' + await up.text()); return { success: false, error: 'Upload failed. Please try again.' }; }
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/logos/${path}?v=${Date.now()}`;
  await sb(env, 'team_logos?on_conflict=pool,team_id', {
    method: 'POST', headers: { 'Accept-Profile': 'public', 'Content-Profile': 'public', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ pool, team_id: team, url, updated_at: new Date().toISOString() })
  });
  return { success: true, url };
}

// Re-read the sheet, attach history, save the snapshot + the shared copy + the edge cache.
async function refreshDeathPool(env) {
  const out = await loadDeathPool(env);
  if (!out) return null;
  const owners = out._owners || [];
  delete out._owners;
  if (owners.length) {
    try {
      const seen = new Set();
      const rows = owners.filter(o => !seen.has(o.cemetery + '|' + o.email) && seen.add(o.cemetery + '|' + o.email)).map(o => ({ ...o, updated_at: new Date().toISOString() }));
      await sb(env, 'deathpool_owners?on_conflict=cemetery,email', {
        method: 'POST', headers: { 'Accept-Profile': 'public', 'Content-Profile': 'public', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows)
      });
    } catch (e) { console.log('owners: ' + e); }
  }
  try { await saveDeathPoolSnapshot(env, out); } catch (e) { console.log('snapshot: ' + e); }
  try { await addDeathPoolHistory(env, out); } catch (e) { console.log('history: ' + e); }
  await sb(env, 'deathpool_cache?on_conflict=id', {
    method: 'POST', headers: { 'Accept-Profile': 'public', 'Content-Profile': 'public', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: 1, data: out, updated_at: new Date().toISOString() })
  });
  await caches.default.put(new Request(DP_EDGE_KEY), new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } }));
  return out;
}

async function loadDeathPool(env) {
  const [cfg] = await sb(env, 'aasn_private?select=value&key=eq.deathpool_sheet_id', { headers: { 'Accept-Profile': 'public' } });
  if (!cfg) return null;
  const tab = async (name, extra = '') => {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${cfg.value}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}${extra}`);
    if (!res.ok) throw new Error(`sheet ${name}: ${res.status}`);
    return parseCsv(await res.text());
  };
  // Data tab: only the columns the site uses (never column E), rows with a name.
  const dataQuery = '&headers=0&tq=' + encodeURIComponent('select C,F,G,H,I,J,K,AB,AD,AE where C is not null');
  const [standings, picksTab, grave, deathRow, bdays, boxes, dataTab, pickSheets] = await Promise.all([
    tab('Standings'), tab('Form Responses 1'), tab('GraveYard'), tab('Death Row'), tab('Birthdays', '&headers=1'), tab('Pick Boxes', '&headers=0'),
    tab('Data', dataQuery).catch(() => []), tab('Pick Sheets').catch(() => [])
  ]);
  const c = v => String(v ?? '').trim();
  const num = v => { const x = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(x) ? x : null; };
  const headerRow = (rows, label) => rows.findIndex(r => r.some(x => c(x) === label));
  const col = (row, label) => row.findIndex(x => c(x) === label);
  const out = { success: true, updatedAt: new Date().toISOString() };

  // Standings
  let h = headerRow(standings, 'Cemetery Name');
  out.standings = h < 0 ? [] : standings.slice(h + 1).map(r => ({
    rank: num(r[col(standings[h], 'Ranking')]), name: c(r[col(standings[h], 'Cemetery Name')]), points: num(r[col(standings[h], 'Total Points')])
  })).filter(x => x.name && x.points != null);

  // Each cemetery's picks (category -> celeb, points). Contact columns are never read.
  h = picksTab.findIndex(r => r.some(x => /^Cemetery Name/i.test(c(x))));
  out.cemeteries = [];
  if (h >= 0) {
    const H = picksTab[h].map(c);
    const cem = H.findIndex(x => /^Cemetery Name/i.test(x));
    const total = H.lastIndexOf('Total Points');
    const cats = [];
    for (let i = cem + 1; i < (total > 0 ? total : H.length); i++) {
      if (!H[i] || H[i] === 'Points') continue;
      let name = H[i];
      if (/^Death Row\s*\(PICK 2/i.test(name)) name = 'Death Row (Pick 1)';
      else if (/^Death Row PICK 2/i.test(name)) name = 'Death Row (Pick 2)';
      else if (name.includes(' - ')) name = name.split(' - ')[0];
      cats.push({ i, name, pts: H[i + 1] === 'Points' ? i + 1 : -1 });
    }
    out.categories = cats.map(x => x.name);
    // Private: which email owns which cemetery (never sent to the browser; saved to a service-only table).
    const em = H.findIndex(x => /^email/i.test(x));
    out._owners = em < 0 ? [] : picksTab.slice(h + 1).filter(r => c(r[cem]) && c(r[em]).includes('@'))
      .map(r => ({ cemetery: c(r[cem]), email: c(r[em]).toLowerCase() }));
    out.cemeteries = picksTab.slice(h + 1).filter(r => c(r[cem])).map(r => ({
      name: c(r[cem]),
      total: total >= 0 ? num(r[total]) : null,
      picks: cats.map(x => ({ category: x.name, celeb: c(r[x.i]), points: x.pts >= 0 ? num(r[x.pts]) : null })).filter(p => p.celeb)
    }));
  }

  // Graveyard + bonus legend
  h = headerRow(grave, 'Head Stone');
  out.graveyard = []; out.bonuses = [];
  if (h < 0) h = grave.findIndex(r => r.some(x => /Head Stone/.test(c(x))));
  if (h >= 0) {
    const H = grave[h].map(c);
    const nm = H.findIndex(x => /Head Stone/.test(x));
    const bcols = H.map((x, i) => [x, i]).filter(([x]) => /\bB(\d{1,2})$/.test(x)).map(([x, i]) => ({ code: 'B' + x.match(/B(\d{1,2})$/)[1], i }));
    const ix = l => H.findIndex(x => x === l);
    const legendCode = H.findIndex(x => /^bonus points$/i.test(x));
    out.graveyard = grave.slice(h + 1).filter(r => c(r[nm]) && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c(r[nm + 1]))).map(r => ({
      name: c(r[nm]), died: c(r[nm + 1]),
      bonuses: bcols.filter(b => /^(✓|✔|TRUE|x|yes)$/i.test(c(r[b.i]))).map(b => b.code),
      bonus: num(r[ix('Total Bonus')]), base: num(r[ix('Allocated Points')]), points: num(r[ix('Total Points')]),
      picked: num(r[ix('Times Picked')]), cemeteries: c(r[ix('Cemeteries')]).split(/\s+-\s+/).map(c).filter(Boolean)
    }));
    // Legend: the column whose cells read B1, B2… with the description beside it.
    const width = Math.max(...grave.map(r => r.length));
    let lc = legendCode;
    if (lc < 0 || grave.filter(r => /^B\d{1,2}$/.test(c(r[lc]))).length < 3) {
      lc = -1;
      for (let i = 0; i < width - 1 && lc < 0; i++) if (grave.filter(r => /^B\d{1,2}$/.test(c(r[i])) && c(r[i + 1]).length > 3).length >= 5) lc = i;
    }
    if (lc >= 0) {
      const seen = new Set();
      out.bonuses = grave.map(r => [c(r[lc]), c(r[lc + 1])]).filter(([k, d]) => /^B\d{1,2}$/.test(k) && d && !seen.has(k) && seen.add(k)).map(([code, text]) => ({ code, text }));
    }
  }

  // Death Row
  h = headerRow(deathRow, 'Death Row');
  out.deathRow = [];
  if (h >= 0) {
    const H = deathRow[h].map(c), ix = l => H.findIndex(x => x.toLowerCase() === l.toLowerCase());
    out.deathRow = deathRow.slice(h + 1).filter(r => c(r[ix('Death Row')])).map(r => ({
      name: c(r[ix('Death Row')]), delayed: c(r[ix('delayed execution')]), born: c(r[ix('D.o.B.')]), died: c(r[ix('D.o.D.')]),
      age: c(r[ix('Age at time of death')]), scheduled: c(r[ix('Expected Execution Date')]), rescheduled: c(r[ix('New Execution DAte')]),
      state: c(r[ix('State')])
    }));
  }

  // Birthdays
  h = headerRow(bdays, 'Celeb');
  out.birthdays = h < 0 ? [] : bdays.slice(h + 1).map(r => ({ name: c(r[col(bdays[h], 'Celeb')]), born: c(r[col(bdays[h], 'Birthday')]), md: c(r[col(bdays[h], 'Helper')]) }))
    .filter(x => x.name && (x.born || x.md));

  // Pick boxes: key, display name, celebs
  out.boxes = boxes.map(r => r.map(c)).filter(r => r[0] && r[1] && /^[a-z0-9_]+$/.test(r[0]))
    .map(r => ({ name: r[1], celebs: r.slice(2).filter(Boolean) }));

  // Celeb cards: name, age, born, died, age at death, point value, times picked, total points, category, Wikipedia.
  out.celebs = dataTab.map(r => r.map(c)).filter(r => r[0] && !/^(name|start date:?)$/i.test(r[0])).map(r => ({
    name: r[0], age: num(r[1]), born: r[2], died: r[3], ageAtDeath: r[4], value: num(r[5]), picked: num(r[6]),
    points: num(r[7]), category: r[8], wiki: /^https?:\/\//i.test(r[9]) ? r[9] : ''
  }));
  // Category descriptions from the Pick Sheets headers, e.g. "Mummy's Curse (pick who you DO NOT want to die)".
  // (The sheet has several blocks of categories, so scan every cell for a box name, with or without a description.)
  const boxKeys = new Set(out.boxes.map(b => b.name.toLowerCase()));
  const info = new Map();
  pickSheets.flat().map(c).filter(Boolean).forEach(l => {
    const m = l.match(/^(.*?)\s*\((.+)\)\s*$/);
    const name = (m ? m[1] : l).trim();
    if (!boxKeys.has(name.toLowerCase())) return;
    if (!info.has(name.toLowerCase()) || (m && !info.get(name.toLowerCase()).desc)) info.set(name.toLowerCase(), { name, desc: m ? m[2].trim() : '' });
  });
  out.categoryInfo = [...info.values()];
  return out;
}

// One snapshot of the standings per day (Eastern), for movement arrows and the race chart.
async function saveDeathPoolSnapshot(env, out) {
  if (!out || !(out.standings || []).length) return;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const rows = out.standings.map(s => ({ season: 2026, snap_date: day, cemetery: s.name, points: s.points, rank: s.rank }));
  await sb(env, 'deathpool_snapshots?on_conflict=season,snap_date,cemetery', {
    method: 'POST', headers: { 'Accept-Profile': 'public', 'Content-Profile': 'public', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
}

// Attach yesterday-or-earlier ranks (movement) and the snapshot history (race chart).
async function addDeathPoolHistory(env, out) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await sb(env, `deathpool_snapshots?select=snap_date,cemetery,points,rank&season=eq.2026&order=snap_date.asc&limit=1000&offset=${off}`, { headers: { 'Accept-Profile': 'public' } });
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dates = [...new Set(rows.map(r => r.snap_date))].sort();
  const prevDate = [...dates].reverse().find(d => d < today);
  out.history = { dates, rows: rows.map(r => [r.snap_date, r.cemetery, Number(r.points)]) };
  if (prevDate) {
    const prev = new Map(rows.filter(r => r.snap_date === prevDate).map(r => [r.cemetery, r]));
    out.prevDate = prevDate;
    out.standings.forEach(s => { const p = prev.get(s.name); if (p) { s.prevRank = p.rank; s.prevPoints = Number(p.points); } });
  }
}

// ---------------------------------------------------------- live points
// Every minute during game hours: tonight's pool points from MLB live
// boxscores, saved to aabl.live for the site's "Tonight" column. An estimate;
// the 4am nightly run stays the official count. Off: variable LIVE_POINTS = off.

const DIGEST_CRON = '13 12 * * 1';
// AAFL emails come from the same Gmail as the worker, named "AAFL".
const aaflFrom = env => 'AAFL <' + (String(env.GMAIL_FROM || '').match(/<([^>]+)>/) || [null, env.GMAIL_FROM])[1] + '>';
const MLB_API = 'https://statsapi.mlb.com/api/v1';
const BOX_FIELDS = 'teams,away,home,players,person,id,stats,batting,pitching,hits,doubles,triples,homeRuns,rbi,runs,baseOnBalls,' +
  'hitByPitch,stolenBases,strikeOuts,caughtStealing,plateAppearances,atBats,outs,wins,saves,holds,earnedRuns,losses,gamesStarted,battersFaced';
const nz = v => Number(v) || 0;

function liveLines(box) {
  const out = {};
  for (const side of ['away', 'home']) {
    for (const p of Object.values((box.teams && box.teams[side] && box.teams[side].players) || {})) {
      const id = p.person && p.person.id; if (!id) continue;
      const b = p.stats && p.stats.batting, q = p.stats && p.stats.pitching;
      if (b && (nz(b.plateAppearances) || nz(b.atBats) || nz(b.runs) || nz(b.stolenBases) || nz(b.caughtStealing))) {
        const h = nz(b.hits), d = nz(b.doubles), t = nz(b.triples), hr = nz(b.homeRuns);
        out[id + '|hitter'] = { singles: Math.max(0, h - d - t - hr), doubles: d, triples: t, hr, rbi: nz(b.rbi), runs: nz(b.runs),
          bb: nz(b.baseOnBalls), hbp: nz(b.hitByPitch), sb: nz(b.stolenBases), so: nz(b.strikeOuts), cs: nz(b.caughtStealing) };
      }
      if (q && (nz(q.outs) || nz(q.battersFaced))) {
        const outs = nz(q.outs), er = nz(q.earnedRuns);
        out[id + '|pitcher'] = { outs, k: nz(q.strikeOuts), w: nz(q.wins), sv: nz(q.saves), hld: nz(q.holds), er, l: nz(q.losses),
          bb_allowed: nz(q.baseOnBalls), h_allowed: nz(q.hits), qs: nz(q.gamesStarted) > 0 && outs >= 18 && er <= 3 ? 1 : 0 };
      }
    }
  }
  return out;
}

function baseballDayET() {
  // Before 6am Eastern still counts as the previous night's games.
  const d = new Date(Date.now() - 6 * 3600000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function runLivePoints(env) {
  const day = baseballDayET();
  const sched = await (await fetch(`${MLB_API}/schedule?sportId=1&gameType=R&date=${day}&hydrate=linescore`)).json();
  const games = (sched.dates || []).flatMap(d => d.games || []);
  if (!games.length) return;
  const state = g => (g.status && g.status.abstractGameState) || 'Preview';   // Preview | Live | Final
  if (!games.some(g => state(g) !== 'Preview')) return;                       // nothing started yet

  const [cur] = await sb(env, 'live?select=game_date,finals,games,players&id=eq.1');
  const finals = cur && cur.game_date === day ? (cur.finals || {}) : {};
  const prevGames = new Map(((cur && cur.game_date === day && cur.games) || []).map(g => [g.pk, g]));

  const gameList = games.map(g => {
    const ls = g.linescore || {};
    return { pk: g.gamePk, away: g.teams.away.team.id, home: g.teams.home.team.id,
      as: g.teams.away.score ?? null, hs: g.teams.home.score ?? null, state: state(g),
      detail: (g.status && g.status.detailedState) || '', inning: ls.currentInningOrdinal || null, half: ls.inningHalf || null,
      start: g.gameDate || null };
  });
  // Only re-fetch boxscores for games in progress, or finals not cached yet.
  const toFetch = gameList.filter(g => g.state === 'Live' || (g.state === 'Final' && !finals[g.pk]));
  const changed = toFetch.filter(g => {
    const p = prevGames.get(g.pk);
    return !p || p.state !== g.state || p.as !== g.as || p.hs !== g.hs || p.inning !== g.inning || p.half !== g.half || g.state === 'Live';
  });
  const boxes = await Promise.all(changed.map(g => fetch(`${MLB_API}/game/${g.pk}/boxscore?fields=${BOX_FIELDS}`).then(r => r.ok ? r.json() : null).catch(() => null)));
  const lines = {};                                   // key -> line, for every started game
  const prevPlayers = new Map();
  changed.forEach((g, i) => { if (boxes[i]) { const l = liveLines(boxes[i]); if (g.state === 'Final') finals[g.pk] = l; Object.assign(lines, l); } });
  Object.values(finals).forEach(l => Object.assign(lines, l));
  // Anything not re-fetched this minute keeps its last known line.
  if (cur && cur.game_date === day) Object.entries(cur.players || {}).forEach(([k, v]) => prevPlayers.set(k, v));

  const [scoring, cfg] = await Promise.all([sb(env, 'scoring?select=player_type,stat,points'), currentSeason(env)]);
  const w = { hitter: {}, pitcher: {} };
  scoring.forEach(r => { w[r.player_type][r.stat] = Number(r.points); });
  const pts = (line, role) => Math.round(Object.entries(w[role]).reduce((t, [k, p]) => t + nz(line[k]) * p, 0) * 10) / 10;

  const opts = await sb(env, `box_options?select=option_id,mlb_id,role&season=eq.${cfg.season}`);
  const players = {};
  for (const o of opts) {
    const key = o.mlb_id + '|' + o.role;
    if (lines[key]) players[key] = { pts: pts(lines[key], o.role), line: lines[key] };
    else if (prevPlayers.has(key)) players[key] = prevPlayers.get(key);
  }

  // Team totals, only once picks are locked (picks are private before that).
  const entries = {};
  const locked = cfg.picks_locked || (cfg.opening_day && Date.now() >= new Date(cfg.opening_day).getTime());
  if (locked) {
    const optKey = new Map(opts.map(o => [o.option_id, o.mlb_id + '|' + o.role]));
    for (let off = 0; ; off += 1000) {
      const picks = await sb(env, `picks?select=entry_id,option_id&season=eq.${cfg.season}&limit=1000&offset=${off}`);
      for (const p of picks) {
        const pl = players[optKey.get(p.option_id)];
        if (!pl) continue;
        const e = entries[p.entry_id] || (entries[p.entry_id] = { pts: 0, n: 0 });
        e.pts = Math.round((e.pts + pl.pts) * 10) / 10; e.n++;
      }
      if (picks.length < 1000) break;
    }
  }

  await sb(env, 'live?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ game_date: day, players, entries, games: gameList, finals, updated_at: new Date().toISOString() }) });
}

// --------------------------------------------------------- weekly digest
// Monday-morning summary for the pool's Facebook group: plain text + emoji,
// trash-talk tone, emailed only to the commissioner (DIGEST_TO, or the
// GMAIL_FROM address). Built from the standings snapshots and per-game stats.

const pick = list => list[Math.floor(Math.random() * list.length)];

async function buildDigest(env) {
  const cfg = await currentSeason(env);
  const season = cfg.season;
  const [latest] = await sb(env, `standings?select=snapshot_date&season=eq.${season}&order=snapshot_date.desc&limit=1`);
  if (!latest) return null;
  const end = latest.snapshot_date;
  const weekAgo = new Date(end + 'T12:00:00Z'); weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  const startIso = weekAgo.toISOString().slice(0, 10);
  const [prevRow] = await sb(env, `standings?select=snapshot_date&season=eq.${season}&snapshot_date=lte.${startIso}&order=snapshot_date.desc&limit=1`);
  const [now, before, teams] = await Promise.all([
    sb(env, `standings?select=entry_id,points,rank&season=eq.${season}&snapshot_date=eq.${end}&order=rank`),
    prevRow ? sb(env, `standings?select=entry_id,points,rank&season=eq.${season}&snapshot_date=eq.${prevRow.snapshot_date}`) : Promise.resolve([]),
    sb(env, `entries?select=entry_id,team_name&season=eq.${season}`)
  ]);
  if (!now.length) return null;
  const name = new Map(teams.map(t => [t.entry_id, t.team_name]));
  const prev = new Map(before.map(b => [b.entry_id, b]));
  const f = v => (Math.round(Number(v) * 10) / 10).toLocaleString('en-US');
  const rows = now.map(r => {
    const p = prev.get(r.entry_id);
    return { id: r.entry_id, name: name.get(r.entry_id) || '?', pts: Number(r.points), rank: r.rank,
      gain: p ? Number(r.points) - Number(p.points) : null, move: p ? p.rank - r.rank : 0 };
  });

  // Player of the week: most points by a pool player over the same days.
  let potw = null;
  const opts = await sb(env, `box_options?select=mlb_id,role,player:players(full_name,team_abbr)&season=eq.${season}`);
  const poolKey = new Map(opts.map(o => [o.mlb_id + '|' + o.role, o]));
  const ids = [...new Set(opts.map(o => o.mlb_id))];
  if (ids.length && prevRow) {
    const tally = new Map();
    for (let off = 0; ; off += 1000) {
      const g = await sb(env, `stats_game?select=mlb_id,role,points&game_date=gt.${prevRow.snapshot_date}&game_date=lte.${end}&mlb_id=in.(${ids.join(',')})&limit=1000&offset=${off}`);
      g.forEach(x => { const k = x.mlb_id + '|' + x.role; if (poolKey.has(k)) tally.set(k, (tally.get(k) || 0) + Number(x.points)); });
      if (g.length < 1000) break;
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) potw = { player: poolKey.get(best[0]).player, pts: best[1] };
  }

  const leader = rows[0], last = rows[rows.length - 1];
  const withGain = rows.filter(r => r.gain != null);
  const hot = [...withGain].sort((a, b) => b.gain - a.gain)[0];
  const cold = [...withGain].sort((a, b) => a.gain - b.gain)[0];
  const climber = [...rows].sort((a, b) => b.move - a.move)[0];
  const faller = [...rows].sort((a, b) => a.move - b.move)[0];
  const asOf = new Date(end + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

  const L = [];
  L.push(`⚾🦙 AABL WEEKLY — standings through ${asOf}`);
  L.push('');
  L.push(`👑 ${leader.name} sits on top with ${f(leader.pts)} pts. ${pick(['Enjoy the view while it lasts.', 'Everyone else: do better.', 'Somebody knock them off already.', 'Heavy is the head that wears the alpaca crown.'])}`);
  L.push('');
  L.push('🏆 TOP 5');
  rows.slice(0, 5).forEach(r => L.push(`${r.rank}. ${r.name} — ${f(r.pts)}${r.gain != null ? ` (+${f(r.gain)} this week)` : ''}${r.move > 0 ? ` ⬆️${r.move}` : r.move < 0 ? ` ⬇️${-r.move}` : ''}`));
  if (hot) { L.push(''); L.push(`🔥 TEAM OF THE WEEK: ${hot.name} (+${f(hot.gain)}). ${pick(['Absolutely cooking.', 'Somebody check their lineup for PEDs.', 'Hot streak alert.', 'That\'s how you do it.'])}`); }
  if (potw) L.push(`💪 PLAYER OF THE WEEK: ${potw.player.full_name} (${potw.player.team_abbr || '—'}) with ${f(potw.pts)} pts.`);
  if (climber && climber.move > 0) L.push(`📈 BIGGEST CLIMBER: ${climber.name}, up ${climber.move} spot${climber.move > 1 ? 's' : ''} to #${climber.rank}.`);
  if (faller && faller.move < 0) L.push(`📉 FREE FALL: ${faller.name}, down ${-faller.move} to #${faller.rank}. ${pick(['Yikes.', 'Thoughts and prayers.', 'Maybe make a trade?', 'Gravity is undefeated.'])}`);
  if (cold && hot && cold.id !== hot.id) L.push(`🧊 ICE COLD: ${cold.name} managed just +${f(cold.gain)}. ${pick(['Did they forget the season started?', 'Bold strategy.', 'Wake up!', 'Somebody send coffee.'])}`);
  L.push('');
  L.push(`🪣 BASEMENT: ${last.name} at #${last.rank}. ${pick(['At least next year\'s entry is free... for now.', 'The only way is up. Probably.', 'Someone has to hold up the standings.', 'Free entry next season is looking good.'])}`);
  L.push('');
  L.push(`📊 Full standings: ${env.SITE_URL}/aabl/standings.html`);
  return { text: L.join('\n'), asOf: end };
}

async function sendWeeklyDigest(env) {
  if (!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM)) return;
  const d = await buildDigest(env);
  if (!d) return;
  // Only during the season: skip if the latest standings are over 3 days old.
  if (Date.now() - new Date(d.asOf + 'T12:00:00Z').getTime() > 3 * 86400000) return;
  const to = env.DIGEST_TO || (String(env.GMAIL_FROM).match(/<([^>]+)>/) || [null, env.GMAIL_FROM])[1];
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px"><p style="color:#555">Copy and paste into the Facebook group:</p><pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:15px;background:#f4f6f9;padding:16px;border-left:4px solid #BD3039">${esc(d.text)}</pre></div>`;
  await gmailSend(env, to, `AABL weekly digest — ${d.asOf}`, d.text, html);
}

// --------------------------------------------------------------- email

async function sendConfirmation(env, cfg, entry, v, token) {
  if (!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN && env.GMAIL_FROM)) {
    console.log('Email not configured - skipped confirmation for ' + entry.entry_id);
    return;
  }
  // Names for the pick list
  const ids = v.picks.map(p => p.option_id).join(',');
  const opts = await sb(env, `box_options?select=option_id,box_id,role,player:players(full_name,team_abbr)&option_id=in.(${ids})`);
  const byId = new Map(opts.map(o => [o.option_id, o]));
  const boxes = await sb(env, `boxes?select=box_id,name&season=eq.${cfg.season}`);
  const boxName = new Map(boxes.map(b => [b.box_id, b.name]));

  const link = `${env.SITE_URL}/aabl/myteam.html?entry=${encodeURIComponent(entry.entry_id)}&token=${token}`;
  const fee = Number(cfg.entry_fee || 10);
  const rows = v.picks.sort((a, b) => a.box_id - b.box_id).map(p => {
    const o = byId.get(p.option_id) || {}, pl = o.player || {};
    return `<tr><td style="padding:4px 10px 4px 0;color:#A9B8CC;font-family:monospace">BOX ${p.box_id}</td><td style="padding:4px 10px 4px 0;color:#A9B8CC">${esc(boxName.get(p.box_id) || '')}</td><td style="padding:4px 0"><b>${esc(pl.full_name || '')}</b> <span style="color:#A9B8CC">${esc(pl.team_abbr || '')}${o.role === 'pitcher' ? ' · P' : ''}</span></td></tr>`;
  }).join('');
  const divRows = v.divs.map(d => `<tr><td style="padding:4px 10px 4px 0;color:#A9B8CC">${esc(d.division)}</td><td style="padding:4px 0"><b>${esc(d.team_abbr)}</b></td></tr>`).join('');

  const html = `<div style="background:#0C2340;color:#E8EDF1;font-family:Arial,sans-serif;padding:24px">
    <div style="max-width:600px;margin:0 auto;background:#132E52;border-top:4px solid #BD3039;padding:24px">
      <h1 style="margin:0 0 6px;font-size:24px;letter-spacing:1px">⚾ YOU'RE IN THE AABL!</h1>
      <p style="margin:0 0 16px;color:#A9B8CC">Angry Alpaca Baseball League · ${cfg.season} season</p>
      <p style="margin:0 0 4px">Team: <b>${esc(entry.team_name)}</b>${entry.entry_num > 1 ? ` (your entry #${entry.entry_num})` : ''}</p>
      <p style="margin:0 0 16px">Manager: <b>${esc(entry.manager_name)}</b></p>
      <p style="margin:0 0 20px;padding:12px;background:#0C2340;border:1px solid #25446E">
        <b>Entry fee: $${fee}.</b> ${cfg.payment_info ? esc(cfg.payment_info) : 'The commissioner will be in touch about payment.'}</p>
      <p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#BD3039;color:#fff;text-decoration:none;padding:12px 22px;font-weight:bold">MANAGE MY TEAM</a><br>
        <span style="font-size:12px;color:#A9B8CC">Keep this email — this private link lets you make trades without signing in.</span></p>
      <h2 style="font-size:16px;margin:0 0 6px">YOUR 21 BOX PICKS</h2>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${rows}</table>
      <h2 style="font-size:16px;margin:0 0 6px">DIVISION WINNERS (+25 each, at season end)</h2>
      <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${divRows}</table>
      <p style="font-size:12px;color:#A9B8CC;margin:0">Entry ID: ${esc(entry.entry_id)} · Standings: <a href="${env.SITE_URL}/aabl/standings.html" style="color:#F06A70">${env.SITE_URL.replace(/^https?:\/\//, '')}/aabl</a></p>
    </div></div>`;
  const text = `You're in the AABL!\n\nTeam: ${entry.team_name}\nManager: ${entry.manager_name}\nEntry fee: $${fee}. ${cfg.payment_info || 'The commissioner will be in touch about payment.'}\n\nManage your team (keep this private): ${link}\n\nEntry ID: ${entry.entry_id}`;
  await gmailSend(env, v.email, `AABL ${cfg.season} entry confirmed: ${entry.team_name}`, text, html);
}

async function gmailToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('Gmail token: ' + JSON.stringify(data));
  return data.access_token;
}

async function gmailSend(env, to, subject, text, html, opts = {}) {
  const boundary = 'aasn' + randomHex(8);
  const mime = [
    `From: ${opts.from || env.GMAIL_FROM}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
    ...(opts.unsub ? [`List-Unsubscribe: <${opts.unsub}>`] : []),
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`
  ].join('\r\n');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await gmailToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') })
  });
  if (!res.ok) throw new Error('Gmail send: ' + res.status + ' ' + await res.text());
}

// ------------------------------------------------------------- helpers

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
