-- AABL 013 — tiebreakers. Rank = total points, then HR + RBI by current hitter
-- picks, then strikeouts by current pitcher picks (each counted only while the
-- player is on the team, same window as points). Still tied = shared rank,
-- and the site splits those places' prize money evenly.
-- Already applied to the Supabase project on Oct 22, 2026.
alter table aabl.standings add column if not exists tb_hr_rbi int not null default 0,
  add column if not exists tb_k int not null default 0;

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
  ), pick_stats as (
    select pk.entry_id, pk.banked_points, o.role,
      coalesce(sum(g.points), 0) as pts, coalesce(sum(g.hr + g.rbi), 0) as hr_rbi, coalesce(sum(g.k), 0) as k
    from aabl.picks pk
    join aabl.box_options o on o.option_id = pk.option_id
    left join since s on s.entry_id = pk.entry_id and s.box_id = pk.box_id
    left join aabl.stats_game g on g.mlb_id = o.mlb_id and g.role = o.role
      and extract(year from g.game_date) = p_stats_season
      and g.game_date <= p_date
      and g.game_date >= coalesce(s.since, date '1900-01-01')
    where pk.season = p_pool_season
    group by pk.entry_id, pk.box_id, pk.banked_points, o.role
  ), pick_pts as (
    select entry_id, sum(banked_points + pts) as players,
      sum(case when role = 'hitter' then hr_rbi else 0 end)::int as tb1,
      sum(case when role = 'pitcher' then k else 0 end)::int as tb2
    from pick_stats group by entry_id
  ), bonus as (
    select d.entry_id, 25 * count(*) as bonus
    from aabl.division_picks d
    join aabl.division_winners w on w.division = d.division and w.team_abbr = d.team_abbr and w.season = p_stats_season
    group by d.entry_id
  ), totals as (
    select e.entry_id, coalesce(p.players, 0) as players, coalesce(b.bonus, 0) as bonus,
      coalesce(p.tb1, 0) as tb1, coalesce(p.tb2, 0) as tb2
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
  insert into aabl.standings (season, snapshot_date, entry_id, players_points, division_bonus, points, last_night, rank, tb_hr_rbi, tb_k)
  select p_pool_season, p_date, t.entry_id, t.players, t.bonus, t.players + t.bonus,
    t.players - coalesce(pv.players_points, 0),
    rank() over (order by t.players + t.bonus desc, t.tb1 desc, t.tb2 desc),
    t.tb1, t.tb2
  from totals t left join prev pv on pv.entry_id = t.entry_id
  on conflict (season, snapshot_date, entry_id) do update set
    players_points = excluded.players_points, division_bonus = excluded.division_bonus,
    points = excluded.points, last_night = excluded.last_night, rank = excluded.rank,
    tb_hr_rbi = excluded.tb_hr_rbi, tb_k = excluded.tb_k;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function aabl.snapshot_standings(int, int, date) from public, anon, authenticated;
