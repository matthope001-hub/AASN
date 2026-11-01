/* Quote of the Day — AAFL
 * One quote per day, counted from opening day (2026-09-09), in a shuffled order.
 * Every day of the regular season gets a different quote; after that the list reshuffles.
 * Same quote for everyone all day; changes at midnight Toronto time.
 * To add quotes, add a line to QUOTES: ["Quote text", "Who said it"].
 */
(function () {
  var SEASON_START = '2026-09-09';
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
    ["Publicity is like poison; it doesn't hurt unless you swallow it.", "Joe Paterno"],
    ["The dictionary is the only place that success comes before work.", "Vince Lombardi"],
    ["Winning is not everything, but making the effort to win is.", "Vince Lombardi"],
    ["Winners never quit and quitters never win.", "Vince Lombardi"],
    ["There is no defense against a perfect pass. I can throw a perfect pass.", "Dan Marino"],
    ["I love me some me!", "Terrell Owens"],
    ["Getcha popcorn ready.", "Terrell Owens"],
    ["If you have two quarterbacks, you actually have none.", "John Madden"],
    ["If you see a defense team with dirt and mud on their backs they've had a bad day.", "John Madden"],
    ["Self-praise is for losers. Be a winner. Stand for something. Always have class, and be humble.", "John Madden"],
    ["Wins and losses come a dime a dozen. But effort? Nobody can judge that. Because effort is between you and you.", "Ray Lewis"],
    ["When you're good at something, you'll tell everyone. When you're great at something, they'll tell you.", "Walter Payton"],
    ["Success isn't owned, it's leased. And rent is due every day.", "J.J. Watt"],
    ["Today I will do what others won't, so tomorrow I will accomplish what others can't.", "Jerry Rice"],
    ["I feel like I'm the best, but you're not going to get me to say that.", "Jerry Rice"],
    ["Pressure is something you feel when you don't know what the hell you're doing.", "Peyton Manning"],
    ["The most valuable player is the one who makes the most players valuable.", "Peyton Manning"],
    ["You fail all the time, but you aren't a failure until you start blaming someone else.", "Bum Phillips"],
    ["Football is a game of errors. The team that makes the fewest errors in a game usually wins.", "Paul Brown"],
    ["You can learn a line from a win and a book from defeat.", "Paul Brown"],
    ["You cannot make progress with excuses.", "Cam Newton"],
    ["It's not the size of the dog in the fight, but the size of the fight in the dog.", "Archie Griffin"],
    ["Work isn't work unless you would rather be doing something else.", "Don Shula"],
    ["Nobody who ever gave his best regretted it.", "George Halas"],
    ["Excuses are the tools of the incompetent.", "Mike Tomlin"],
    ["Success isn't measured by money or power or social rank. Success is measured by your discipline and inner peace.", "Mike Ditka"],
    ["Leadership is a matter of having people look at you and gain confidence. If you're in control, they're in control.", "Tom Landry"],
    ["When you've got something to prove, there's nothing greater than a challenge.", "Terry Bradshaw"],
    ["I may be dumb, but I'm not stupid.", "Terry Bradshaw"],
    ["When you don't give up, you cannot fail.", "Adrian Peterson"],
    ["I may win and I may lose, but I will never be defeated.", "Emmitt Smith"],
    ["If you want to win, do the ordinary things better than anyone else does them day in and day out.", "Chuck Noll"],
    ["Stay focused. Your start does not determine how you're going to finish.", "Herm Edwards"],
    ["If you are afraid of confrontation, you are not going to do very well.", "Bill Parcells"],
    ["Adversity is an opportunity for heroism.", "Marv Levy"],
    ["The difference between ordinary and extraordinary is that little extra.", "Jimmy Johnson"],
    ["Failures are expected by losers, ignored by winners.", "Joe Gibbs"],
    ["My philosophy? Simplicity plus variety.", "Hank Stram"],
    ["I want to rush for 1,000 or 1,500 yards, whichever comes first.", "George Rogers"],
    ["All Grange can do is run. And all Caruso can do is sing.", "Bob Zuppke"],
    ["If you're mad at your kid, you can either raise him to be a nose tackle or send him out to play on the freeway.", "Bob Golic"],
    ["The shoulder surgery was a success. The lobotomy failed.", "Mike Ditka"],
    ["I like to believe that my best hits border on felonious assault.", "Jack Tatum"],
    ["Nobody in football should be called a genius. A genius is a guy like Norman Einstein.", "Joe Theismann"],
    ["He couldn't spell 'cat' if you spotted him the 'C' and the 'T'.", "Thomas \"Hollywood\" Henderson, on Terry Bradshaw"],
    ["I'm in favor of it.", "John McKay, asked about his team's execution"],
    ["We can't run. We can't pass. We can't stop the run. We can't stop the pass. We can't kick. Other than that, we're just not a very good football team right now.", "Bruce Coslet"],
    ["I wouldn't ever set out to hurt anyone deliberately unless it was important. Like a league game.", "Dick Butkus"],
    ["I've been big ever since I was little.", "William \"The Refrigerator\" Perry"],
    ["Straight cash, homey.", "Randy Moss"],
    ["We couldn't do diddly poo offensively.", "Jim Mora"],
    ["You want a messenger boy, call Western Union.", "Joe Don Looney"],
    ["If the Super Bowl is really the ultimate game, why do they play it again next year?", "Duane Thomas"],
    ["Trade him for a six pack. It doesn't even have to be cold.", "Buddy Ryan"],
    ["Cap Boso? How could I cut a guy with a name like that?", "Mike Ditka"],
    ["George Halas throws nickels around like manhole covers.", "Mike Ditka"],
    ["I'm broke and I'm back.", "John Riggins"],
    ["Three or four plane crashes and we're in the playoffs.", "John McKay"],
    ["That's unfortunate, as I plan on attending all the games.", "John McKay, on a kicker nervous about being watched"],
    ["He's not twins.", "John McKay, asked about a linebacker's weaknesses"],
    ["We didn't tackle well today, but we made up for it by not blocking.", "John McKay"],
    ["We stunk. We blocked bad; we were terrible on defense and our kicking game made up for it by being absolutely horrible.", "John McKay"],
    ["If me and King Kong went into an alley, only one of us would come out. And it wouldn't be the monkey.", "Lyle Alzado"],
    ["It's a humbling thing being humble.", "Maurice Clarett"],
    ["He treats us like men. He lets us wear earrings.", "Torrin Polk"],
    ["People say I'll be drafted in the first round, maybe even higher.", "Craig \"Ironhead\" Heyward"],
    ["You can learn more character on the two-yard line than anywhere else in life.", "Paul Dietzel"],
    ["Lads, you're not to miss practice unless your parents died or you died.", "Frank Leahy"],
    ["I make my practices real hard because if a player is a quitter, I want him to quit in practice, not in a game.", "Paul \"Bear\" Bryant"],
    ["There are two things every man in America thinks he can do: work a grill and coach football.", "Greg Schiano"],
    ["If lessons are learned in defeat, our team is getting a great education.", "Murray Warmath"],
    ["That boy don't know the meaning of the word fear. In fact, I just saw his grades, and that boy don't know the meaning of a lot of words.", "Bobby Bowden"],
    ["There are two kinds of people in the world, Notre Dame lovers and Notre Dame haters.", "Dan Devine"],
    ["When you win, nothing hurts.", "Joe Namath"],
    ["We'll fight 'em until hell freezes over, then we'll fight 'em on the ice.", "Dutch Meyer"],
    ["Because I couldn't go for three.", "Woody Hayes, on why he went for two"],
    ["Motivation is simple. You eliminate those who are not motivated.", "Lou Holtz"],
    ["Always remember, Goliath was a 40-point favorite over David.", "Shug Jordan"],
    ["If you train hard, you'll not only be hard, you'll be hard to beat.", "Herschel Walker"],
    ["Football doesn't build character, it reveals character.", "Marv Levy"],
    ["Most football players are temperamental. That's 90 percent temper and 10 percent mental.", "Doug Plank"],
    ["Set your goals high, and don't stop till you get there.", "Bo Jackson"],
    ["You need to play with supreme confidence, or else you'll lose again, and then losing becomes a habit.", "Joe Paterno"],
    ["One man practicing sportsmanship is far better than 50 preaching it.", "Knute Rockne"],
    ["A good coach will make his players see what they can be rather than what they are.", "Ara Parseghian"],
    ["The fewer rules a coach has, the fewer rules there are for players to break.", "John Madden"],
    ["Do you know what my favorite part of the game is? The opportunity to play.", "Mike Singletary"],
    ["I learned that if you want to make it bad enough, no matter how bad it is, you can make it.", "Gale Sayers"],
    ["What's the difference between a three-week-old puppy and a sportswriter? In six weeks, the puppy stops whining.", "Mike Ditka"],
    ["Mike Vick! You can't come this way.", "Clay Matthews"],
    ["I'm beating these guys like a drum out here.", "J.J. Watt"],
    ["This isn't even a football game. This is a historical event.", "Chad Johnson"],
    ["I'm traveling to all 51 states to see who can stop 85.", "Chad Johnson"],
    ["Everybody in the world now knows I don't know how to spell communication.", "Brandon Marshall"],
    ["Either my head is getting bigger or these hats are getting smaller.", "Brett Favre"],
    ["The Green Bay Packers never lost a football game. They just ran out of time.", "Vince Lombardi"],
    ["When you played for Lombardi, anything other than death was a minor injury.", "Bart Starr"],
    ["When you're rich, you don't write checks.", "Randy Moss"],
    ["The NFL, like life, is full of idiots.", "Randy Cross"],
    ["I don't think there's anybody in this organization not focused on the 49ers... I mean Chargers.", "Bill Belichick"],
    ["The only way to stop Jim Brown was to give him a movie contract.", "Spider Lockhart"],
    ["Football is an incredible game. Sometimes it's so incredible, it's unbelievable.", "Tom Landry"],
    ["You guys line up alphabetically by height.", "Bill Peterson"]
  ];

  function dayNum(s) { var p = s.split('-'); return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function todayNum() { return dayNum(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date())); }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick() {
    var n = QUOTES.length, idx = todayNum() - dayNum(SEASON_START);
    var cycle = Math.floor(idx / n), pos = idx - cycle * n, r = rng(cycle * 7919 + 404);
    var order = QUOTES.map(function (_, i) { return i; });
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    return QUOTES[order[pos]];
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
