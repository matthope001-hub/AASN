-- AABL 002 — public per-team counts of division picks (no individual picks exposed).
-- Already applied to the Supabase project on Oct 21, 2026.
create view aabl.division_pick_counts as
  select e.season, d.division, d.team_abbr, count(*)::int as picks
  from aabl.division_picks d join aabl.entries e using (entry_id)
  group by e.season, d.division, d.team_abbr;
grant select on aabl.division_pick_counts to anon, authenticated;
