/**
 * AASN member-saves API — Cloudflare Worker (AABL first).
 *
 *   GET  /health                    - config check (no secrets shown)
 *   POST /aabl  { action: 'createEntry', entry, idempotencyKey }
 *   POST /aabl  { action: 'getMyTeam',      entryId, token | email }
 *   POST /aabl  { action: 'makeTrade',      entryId, token | email, boxId, optionId }
 *   POST /aabl  { action: 'changeDivision', entryId, token | email, division, team }
 *
 * All writes use the Supabase secret key (bypasses RLS), so every rule is
 * enforced here: sign-ups open, before the deadline, picks not locked, one
 * valid pick per box, one valid team per division, clean text fields.
 * Confirmation emails go out from Matt's Gmail via the Gmail API.
 */

const VERSION = '2026-10-21';
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
        default:
          if (String(body.action || '').startsWith('admin')) return json(request, env, await admin(env, ctx, body));
          return json(request, env, { success: false, error: 'Unknown action' }, 400);
      }
    } catch (err) {
      console.log('Worker error: ' + (err && err.stack || err));
      return json(request, env, { success: false, error: 'Something went wrong. Please try again.' }, 500);
    }
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
  if (!cfg.signups_open) return { success: false, error: 'Sign-ups are not open yet.' };
  if (cfg.picks_locked || (cfg.opening_day && new Date() >= new Date(cfg.opening_day))) {
    return { success: false, error: 'Picks are locked — the season has started and new entries are no longer accepted.' };
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
      entry_num: existing.length + 1, access_token_hash: await sha256(token), idempotency_key: key
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

  ctx.waitUntil(sendConfirmation(env, cfg, entry, v, token).catch(err => console.log('Email failed: ' + (err && err.stack || err))));
  return { success: true, entryId: entry.entry_id, teamName: entry.team_name, entryNum: entry.entry_num, paymentInfo: cfg.payment_info || null };
}

// ------------------------------------------------- my team + trades

// A manager proves it's their team with the private emailed link (token),
// or with their entry ID plus the email they signed up with.
async function authEntry(env, body) {
  const id = String(body.entryId || '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  const rows = await sb(env, `entries?select=entry_id,season,email,manager_name,team_name,moves_used,access_token_hash,entry_num&entry_id=eq.${encodeURIComponent(id)}`);
  const e = rows[0];
  if (!e) return null;
  if (body.token && e.access_token_hash && await sha256(String(body.token)) === e.access_token_hash) return e;
  if (body.email && String(body.email).trim().toLowerCase() === e.email) return e;
  return null;
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

    case 'adminOverview': {
      const [config, entries, il, jobs] = await Promise.all([
        sb(env, `config?select=*&season=eq.${season}`),
        sb(env, `entries?select=entry_id,email,manager_name,team_name,entry_num,paid,paid_at,free_entry,moves_used,created_at&season=eq.${season}&order=created_at.asc`),
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

    case 'adminDeleteTestData': {
      // Only the test teams (entry IDs starting "test"); picks, trades and standings go with them.
      if (body.confirm !== 'DELETE TEST TEAMS') return { success: false, error: 'Type DELETE TEST TEAMS to confirm.' };
      await sb(env, 'entries?entry_id=like.test*', { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return { success: true };
    }

    default: return { success: false, error: 'Unknown admin action.' };
  }
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

async function gmailSend(env, to, subject, text, html) {
  const boundary = 'aasn' + randomHex(8);
  const mime = [
    `From: ${env.GMAIL_FROM}`, `To: ${to}`, `Subject: =?UTF-8?B?${b64(subject)}?=`,
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
