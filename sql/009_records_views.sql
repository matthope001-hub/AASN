-- AABL 009 — Records page views (applied Oct 21, 2026 as aabl_009_records_views).
create view aabl.records_best_games as
  select g.mlb_id, g.role, g.game_date, g.game_pk, extract(year from g.game_date)::int as season, g.points,
         g.singles + g.doubles + g.triples + g.hr as hits, g.hr, g.rbi, g.runs, g.sb,
         g.outs, g.k, g.er, g.w, g.qs, g.sv
  from aabl.stats_game g
  join aabl.box_options o on o.mlb_id = g.mlb_id and o.role = g.role
   and o.season = (select max(season) from aabl.config);

create view aabl.records_three_stars as
  with r as (
    select g.game_date, g.mlb_id, g.role, g.points,
           rank() over (partition by g.game_date order by g.points desc) as rk
    from aabl.stats_game g
    join aabl.box_options o on o.mlb_id = g.mlb_id and o.role = g.role
     and o.season = (select max(season) from aabl.config)
  )
  select mlb_id, role, extract(year from game_date)::int as season,
         count(*) filter (where rk = 1)::int as first_star,
         count(*) filter (where rk = 2)::int as second_star,
         count(*) filter (where rk = 3)::int as third_star,
         count(*)::int as total
  from r where rk <= 3
  group by mlb_id, role, extract(year from game_date);

grant select on aabl.records_best_games, aabl.records_three_stars to anon, authenticated;
