-- AABL 004 — standings split into players + division bonus; teams view exposes trades used.
-- Already applied to the Supabase project on Oct 21, 2026.
alter table aabl.standings
  add column players_points numeric not null default 0,
  add column division_bonus numeric not null default 0;
create or replace view aabl.teams as
  select entry_id, season, team_name, manager_name, created_at, moves_used
  from aabl.entries;
grant select on aabl.teams to anon, authenticated;
