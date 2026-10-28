// AAFL email look: a simple branded HTML email with a big button, plus a plain-text version.
// Used by aafl-outbox.mjs (invites) and aafl-reminders.mjs (weekly reminders).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LOGO = 'https://aasn.theaahl.ca/aafl/assets/icon-180.png';

// paras: array of strings (plain text; a line starting with "- " becomes a bullet)
export const UNSUB = 'https://aasn.theaahl.ca/aafl/unsubscribe.html?t=';

// unsub: the person's unsubscribe link (adds a footer link; see aafl/unsubscribe.html)
export function htmlEmail({ title, paras, button, url, footer, unsub }) {
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

export function textEmail({ title, paras, button, url, footer, unsub }) {
  return [title, '', ...paras.flatMap(p => [p, '']), button && url ? `${button}: ${url}` : '', footer ? `\n${footer}` : '', unsub ? `Unsubscribe from AAFL emails: ${unsub}` : ''].join('\n').trim();
}

// Mail headers so Gmail/Yahoo show their own "Unsubscribe" link too.
export const unsubHeaders = unsub => (unsub ? { 'List-Unsubscribe': `<${unsub}>` } : {});
