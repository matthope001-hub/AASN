-- AABL 010 — "Picked by" counts per box option. Empty until picks lock,
-- so nobody can see what others picked before the deadline.
-- Already applied to the Supabase project on Oct 21, 2026.
create view aabl.pick_counts as
  select p.season, p.option_id, count(*)::int as picks
  from aabl.picks p
  where aabl.picks_locked()
  group by p.season, p.option_id;
grant select on aabl.pick_counts to anon, authenticated;
