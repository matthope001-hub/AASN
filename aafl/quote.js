/* Quote of the Day — AAFL
 * Shows one quote per day in a shuffled order (no repeats until the whole list has shown).
 * Same quote for everyone all day; changes at midnight Toronto time.
 * To add quotes, add a line to QUOTES: ["Quote text", "Who said it"].
 */
(function () {
  var QUOTES = [
    ["You play to win the game!", "Herm Edwards"],
    ["They are who we thought they were!", "Dennis Green"],
    ["Playoffs? Don't talk about playoffs! You kidding me? Playoffs?", "Jim Mora"],
    ["Win just one for the Gipper.", "Knute Rockne"],
    ["Football isn't a contact sport, it's a collision sport. Dancing is a contact sport.", "Duffy Daugherty"],
    ["A tie is like kissing your sister.", "Duffy Daugherty"],
    ["Do your job.", "Bill Belichick"],
    ["We're on to Cincinnati.", "Bill Belichick"],
    ["It's not whether you get knocked down; it's whether you get up.", "Vince Lombardi"],
    ["Perfection is not attainable, but if we chase perfection we can catch excellence.", "Vince Lombardi"],
    ["If you're not fired with enthusiasm, you'll be fired with enthusiasm.", "Vince Lombardi"],
    ["The road to Easy Street goes through the sewer.", "John Madden"],
    ["You're never as good as everyone tells you when you win, and you're never as bad as they say when you lose.", "Lou Holtz"],
    ["No one has ever drowned in sweat.", "Lou Holtz"],
    ["Ability is what you're capable of doing. Motivation determines what you do. Attitude determines how well you do it.", "Lou Holtz"],
    ["Offense sells tickets, but defense wins championships.", "Paul \"Bear\" Bryant"],
    ["It's not the will to win that matters. Everyone has that. It's the will to prepare to win that matters.", "Paul \"Bear\" Bryant"],
    ["I'm just here so I won't get fined.", "Marshawn Lynch, 2015"],
    ["We're gonna win Sunday. I guarantee it.", "Joe Namath, 1969"],
    ["You are what your record says you are.", "Bill Parcells"],
    ["When you win, say nothing. When you lose, say less.", "Paul Brown"],
    ["Publicity is like poison; it doesn't hurt unless you swallow it.", "Joe Paterno"]
  ];

  function todayNum() {
    var s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
    var p = s.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5);
  }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick() {
    var n = QUOTES.length, d = todayNum(), cycle = Math.floor(d / n), r = rng(cycle * 7919 + 404);
    var order = QUOTES.map(function (_, i) { return i; });
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    return QUOTES[order[d % n]];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    var el = document.getElementById('daily-quote');
    if (!el || !QUOTES.length) return;
    var st = document.createElement('style');
    st.textContent = '.dq{margin:0 0 16px;padding:14px 16px;background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--sil2);border-radius:10px}.dq-l{display:block;font-family:var(--display);font-size:12px;letter-spacing:1px;color:var(--mut);margin-bottom:6px}.dq-q{margin:0;font-family:var(--body);font-weight:600;font-size:20px;line-height:1.3;color:var(--txt)}.dq-a{margin-top:6px;font-family:var(--body);font-size:15px;color:var(--mut)}';
    document.head.appendChild(st);
    var q = pick();
    el.innerHTML = '<figure class="dq"><span class="dq-l">QUOTE OF THE DAY</span>' +
      '<blockquote class="dq-q">\u201C' + esc(q[0]) + '\u201D</blockquote>' +
      '<figcaption class="dq-a">\u2014 ' + esc(q[1]) + '</figcaption></figure>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
