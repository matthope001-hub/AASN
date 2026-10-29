/* AASN version stamp — shows "AAFL v1.0.2 · Oct 29, 2026" at the bottom of every page.
 * Picks the pool from the page's folder (/aafl/, /aabl/, /deathpool/), else the AASN home.
 * RULE: every update to a pool bumps that pool's version and date below.
 */
(function () {
  var V = {
    aafl:      { name: 'AAFL',       v: '1.0.2', date: '2026-10-29' },
    aabl:      { name: 'AABL',       v: '1.0.0', date: '2026-10-29' },
    deathpool: { name: 'Death Pool', v: '1.0.0', date: '2026-10-29' },
    aasn:      { name: 'AASN',       v: '1.0.0', date: '2026-10-29' }
  };
  var m = location.pathname.match(/\/(aafl|aabl|deathpool)\//);
  var p = V[m ? m[1] : 'aasn'];
  window.AASN_VERSION = p.name + ' v' + p.v;
  function stamp() {
    if (document.getElementById('aasn-ver')) return;
    var d = new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var el = document.createElement('div');
    el.id = 'aasn-ver';
    el.textContent = p.name + ' v' + p.v + ' · ' + d;
    el.style.cssText = 'text-align:center;font:12px/1.4 system-ui,sans-serif;opacity:.5;padding:18px 16px 24px;letter-spacing:.04em';
    document.body.appendChild(el);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', stamp); else stamp();
})();
