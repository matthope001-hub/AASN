/* AASN Halloween theme — bats, a ghost, jack-o-lanterns, a dropping spider, corner cobwebs and an orange glow.
 * Shared by AAHL, AAFL, AABL, Death Pool and the AASN home. Our own code, no libraries.
 * - Only runs Oct 20 – Nov 1 (Toronto time), then switches itself off. Nothing to remove after.
 * - Never blocks clicks (pointer-events: none) and sits behind pop-ups and menus (z-index 40).
 * - Respects "reduce motion": only the static cobwebs and glow show.
 * - Turn off early: add ?spooky=0 to any URL (remembered on that browser); ?spooky=1 forces it on.
 */
(function () {
  try {
    var q = new URLSearchParams(location.search).get('spooky');
    if (q === '0' || q === '1') localStorage.setItem('aasn-spooky', q);
    var pref = localStorage.getItem('aasn-spooky');
  } catch (e) { var pref = null; }
  var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  var m = now.getMonth() + 1, d = now.getDate();
  var season = (m === 10 && d >= 20) || (m === 11 && d === 1);
  if (pref === '0' || (!season && pref !== '1')) return;

  var BAT = '<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 10c-2-4-4-5-4-5s0 3-1 5c-6-6-15-7-27-2 6 2 9 6 9 11 4-3 9-3 12 1 2-3 6-4 9-3l2 5 2-5c3-1 7 0 9 3 3-4 8-4 12-1 0-5 3-9 9-11-12-5-21-4-27 2-1-2-1-5-1-5s-2 1-4 5z" fill="#140a00"/></svg>';
  var GHOST = '<svg viewBox="0 0 60 72" aria-hidden="true"><path d="M30 2C14 2 4 14 4 30v40l9-7 8 7 9-7 9 7 8-7 9 7V30C56 14 46 2 30 2z" fill="#f4f1ea" opacity=".9"/><ellipse cx="21" cy="28" rx="4" ry="6" fill="#1a1a1a"/><ellipse cx="39" cy="28" rx="4" ry="6" fill="#1a1a1a"/><ellipse cx="30" cy="44" rx="5" ry="6" fill="#1a1a1a"/></svg>';
  var SPIDER = '<svg viewBox="0 0 40 40" aria-hidden="true"><g stroke="#140a00" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M14 16 4 8M14 20 2 20M14 24 4 32M16 27 9 38M26 16l10-8M26 20h12M26 24l10 8M24 27l7 11"/></g><ellipse cx="20" cy="22" rx="7" ry="8" fill="#140a00"/><circle cx="20" cy="12" r="5" fill="#140a00"/><circle cx="18" cy="11" r="1.2" fill="#ff7a00"/><circle cx="22" cy="11" r="1.2" fill="#ff7a00"/></svg>';
  var PUMPKIN = '<svg viewBox="0 0 64 60" aria-hidden="true"><path d="M30 10c0-5 2-8 6-9l2 3c-3 1-4 3-4 6z" fill="#3d6b1e"/><ellipse cx="18" cy="35" rx="15" ry="20" fill="#d9600b"/><ellipse cx="46" cy="35" rx="15" ry="20" fill="#d9600b"/><ellipse cx="32" cy="35" rx="16" ry="22" fill="#f07a12"/><g class="face" fill="#ffd34d"><path d="M17 28l7-6 4 8zM47 28l-7-6-4 8z"/><path d="M29 36h6l-3 5z"/><path d="M14 43q18 12 36 0l-4 6-4-3-4 4-4-4-4 4-4-4-4 3z"/></g></svg>';
  var WEB = '<svg viewBox="0 0 160 160" aria-hidden="true"><g stroke="#e8e2d6" stroke-width="1" fill="none" opacity=".55"><path d="M0 0 160 160M0 0 80 160M0 0 160 80M0 0 0 160M0 0 160 0"/><path d="M0 30Q16 20 30 0M0 60q30-22 60-60M0 95q50-38 95-95M0 135q70-60 135-135"/></g></svg>';

  var css = ''
    + '#aasn-spooky{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}'
    + '#aasn-spooky *{pointer-events:none}'
    + '#aasn-spooky .glow{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(255,110,0,.16),transparent 60%),radial-gradient(ellipse at 50% -20%,rgba(120,40,200,.10),transparent 55%)}'
    + '#aasn-spooky .web{position:absolute;top:0;width:120px;height:120px}'
    + '#aasn-spooky .web.l{left:0}#aasn-spooky .web.r{right:0;transform:scaleX(-1)}'
    + '#aasn-spooky .bat{position:absolute;left:-80px;width:46px;height:23px;filter:drop-shadow(0 0 3px rgba(255,122,0,.75));animation:aasnFly linear infinite}'
    + '#aasn-spooky .bat svg{animation:aasnFlap .22s ease-in-out infinite alternate;transform-origin:50% 40%}'
    + '#aasn-spooky .ghost{position:absolute;left:-90px;width:54px;height:64px;opacity:0;filter:drop-shadow(0 0 8px rgba(255,255,255,.35));animation:aasnGhost 22s ease-in-out infinite}'
    + '#aasn-spooky .spider{position:absolute;top:0;width:2px;animation:aasnDrop 16s ease-in-out infinite}'
    + '#aasn-spooky .spider i{position:absolute;top:0;left:0;width:1px;height:100%;background:rgba(232,226,214,.55)}'
    + '#aasn-spooky .spider svg{position:absolute;bottom:-26px;left:-15px;width:30px;height:30px;filter:drop-shadow(0 0 3px rgba(255,122,0,.6))}'
    + '#aasn-spooky .pk{position:absolute;bottom:10px;width:56px;height:52px;filter:drop-shadow(0 0 10px rgba(255,140,0,.7))}'
    + '#aasn-spooky .pk.l{left:12px}#aasn-spooky .pk.r{right:12px}'
    + '#aasn-spooky .pk .face{animation:aasnFlicker 2.4s infinite}#aasn-spooky .pk.r .face{animation-delay:-1.1s}'
    + '@keyframes aasnFlicker{0%,100%{opacity:1}8%{opacity:.6}12%{opacity:.95}40%{opacity:.8}44%{opacity:1}70%{opacity:.7}74%{opacity:.95}}'
    + '@keyframes aasnFly{0%{transform:translate(0,0)}25%{transform:translate(28vw,-30px)}50%{transform:translate(56vw,25px)}75%{transform:translate(84vw,-20px)}100%{transform:translate(calc(100vw + 160px),10px)}}'
    + '@keyframes aasnFlap{from{transform:scaleY(1)}to{transform:scaleY(.45)}}'
    + '@keyframes aasnGhost{0%,55%{transform:translate(0,0);opacity:0}60%{opacity:.85}80%{transform:translate(60vw,-40px);opacity:.85}100%{transform:translate(calc(100vw + 180px),10px);opacity:0}}'
    + '@keyframes aasnDrop{0%,60%,100%{height:0}72%,86%{height:42vh}}'
    + '@media (max-width:600px){#aasn-spooky .web{width:80px;height:80px}#aasn-spooky .bat{width:34px;height:17px}#aasn-spooky .pk{width:38px;height:36px;bottom:6px}}'
    + '@media (prefers-reduced-motion:reduce){#aasn-spooky .bat,#aasn-spooky .ghost,#aasn-spooky .spider{display:none}#aasn-spooky .pk .face{animation:none}}';

  function build() {
    if (document.getElementById('aasn-spooky')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var box = document.createElement('div'); box.id = 'aasn-spooky'; box.setAttribute('aria-hidden', 'true');
    var html = '<div class="glow"></div><div class="web l">' + WEB + '</div><div class="web r">' + WEB + '</div>'
      + '<div class="pk l">' + PUMPKIN + '</div><div class="pk r">' + PUMPKIN + '</div>';
    var bats = window.innerWidth < 600 ? 3 : 6;
    for (var i = 0; i < bats; i++) {
      var top = 8 + Math.random() * 55, dur = 14 + Math.random() * 14, delay = -Math.random() * dur;
      html += '<div class="bat" style="top:' + top.toFixed(1) + 'vh;animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's">' + BAT + '</div>';
    }
    html += '<div class="ghost" style="top:' + (20 + Math.random() * 40).toFixed(1) + 'vh;animation-delay:' + (-Math.random() * 10).toFixed(1) + 's">' + GHOST + '</div>';
    html += '<div class="spider" style="left:' + (15 + Math.random() * 70).toFixed(1) + 'vw;animation-delay:' + (-Math.random() * 8).toFixed(1) + 's"><i></i>' + SPIDER + '</div>';
    box.innerHTML = html;
    document.body.appendChild(box);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
