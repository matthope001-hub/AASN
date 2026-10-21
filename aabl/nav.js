/**
 * nav.js — AABL site menu, same items as AAHL's header.
 * Usage: <nav id="aabl-nav" aria-label="AABL" data-active="players"></nav>
 * Pages not built yet go to soon.html.
 */
(function () {
  const soon = name => 'soon.html?p=' + encodeURIComponent(name);
  const MAIN = [
    ['home', 'Home', './'],
    ['standings', 'Standings', 'standings.html'],
    ['players', 'Players', 'players.html'],
    ['lastnight', 'Last Night', 'lastnight.html'],
    ['myteam', 'My Team', 'myteam.html']
  ];
  const MORE = [
    ['schedule', 'Schedule', 'schedule.html'],
    ['records', 'Records', 'records.html'],
    ['ir', 'IR List', 'ir.html'],
    ['boxes', 'Boxes', 'boxes.html'],
    ['activity', 'Activity', 'activity.html'],
    ['rules', 'Rules', 'rules.html'],
    ['signup', 'Sign Up', 'signup.html'],
    ['whatsnew', "What's New", 'whatsnew.html'],
    ['admin', '⚙️ Admin', 'admin.html']
  ];

  const css = `
  #aabl-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; }
  #aabl-nav a.nl, #aabl-nav .more-btn { color: #A9B8CC; text-decoration: none; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 16px; letter-spacing: .5px; text-transform: uppercase; padding: 12px 0 4px; border: 0; border-bottom: 2px solid transparent; background: none; cursor: pointer; }
  #aabl-nav a.nl:hover, #aabl-nav a.nl.active, #aabl-nav .more-btn:hover, #aabl-nav .more-btn.active, #aabl-nav .more-btn[aria-expanded="true"] { color: #F06A70; border-bottom-color: #F06A70; }
  #aabl-nav .more { position: relative; }
  #aabl-nav .more-menu { display: none; position: absolute; right: 0; top: calc(100% + 6px); min-width: 190px; background: #132E52; border: 1px solid #25446E; border-top: 3px solid #BD3039; padding: 6px 0; z-index: 100; box-shadow: 0 12px 28px rgba(0,0,0,.45); }
  #aabl-nav .more-menu.open { display: block; }
  #aabl-nav .more-menu a { display: flex; align-items: center; min-height: 44px; padding: 0 16px; color: #E8EDF1; text-decoration: none; font-family: 'Barlow Condensed', sans-serif; font-weight: 600; font-size: 16px; letter-spacing: .5px; text-transform: uppercase; }
  #aabl-nav .more-menu a:hover, #aabl-nav .more-menu a:focus-visible { background: #1A3860; color: #F06A70; outline: none; }
  #aabl-nav .more-menu a.active { color: #F06A70; }
  #aabl-nav .more-menu hr { border: 0; border-top: 1px solid #25446E; margin: 6px 0; }
  @media (max-width: 640px) { #aabl-nav { gap: 14px; } #aabl-nav .more-menu { right: auto; left: 0; } }`;

  function build() {
    const nav = document.getElementById('aabl-nav');
    if (!nav) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const active = nav.dataset.active || '';
    const moreActive = MORE.some(([k]) => k === active);
    const link = ([k, label, href], cls) => `<a class="${cls}${k === active ? ' active' : ''}" href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`;
    nav.innerHTML = MAIN.map(i => link(i, 'nl')).join('') + `
      <div class="more">
        <button type="button" class="more-btn${moreActive ? ' active' : ''}" aria-haspopup="true" aria-expanded="false" aria-controls="aabl-more-menu">More ▾</button>
        <div class="more-menu" id="aabl-more-menu" role="menu">
          ${MORE.slice(0, -1).map(i => link(i, '')).join('')}<hr>${link(MORE[MORE.length - 1], '')}
        </div>
      </div>`;

    const btn = nav.querySelector('.more-btn'), menu = nav.querySelector('.more-menu');
    const setOpen = open => { menu.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); };
    btn.addEventListener('click', e => { e.stopPropagation(); setOpen(!menu.classList.contains('open')); });
    document.addEventListener('click', e => { if (!nav.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { setOpen(false); btn.focus(); } });

    // Red dot on More and What's New when there are entries this browser hasn't seen.
    if (active !== 'whatsnew') {
      fetch('whatsnew.json', { cache: 'no-cache' }).then(r => r.json()).then(list => {
        let seen = 0; try { seen = Number(localStorage.getItem('aabl_whatsnew_seen') || 0); } catch (e) { /* ignore */ }
        if (list.length > seen) {
          const dot = '<span aria-label="new" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#F06A70;margin-left:5px;vertical-align:middle"></span>';
          btn.insertAdjacentHTML('beforeend', dot);
          const wn = menu.querySelector('a[href="whatsnew.html"]'); if (wn) wn.insertAdjacentHTML('beforeend', dot);
        }
      }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
