/* AABL live "Tonight" points (written every minute by the Worker during games).
 * aablLive.get()               -> the live row, or null
 * aablLive.active(live, latest)-> true while it's for a night newer than the
 *                                 official standings (the 4am run takes over).
 * aablLive.TEAM_ABBR           -> MLB team id -> abbreviation */
(function () {
  const TEAM_IDS = { AZ:109, ATL:144, BAL:110, BOS:111, CHC:112, CWS:145, CIN:113, CLE:114, COL:115, DET:116, HOU:117, KC:118, LAA:108, LAD:119, MIA:146, MIL:158, MIN:142, NYM:121, NYY:147, ATH:133, PHI:143, PIT:134, SD:135, SF:137, SEA:136, STL:138, TB:139, TEX:140, TOR:141, WSH:120 };
  const TEAM_ABBR = Object.fromEntries(Object.entries(TEAM_IDS).map(([a, id]) => [id, a]));
  async function get() {
    try { const r = await aasnSelect('live', 'select=game_date,players,entries,games,updated_at&id=eq.1', 'aabl'); return r[0] || null; }
    catch (e) { return null; }
  }
  function active(live, latest) {
    if (!live || !live.game_date) return false;
    if (latest && live.game_date <= latest) return false;
    return Date.now() - new Date(live.updated_at).getTime() < 14 * 3600000;
  }
  window.aablLive = { get, active, TEAM_ABBR };
})();
