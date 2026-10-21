-- AABL 005 — nightly pipeline helpers (applied Oct 21, 2026 as aabl_005_nightly_functions).
-- aabl.rebuild_season_stats(season): stats_season rebuilt from stats_game.
-- aabl.snapshot_standings(pool_season, stats_season, date): one standings snapshot.
--   Player points = banked + current pick's points to date; a pick from an in-season
--   trade counts from the trade date; original picks (incl. late entries) from day 1.
--   Division bonus = 25 per pick matching the current leader (projected until final).
-- aabl.job_runs: pipeline log. Both functions are service-role only.

create or replace function aabl.rebuild_season_stats(p_season int)
returns int
language plpgsql security definer
set search_path = aabl
as $$
declare n int;
begin
  insert into aabl.stats_season (season, mlb_id, role, games,
    singles, doubles, triples, hr, rbi, runs, bb, hbp, sb, so, cs,
    outs, k, w, qs, sv, hld, er, l, bb_allowed, h_allowed, points, updated_at)
  select p_season, mlb_id, role, count(distinct game_pk),
    sum(singles), sum(doubles), sum(triples), sum(hr), sum(rbi), sum(runs), sum(bb), sum(hbp), sum(sb), sum(so), sum(cs),
    sum(outs), sum(k), sum(w), sum(qs), sum(sv), sum(hld), sum(er), sum(l), sum(bb_allowed), sum(h_allowed),
    sum(points), now()
  from aabl.stats_game
  where extract(year from game_date) = p_season
  group by mlb_id, role
  on conflict (season, mlb_id, role) do update set
    games = excluded.games, singles = excluded.singles, doubles = excluded.doubles, triples = excluded.triples,
    hr = excluded.hr, rbi = excluded.rbi, runs = excluded.runs, bb = excluded.bb, hbp = excluded.hbp,
    sb = excluded.sb, so = excluded.so, cs = excluded.cs, outs = excluded.outs, k = excluded.k, w = excluded.w,
    qs = excluded.qs, sv = excluded.sv, hld = excluded.hld, er = excluded.er, l = excluded.l,
    bb_allowed = excluded.bb_allowed, h_allowed = excluded.h_allowed, points = excluded.points, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function aabl.snapshot_standings(p_pool_season int, p_stats_season int, p_date date)
returns int
language plpgsql security definer
set search_path = aabl
as $$
declare n int;
begin
  with since as (
    select t.entry_id, t.box_id, max(t.made_at)::date as since
    from aabl.trades t
    where t.preseason = false
    group by t.entry_id, t.box_id
  ), pick_pts as (
    select pk.entry_id,
      sum(pk.banked_points + coalesce((
        select sum(g.points) from aabl.stats_game g
        where g.mlb_id = o.mlb_id and g.role = o.role
          and extract(year from g.game_date) = p_stats_season
          and g.game_date <= p_date
          and g.game_date >= coalesce(s.since, date '1900-01-01')
      ), 0)) as players
    from aabl.picks pk
    join aabl.box_options o on o.option_id = pk.option_id
    left join since s on s.entry_id = pk.entry_id and s.box_id = pk.box_id
    where pk.season = p_pool_season
    group by pk.entry_id
  ), bonus as (
    select d.entry_id, 25 * count(*) as bonus
    from aabl.division_picks d
    join aabl.division_winners w on w.division = d.division and w.team_abbr = d.team_abbr and w.season = p_stats_season
    group by d.entry_id
  ), totals as (
    select e.entry_id, coalesce(p.players, 0) as players, coalesce(b.bonus, 0) as bonus
    from aabl.entries e
    left join pick_pts p on p.entry_id = e.entry_id
    left join bonus b on b.entry_id = e.entry_id
    where e.season = p_pool_season
  ), prev as (
    select distinct on (entry_id) entry_id, players_points
    from aabl.standings
    where season = p_pool_season and snapshot_date < p_date
    order by entry_id, snapshot_date desc
  )
  insert into aabl.standings (season, snapshot_date, entry_id, players_points, division_bonus, points, last_night, rank)
  select p_pool_season, p_date, t.entry_id, t.players, t.bonus, t.players + t.bonus,
    t.players - coalesce(pv.players_points, 0),
    rank() over (order by t.players + t.bonus desc)
  from totals t left join prev pv on pv.entry_id = t.entry_id
  on conflict (season, snapshot_date, entry_id) do update set
    players_points = excluded.players_points, division_bonus = excluded.division_bonus,
    points = excluded.points, last_night = excluded.last_night, rank = excluded.rank;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function aabl.rebuild_season_stats(int) from public, anon, authenticated;
revoke all on function aabl.snapshot_standings(int, int, date) from public, anon, authenticated;
grant execute on function aabl.rebuild_season_stats(int) to service_role;
grant execute on function aabl.snapshot_standings(int, int, date) to service_role;

create table aabl.job_runs (
  id          bigserial primary key,
  job         text not null,
  run_date    date,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  detail      jsonb
);
alter table aabl.job_runs enable row level security;
create policy read_all on aabl.job_runs for select using (true);
grant select on aabl.job_runs to anon, authenticated;
grant all on aabl.job_runs to service_role;
grant usage, select on sequence aabl.job_runs_id_seq to service_role;
