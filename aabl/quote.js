/* Quote of the Day — AABL
 * Shows one quote per day in a shuffled order (no repeats until the whole list has shown).
 * Same quote for everyone all day; changes at midnight Toronto time.
 * To add quotes, add a line to QUOTES: ["Quote text", "Who said it"].
 */
(function () {
  var QUOTES = [
    ["It ain't over till it's over.", "Yogi Berra"],
    ["Baseball is ninety percent mental. The other half is physical.", "Yogi Berra"],
    ["It's déjà vu all over again.", "Yogi Berra"],
    ["When you come to a fork in the road, take it.", "Yogi Berra"],
    ["Nobody goes there anymore. It's too crowded.", "Yogi Berra"],
    ["You can observe a lot by watching.", "Yogi Berra"],
    ["How can you think and hit at the same time?", "Yogi Berra"],
    ["Today I consider myself the luckiest man on the face of the earth.", "Lou Gehrig"],
    ["There's no crying in baseball!", "Jimmy Dugan, A League of Their Own"],
    ["If you build it, he will come.", "Field of Dreams"],
    ["Whoever wants to know the heart and mind of America had better learn baseball.", "Jacques Barzun"],
    ["People ask me what I do in winter when there's no baseball. I'll tell you what I do. I stare out the window and wait for spring.", "Rogers Hornsby"],
    ["Let's play two!", "Ernie Banks"],
    ["Nice guys finish last.", "Leo Durocher"],
    ["Hitting is timing. Pitching is upsetting timing.", "Warren Spahn"],
    ["Baseball is the only field of endeavor where a man can succeed three times out of ten and be considered a good performer.", "Ted Williams"],
    ["All I want out of life is that when I walk down the street folks will say, 'There goes the greatest hitter who ever lived.'", "Ted Williams"],
    ["Hit 'em where they ain't.", "Wee Willie Keeler"],
    ["The Giants win the pennant! The Giants win the pennant!", "Russ Hodges, 1951"],
    ["I don't believe what I just saw!", "Jack Buck, 1988"],
    ["Go crazy, folks! Go crazy!", "Jack Buck, 1985"],
    ["And we'll see you tomorrow night!", "Jack Buck, 1991"],
    ["Touch 'em all, Joe! You'll never hit a bigger home run in your life!", "Tom Cheek, 1993"],
    ["In a year that has been so improbable, the impossible has happened.", "Vin Scully, 1988"],
    ["It's time for Dodger baseball!", "Vin Scully"],
    ["Don't let us win tonight.", "Kevin Millar, 2004"],
    ["Don't look back. Something might be gaining on you.", "Satchel Paige"],
    ["Age is a question of mind over matter. If you don't mind, it doesn't matter.", "Satchel Paige"],
    ["I'd walk through hell in a gasoline suit to play baseball.", "Pete Rose"],
    ["Ninety feet between home plate and first base may be the closest man has ever come to perfection.", "Red Smith"],
    ["Baseball is dull only to dull minds.", "Red Barber"],
    ["Baseball, it is said, is only a game. True. And the Grand Canyon is only a hole in Arizona.", "George Will"],
    ["Can't anybody here play this game?", "Casey Stengel"],
    ["The secret of managing is to keep the guys who hate you away from the guys who are undecided.", "Casey Stengel"],
    ["I'll never make the mistake of being seventy again.", "Casey Stengel"]
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
    var n = QUOTES.length, d = todayNum(), cycle = Math.floor(d / n), r = rng(cycle * 7919 + 400);
    var order = QUOTES.map(function (_, i) { return i; });
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    return QUOTES[order[d % n]];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    var el = document.getElementById('daily-quote');
    if (!el || !QUOTES.length) return;
    var st = document.createElement('style');
    st.textContent = '.dq{margin:0 0 20px;padding:14px 18px;background:#0E2340;border:1px solid #25446E;border-left:3px solid #BD3039;border-radius:4px}.dq-l{display:block;font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:1px;color:#F06A70;margin-bottom:6px}.dq-q{margin:0;font-family:"Bosox",serif;font-size:21px;line-height:1.3;color:#E8EDF1}.dq-a{margin-top:6px;font-family:"JetBrains Mono",monospace;font-size:12px;color:#A9B8CC}';
    document.head.appendChild(st);
    var q = pick();
    el.innerHTML = '<figure class="dq"><span class="dq-l">QUOTE OF THE DAY</span>' +
      '<blockquote class="dq-q">\u201C' + esc(q[0]) + '\u201D</blockquote>' +
      '<figcaption class="dq-a">\u2014 ' + esc(q[1]) + '</figcaption></figure>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
