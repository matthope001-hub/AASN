/* AAFL menu helper: shows the ⚙️ Admin tab to the commissioner only (signed in). */
(function () {
  async function paint() {
    const ok = window.aasnIsAdmin ? await window.aasnIsAdmin() : false;
    document.querySelectorAll('.nav-admin').forEach(a => { a.hidden = !ok; });
  }
  paint();
  if (window.aasnAuth && aasnAuth.onChange) aasnAuth.onChange(paint);
  window.addEventListener('storage', paint);
})();
