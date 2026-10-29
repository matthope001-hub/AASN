/* AASN seasonal themes — one shared file for AAHL, AAFL, AABL, Death Pool and the AASN home.
 * Picks a theme by date (Toronto time) and switches itself off afterwards. Our own code, no libraries.
 *   Christmas Dec 1–26 · New Year's Dec 31–Jan 1 · Valentine's Feb 10–14 · St. Patrick's Mar 15–17
 *   Easter Good Friday–Easter Monday · Canada Day Jun 28–Jul 1 · Thanksgiving (CA) Fri–Mon ending 2nd Mon of Oct
 *   Halloween Oct 20–Nov 1
 * Pool moments (that pool's pages only, they win over holidays):
 *   AAFL Super Bowl week (Mon–Sun ending the 2nd Sunday of Feb) · AABL Opening Day (config.opening_day)
 *   AAHL Stanley Cup Final (set CUP_FINAL below when the NHL announces dates)
 * Champion crowned: window.aasnCelebrate(el) fires confetti (used by the Hall of Champions).
 * Rules: never blocks clicks (pointer-events: none), sits under menus/pop-ups (z-index 40),
 *        "reduce motion" keeps only the static bits.
 * Preview / control on any page: ?theme=christmas (or newyear, valentine, stpatrick, easter, canada,
 *   thanksgiving, halloween, superbowl, opening, cup) · ?theme=off · ?theme=auto (back to normal).
 */
(function () {
  // Stanley Cup Final dates, e.g. { start: '2027-06-03', end: '2027-06-22' }. Leave null until announced.
  var CUP_FINAL = null;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Z = 40;

  // ---------- Confetti / fireworks (canvas) ----------
  var cv, cx, parts = [], raf = 0;
  function canvas() {
    if (cv) return;
    cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:' + (Z + 1);
    document.body.appendChild(cv); cx = cv.getContext('2d');
    var fit = function () { cv.width = innerWidth * (devicePixelRatio || 1); cv.height = innerHeight * (devicePixelRatio || 1); cx.setTransform(devicePixelRatio || 1, 0, 0, devicePixelRatio || 1, 0, 0); };
    fit(); addEventListener('resize', fit);
  }
  function loop() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(function (p) {
      p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag; p.x += p.vx; p.y += p.vy; p.r += p.spin; p.life--;
      cx.save(); cx.globalAlpha = Math.max(0, Math.min(1, p.life / 40)); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      if (p.spark) { cx.beginPath(); cx.arc(0, 0, p.s, 0, 6.283); cx.fill(); } else cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      cx.restore();
      return p.life > 0 && p.y < innerHeight + 40;
    });
    raf = parts.length ? requestAnimationFrame(loop) : 0;
  }
  function go() { if (!raf) raf = requestAnimationFrame(loop); }
  function confetti(x, y, colors, n) {
    if (reduce) return; canvas();
    for (var i = 0; i < (n || 90); i++) {
      var a = Math.random() * 6.283, v = 4 + Math.random() * 7;
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, g: .18, drag: .985, r: Math.random() * 6, spin: (Math.random() - .5) * .3, s: 6 + Math.random() * 6, c: colors[i % colors.length], life: 120 + Math.random() * 60 });
    }
    go();
  }
  function firework(colors) {
    if (reduce) return; canvas();
    var x = innerWidth * (.15 + Math.random() * .7), y = innerHeight * (.12 + Math.random() * .35), c = colors[Math.floor(Math.random() * colors.length)];
    for (var i = 0; i < 70; i++) {
      var a = (i / 70) * 6.283, v = 2 + Math.random() * 3.5;
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: .04, drag: .975, r: 0, spin: 0, s: 1.6 + Math.random(), c: c, life: 60 + Math.random() * 30, spark: true });
    }
    go();
  }
  window.aasnCelebrate = function (el) {
    var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
    confetti(r.left + r.width / 2, r.top + r.height / 2, ['#FFB800', '#FFD34D', '#00D4FF', '#ffffff', '#F06A70'], 140);
  };

  // ---------- Which theme today ----------
  var q = null, pref = null;
  try {
    var sp = new URLSearchParams(location.search);
    q = sp.get('theme') || (sp.get('spooky') === '0' ? 'off' : sp.get('spooky') === '1' ? 'halloween' : null);
    if (q === 'auto') localStorage.removeItem('aasn-theme'); else if (q) localStorage.setItem('aasn-theme', q);
    pref = localStorage.getItem('aasn-theme') || (localStorage.getItem('aasn-spooky') === '0' ? 'off' : null);
  } catch (e) { pref = q; }
  if (pref === 'off') return;

  var host = location.hostname, path = location.pathname;
  var pool = /(^|\.)theaahl\.ca$/.test(host) && !/^aasn\./.test(host) ? 'aahl'
    : (path.match(/\/(aafl|aabl|deathpool)\//) || [])[1] || 'aasn';

  var t = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  var Y = t.getFullYear(), M = t.getMonth() + 1, D = t.getDate();
  var key = function (y, m, d) { return y * 10000 + m * 100 + d; };
  var today = key(Y, M, D);
  var dk = function (dt) { return key(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()); };
  var add = function (dt, n) { var x = new Date(dt); x.setDate(x.getDate() + n); return x; };
  function nthDow(y, m, dow, n) { var d = new Date(y, m - 1, 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return d; }
  function easter(y) { // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da);
  }
  var between = function (a, b) { return today >= a && today <= b; };

  function holiday() {
    if (between(key(Y, 12, 1), key(Y, 12, 26))) return 'christmas';
    if (between(key(Y, 12, 31), key(Y, 12, 31)) || between(key(Y, 1, 1), key(Y, 1, 1))) return 'newyear';
    if (between(key(Y, 2, 10), key(Y, 2, 14))) return 'valentine';
    if (between(key(Y, 3, 15), key(Y, 3, 17))) return 'stpatrick';
    var ea = easter(Y); if (between(dk(add(ea, -2)), dk(add(ea, 1)))) return 'easter';
    if (between(key(Y, 6, 28), key(Y, 7, 1))) return 'canada';
    var tg = nthDow(Y, 10, 1, 2); if (between(dk(add(tg, -3)), dk(tg))) return 'thanksgiving';
    if (between(key(Y, 10, 20), key(Y, 11, 1))) return 'halloween';
    return null;
  }
  function poolMoment() {
    if (pool === 'aafl') { var sb = nthDow(Y, 2, 0, 2); if (between(dk(add(sb, -6)), dk(sb))) return 'superbowl'; }
    if (pool === 'aahl' && CUP_FINAL) { var s = +CUP_FINAL.start.replace(/-/g, ''), e = +CUP_FINAL.end.replace(/-/g, ''); if (between(s, e)) return 'cup'; }
    return null;
  }

  // ---------- Building blocks ----------
  var box, css = '#aasn-season{position:fixed;inset:0;pointer-events:none;z-index:' + Z + ';overflow:hidden}#aasn-season *{pointer-events:none}'
    + '#aasn-season .glow{position:absolute;inset:0}'
    + '#aasn-season .fall{position:absolute;top:-40px;line-height:1;animation:aasnFall linear infinite;will-change:transform}'
    + '#aasn-season .rise{position:absolute;bottom:-40px;line-height:1;animation:aasnRise linear infinite;will-change:transform}'
    + '@keyframes aasnFall{0%{transform:translate(0,0) rotate(0)}50%{transform:translate(var(--dx),55vh) rotate(180deg)}100%{transform:translate(0,calc(100vh + 80px)) rotate(360deg)}}'
    + '@keyframes aasnRise{0%{transform:translate(0,0);opacity:0}10%{opacity:.9}100%{transform:translate(var(--dx),calc(-100vh - 80px));opacity:0}}'
    + '#aasn-season .lights{position:absolute;top:0;left:0;right:0;height:26px;display:flex;justify-content:space-around;background:linear-gradient(#0003,transparent)}'
    + '#aasn-season .lights i{width:9px;height:13px;margin-top:8px;border-radius:50% 50% 45% 45%;background:var(--b);box-shadow:0 0 8px 2px var(--b);animation:aasnTwinkle 1.6s ease-in-out infinite;animation-delay:var(--dl)}'
    + '@keyframes aasnTwinkle{0%,100%{opacity:1}50%{opacity:.35}}'
    + '#aasn-season .corner{position:absolute;bottom:8px;font-size:40px;line-height:1;filter:drop-shadow(0 0 10px var(--gc,#fff8))}'
    + '#aasn-season .corner.l{left:12px}#aasn-season .corner.r{right:12px}'
    + '#aasn-season .shine{animation:aasnShine 3s ease-in-out infinite}@keyframes aasnShine{0%,100%{filter:drop-shadow(0 0 4px #fff6)}50%{filter:drop-shadow(0 0 16px #fff)}}'
    + '#aasn-season .fly{position:absolute;left:-60px;font-size:30px;animation:aasnFlyBy 9s linear infinite}'
    + '@keyframes aasnFlyBy{0%,70%{transform:translate(0,0) rotate(0)}100%{transform:translate(calc(100vw + 120px),-60px) rotate(720deg)}}'
    + '#aasn-cd{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:' + (Z + 2) + ';pointer-events:none;padding:6px 14px;border-radius:999px;background:#000c;color:#FFD34D;font:600 13px/1.2 system-ui,sans-serif;letter-spacing:.06em;box-shadow:0 0 14px #FFB80088;font-variant-numeric:tabular-nums}'
    + '@media (max-width:600px){#aasn-season .corner{font-size:28px}}'
    + '@media (prefers-reduced-motion:reduce){#aasn-season .fall,#aasn-season .rise,#aasn-season .fly{display:none}#aasn-season .lights i,#aasn-season .shine{animation:none}}';
  function mount(glow) {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    box = document.createElement('div'); box.id = 'aasn-season'; box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="glow" style="background:' + glow + '"></div>';
    document.body.appendChild(box);
  }
  function html(h) { box.insertAdjacentHTML('beforeend', h); }
  var small = innerWidth < 600;
  function fall(items, n, size, color, up) {
    var h = ''; n = small ? Math.ceil(n / 2) : n;
    for (var i = 0; i < n; i++) {
      var dur = 9 + Math.random() * 12, s = size * (.6 + Math.random() * .7);
      h += '<div class="' + (up ? 'rise' : 'fall') + '" style="left:' + (Math.random() * 100).toFixed(1) + 'vw;font-size:' + s.toFixed(0) + 'px;' + (color ? 'color:' + color + ';' : '')
        + 'opacity:' + (.55 + Math.random() * .4).toFixed(2) + ';--dx:' + ((Math.random() - .5) * 120).toFixed(0) + 'px;animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + (-Math.random() * dur).toFixed(1) + 's">'
        + items[i % items.length] + '</div>';
    }
    html(h);
  }
  function corners(l, r, gc, cls) { html('<div class="corner l ' + (cls || '') + '" style="--gc:' + gc + '">' + l + '</div><div class="corner r ' + (cls || '') + '" style="--gc:' + gc + '">' + (r || l) + '</div>'); }
  function every(ms, fn) { fn(); setInterval(function () { if (!document.hidden) fn(); }, ms); }

  // ---------- Themes ----------
  var CANADA = ['#ff2d2d', '#ffffff'], GOLD = ['#FFB800', '#FFD34D', '#ffffff', '#c9a227'];
  var THEMES = {
    christmas: function () {
      mount('radial-gradient(ellipse at 50% -10%,rgba(180,220,255,.16),transparent 60%),radial-gradient(ellipse at 50% 120%,rgba(200,30,40,.10),transparent 60%)');
      var cols = ['#ff3b3b', '#3bff6a', '#ffd23b', '#3bb4ff', '#ff7af0'], h = '<div class="lights">', n = small ? 12 : 26;
      for (var i = 0; i < n; i++) h += '<i style="--b:' + cols[i % cols.length] + ';--dl:' + (-Math.random() * 1.6).toFixed(2) + 's"></i>';
      html(h + '</div>'); fall(['❄', '❅', '❆', '•'], 40, 18, '#eaf6ff'); corners('🎄', '🎁', '#7dff9a88');
    },
    newyear: function () {
      mount('radial-gradient(ellipse at 50% -10%,rgba(255,200,60,.16),transparent 60%),radial-gradient(ellipse at 50% 120%,rgba(120,80,255,.12),transparent 60%)');
      corners('🥂', '🎉', '#FFD34D88');
      if (M === 12) {
        var pill = document.createElement('div'); pill.id = 'aasn-cd'; document.body.appendChild(pill);
        var target = new Date(Y + 1, 0, 1), tick = function () {
          var nowT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })), ms = target - nowT;
          if (ms <= 0) { pill.textContent = '🎆 HAPPY NEW YEAR ' + (Y + 1) + '!'; every(1400, function () { firework(GOLD.concat(['#ff4d6d', '#4dd2ff'])); }); clearInterval(iv); return; }
          var h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
          pill.textContent = (Y + 1) + ' IN ' + h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
        }, iv = setInterval(tick, 1000); tick();
        every(9000, function () { confetti(innerWidth * Math.random(), -10, GOLD, 40); });
      } else { every(2200, function () { firework(GOLD.concat(['#ff4d6d', '#4dd2ff', '#9b6bff'])); }); }
    },
    valentine: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(255,60,120,.16),transparent 60%)');
      fall(['❤', '♥', '💕'], 22, 22, '#ff5a8a', true); corners('💘', '💝', '#ff5a8a88');
    },
    stpatrick: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(40,200,90,.16),transparent 60%)');
      fall(['☘', '🍀'], 26, 22, '#3ccf6a'); corners('🌈', '🪙', '#ffd34d88');
    },
    easter: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(255,190,230,.14),transparent 60%),radial-gradient(ellipse at 50% -10%,rgba(190,240,255,.10),transparent 60%)');
      fall(['🌸', '🌼', '🥚', '🌷'], 24, 20); corners('🐣', '🐰', '#ffe08a88');
    },
    canada: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(255,40,40,.16),transparent 60%)');
      fall(['🍁'], 24, 22); corners('🇨🇦', '🍁', '#ff4d4d88');
      if (M === 7 && D === 1) every(2000, function () { firework(CANADA); });
    },
    thanksgiving: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(230,120,30,.16),transparent 60%)');
      fall(['🍂', '🍁', '🍃'], 26, 22); corners('🦃', '🥧', '#ffb04d88');
    },
    superbowl: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(255,184,0,.18),transparent 60%)');
      html('<div class="fly" style="top:30vh">🏈</div>'); corners('🏆', '🏈', '#FFD34D88', 'shine');
      every(12000, function () { confetti(innerWidth * (.2 + Math.random() * .6), innerHeight * .25, GOLD, 70); });
    },
    opening: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(240,106,112,.16),transparent 60%)');
      html('<div class="fly" style="top:26vh">⚾</div>'); corners('⚾', '🧢', '#F06A7088');
      every(15000, function () { confetti(innerWidth / 2, innerHeight * .3, ['#F06A70', '#ffffff', '#1E3A6E', '#FFB800'], 90); });
    },
    cup: function () {
      mount('radial-gradient(ellipse at 50% -10%,rgba(220,230,240,.18),transparent 60%),radial-gradient(ellipse at 50% 120%,rgba(0,212,255,.10),transparent 60%)');
      corners('🏆', '🏒', '#e8eef588', 'shine');
      every(14000, function () { confetti(innerWidth * (.2 + Math.random() * .6), innerHeight * .2, ['#dfe6ee', '#ffffff', '#9fb3c8', '#00D4FF'], 60); });
    },
    halloween: function () {
      mount('radial-gradient(ellipse at 50% 120%,rgba(255,110,0,.16),transparent 60%),radial-gradient(ellipse at 50% -20%,rgba(120,40,200,.10),transparent 55%)');
      var BAT = '<svg viewBox="0 0 64 32" aria-hidden="true"><path d="M32 10c-2-4-4-5-4-5s0 3-1 5c-6-6-15-7-27-2 6 2 9 6 9 11 4-3 9-3 12 1 2-3 6-4 9-3l2 5 2-5c3-1 7 0 9 3 3-4 8-4 12-1 0-5 3-9 9-11-12-5-21-4-27 2-1-2-1-5-1-5s-2 1-4 5z" fill="#140a00"/></svg>';
      var GHOST = '<svg viewBox="0 0 60 72" aria-hidden="true"><path d="M30 2C14 2 4 14 4 30v40l9-7 8 7 9-7 9 7 8-7 9 7V30C56 14 46 2 30 2z" fill="#f4f1ea" opacity=".9"/><ellipse cx="21" cy="28" rx="4" ry="6" fill="#1a1a1a"/><ellipse cx="39" cy="28" rx="4" ry="6" fill="#1a1a1a"/><ellipse cx="30" cy="44" rx="5" ry="6" fill="#1a1a1a"/></svg>';
      var SPIDER = '<svg viewBox="0 0 40 40" aria-hidden="true"><g stroke="#140a00" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M14 16 4 8M14 20 2 20M14 24 4 32M16 27 9 38M26 16l10-8M26 20h12M26 24l10 8M24 27l7 11"/></g><ellipse cx="20" cy="22" rx="7" ry="8" fill="#140a00"/><circle cx="20" cy="12" r="5" fill="#140a00"/><circle cx="18" cy="11" r="1.2" fill="#ff7a00"/><circle cx="22" cy="11" r="1.2" fill="#ff7a00"/></svg>';
      var PUMPKIN = '<svg viewBox="0 0 64 60" aria-hidden="true"><path d="M30 10c0-5 2-8 6-9l2 3c-3 1-4 3-4 6z" fill="#3d6b1e"/><ellipse cx="18" cy="35" rx="15" ry="20" fill="#d9600b"/><ellipse cx="46" cy="35" rx="15" ry="20" fill="#d9600b"/><ellipse cx="32" cy="35" rx="16" ry="22" fill="#f07a12"/><g class="face" fill="#ffd34d"><path d="M17 28l7-6 4 8zM47 28l-7-6-4 8z"/><path d="M29 36h6l-3 5z"/><path d="M14 43q18 12 36 0l-4 6-4-3-4 4-4-4-4 4-4-4-4 3z"/></g></svg>';
      var WEB = '<svg viewBox="0 0 160 160" aria-hidden="true"><g stroke="#e8e2d6" stroke-width="1" fill="none" opacity=".55"><path d="M0 0 160 160M0 0 80 160M0 0 160 80M0 0 0 160M0 0 160 0"/><path d="M0 30Q16 20 30 0M0 60q30-22 60-60M0 95q50-38 95-95M0 135q70-60 135-135"/></g></svg>';
      var st = document.createElement('style'); st.textContent = '#aasn-season .web{position:absolute;top:0;width:120px;height:120px}' + '#aasn-season .web.l{left:0}#aasn-season .web.r{right:0;transform:scaleX(-1)}' + '#aasn-season .bat{position:absolute;left:-80px;width:46px;height:23px;filter:drop-shadow(0 0 3px rgba(255,122,0,.75));animation:aasnFly linear infinite}' + '#aasn-season .bat svg{animation:aasnFlap .22s ease-in-out infinite alternate;transform-origin:50% 40%}' + '#aasn-season .ghost{position:absolute;left:-90px;width:54px;height:64px;opacity:0;filter:drop-shadow(0 0 8px rgba(255,255,255,.35));animation:aasnGhost 22s ease-in-out infinite}' + '#aasn-season .spider{position:absolute;top:0;width:2px;animation:aasnDrop 16s ease-in-out infinite}' + '#aasn-season .spider i{position:absolute;top:0;left:0;width:1px;height:100%;background:rgba(232,226,214,.55)}' + '#aasn-season .spider svg{position:absolute;bottom:-26px;left:-15px;width:30px;height:30px;filter:drop-shadow(0 0 3px rgba(255,122,0,.6))}' + '#aasn-season .pk{position:absolute;bottom:10px;width:56px;height:52px;filter:drop-shadow(0 0 10px rgba(255,140,0,.7))}' + '#aasn-season .pk.l{left:12px}#aasn-season .pk.r{right:12px}' + '#aasn-season .pk .face{animation:aasnFlicker 2.4s infinite}#aasn-season .pk.r .face{animation-delay:-1.1s}' + '@keyframes aasnFlicker{0%,100%{opacity:1}8%{opacity:.6}12%{opacity:.95}40%{opacity:.8}44%{opacity:1}70%{opacity:.7}74%{opacity:.95}}' + '@keyframes aasnFly{0%{transform:translate(0,0)}25%{transform:translate(28vw,-30px)}50%{transform:translate(56vw,25px)}75%{transform:translate(84vw,-20px)}100%{transform:translate(calc(100vw + 160px),10px)}}' + '@keyframes aasnFlap{from{transform:scaleY(1)}to{transform:scaleY(.45)}}' + '@keyframes aasnGhost{0%,55%{transform:translate(0,0);opacity:0}60%{opacity:.85}80%{transform:translate(60vw,-40px);opacity:.85}100%{transform:translate(calc(100vw + 180px),10px);opacity:0}}' + '@keyframes aasnDrop{0%,60%,100%{height:0}72%,86%{height:42vh}}' + '@media (max-width:600px){#aasn-season .web{width:80px;height:80px}#aasn-season .bat{width:34px;height:17px}#aasn-season .pk{width:38px;height:36px;bottom:6px}}' + '@media (prefers-reduced-motion:reduce){#aasn-season .bat,#aasn-season .ghost,#aasn-season .spider{display:none}#aasn-season .pk .face{animation:none}}' + '<div class="pk l">' + PUMPKIN + '</div><div class="pk r">' + PUMPKIN + '</div>'; document.head.appendChild(st);
      var hh = '<div class="web l">' + WEB + '</div><div class="web r">' + WEB + '</div>'
        + '<div class="pk l">' + PUMPKIN + '</div><div class="pk r">' + PUMPKIN + '</div>';
      var bats = window.innerWidth < 600 ? 3 : 6;
      for (var i = 0; i < bats; i++) {
        var top = 8 + Math.random() * 55, dur = 14 + Math.random() * 14, delay = -Math.random() * dur;
        hh += '<div class="bat" style="top:' + top.toFixed(1) + 'vh;animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's">' + BAT + '</div>';
      }
      hh += '<div class="ghost" style="top:' + (20 + Math.random() * 40).toFixed(1) + 'vh;animation-delay:' + (-Math.random() * 10).toFixed(1) + 's">' + GHOST + '</div>';
      hh += '<div class="spider" style="left:' + (15 + Math.random() * 70).toFixed(1) + 'vw;animation-delay:' + (-Math.random() * 8).toFixed(1) + 's"><i></i>' + SPIDER + '</div>';
      html(hh);
    }
  };

  function start(name) { if (THEMES[name] && !document.getElementById('aasn-season')) THEMES[name](); }
  function run() {
    var forced = pref && pref !== 'off' && THEMES[pref] ? pref : null;
    if (forced) return start(forced);
    var name = poolMoment() || holiday();
    if (pool === 'aabl' && typeof AASN_SUPABASE_URL !== 'undefined' && typeof AASN_SUPABASE_KEY !== 'undefined') {
      // Opening Day comes from AABL's config (the picks deadline).
      fetch(AASN_SUPABASE_URL + '/rest/v1/config?select=opening_day&order=season.desc&limit=1', { headers: { apikey: AASN_SUPABASE_KEY, Authorization: 'Bearer ' + AASN_SUPABASE_KEY, 'Accept-Profile': 'aabl' } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (j) {
          var od = j[0] && j[0].opening_day;
          if (od) { var o = new Date(new Date(od).toLocaleString('en-US', { timeZone: 'America/Toronto' })); if (dk(o) === today) name = 'opening'; }
          start(name);
        }).catch(function () { start(name); });
      return;
    }
    start(name);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
