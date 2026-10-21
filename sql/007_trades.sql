-- AABL 007 — trades (applied Oct 21, 2026 as aabl_007_trades). All functions are service-role only.

-- Points a current pick has earned since it was acquired (same rule as the standings snapshot).
create or replace function aabl.pick_points_since(p_entry text, p_box int, p_stats_season int)
returns numeric
language sql stable security definer
set search_path = aabl
as $$
  select coalesce(sum(g.points), 0)
  from aabl.picks pk
  join aabl.box_options o on o.option_id = pk.option_id
  join aabl.stats_game g on g.mlb_id = o.mlb_id and g.role = o.role
  where pk.entry_id = p_entry and pk.box_id = p_box
    and extract(year from g.game_date) = p_stats_season
    and g.game_date >= coalesce((
      select max(t.made_at)::date from aabl.trades t
      where t.entry_id = p_entry and t.box_id = p_box and t.preseason = false
    ), date '1900-01-01');
$$;

-- One trade, all-or-nothing. Same box only. Before Opening Day: free and unlimited.
-- After: counts as a season move (limit from config), points earned are banked,
-- and no trades after the MLB trade deadline.
create or replace function aabl.make_trade(p_entry text, p_box int, p_option bigint)
returns jsonb
language plpgsql security definer
set search_path = aabl
as $$
declare
  cfg record; ent record; cur record; opt record;
  pre boolean; banked numeric := 0;
begin
  select * into cfg from aabl.config order by season desc limit 1;
  select * into ent from aabl.entries where entry_id = p_entry for update;
  if ent is null or ent.season <> cfg.season then return jsonb_build_object('ok', false, 'error', 'Entry not found.'); end if;

  select * into opt from aabl.box_options where option_id = p_option;
  if opt is null or opt.season <> cfg.season or opt.box_id <> p_box then
    return jsonb_build_object('ok', false, 'error', 'That player isn''t in this box.');
  end if;

  select * into cur from aabl.picks where entry_id = p_entry and box_id = p_box for update;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'No pick found for this box.'); end if;
  if cur.option_id = p_option then return jsonb_build_object('ok', false, 'error', 'That player is already on your team.'); end if;

  pre := not cfg.picks_locked and (cfg.opening_day is null or now() < cfg.opening_day);

  if not pre then
    if cfg.trade_deadline is not null and now() >= cfg.trade_deadline then
      return jsonb_build_object('ok', false, 'error', 'The trade deadline has passed.');
    end if;
    if ent.moves_used >= cfg.season_moves then
      return jsonb_build_object('ok', false, 'error', format('You''ve used all %s trades for the season.', cfg.season_moves));
    end if;
    banked := aabl.pick_points_since(p_entry, p_box, cfg.season);
  end if;

  insert into aabl.trades (entry_id, box_id, old_option_id, new_option_id, points_banked, preseason, official)
  values (p_entry, p_box, cur.option_id, p_option, banked, pre, false);

  update aabl.picks set option_id = p_option, banked_points = banked_points + banked, picked_at = now()
  where entry_id = p_entry and box_id = p_box;

  if not pre then
    update aabl.entries set moves_used = moves_used + 1 where entry_id = p_entry;
  end if;

  return jsonb_build_object('ok', true, 'preseason', pre, 'banked', banked,
    'moves_used', ent.moves_used + case when pre then 0 else 1 end, 'season_moves', cfg.season_moves);
end $$;

-- Division pick changes: before Opening Day only.
create or replace function aabl.change_division_pick(p_entry text, p_division text, p_team text)
returns jsonb
language plpgsql security definer
set search_path = aabl
as $$
declare cfg record; ent record;
begin
  select * into cfg from aabl.config order by season desc limit 1;
  select * into ent from aabl.entries where entry_id = p_entry;
  if ent is null or ent.season <> cfg.season then return jsonb_build_object('ok', false, 'error', 'Entry not found.'); end if;
  if cfg.picks_locked or (cfg.opening_day is not null and now() >= cfg.opening_day) then
    return jsonb_build_object('ok', false, 'error', 'Division picks are locked for the season.');
  end if;
  update aabl.division_picks set team_abbr = p_team where entry_id = p_entry and division = p_division;
  if not found then return jsonb_build_object('ok', false, 'error', 'Division not found.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function aabl.pick_points_since(text, int, int) from public, anon, authenticated;
revoke all on function aabl.make_trade(text, int, bigint) from public, anon, authenticated;
revoke all on function aabl.change_division_pick(text, text, text) from public, anon, authenticated;
grant execute on function aabl.pick_points_since(text, int, int) to service_role;
grant execute on function aabl.make_trade(text, int, bigint) to service_role;
grant execute on function aabl.change_division_pick(text, text, text) to service_role;
grant usage, select on all sequences in schema aabl to service_role;
