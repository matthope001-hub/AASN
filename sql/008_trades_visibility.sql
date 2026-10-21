-- AABL 008 — trades stay hidden like picks until the pick deadline
-- (a pre-season trade reveals who picked whom). Applied Oct 21, 2026.
alter policy read_all on aabl.trades
  using (aabl.picks_locked() or aabl.is_admin() or aabl.owns_entry(entry_id));
