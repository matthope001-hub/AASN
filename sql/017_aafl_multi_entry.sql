-- =====================================================================
-- AAFL 017 — multiple entries per person. Applied 2026-10-27.
--   * A signed-in account can own several teams (up to aafl_config.max_entries, default 3).
--   * Each invite allows a number of entries (aafl_invites.entries, default 1).
--   * Every entry counts toward the human cap.
--   * Teams remember which invite created them (aafl_teams.invite_code) so reminders reach the right email.
--   * Picks policies check "you own this team" instead of "this is your one team".
-- =====================================================================

alter table public.aafl_config  add column if not exists max_entries int not null default 3;
alter table public.aafl_invites add column if not exists entries int not null default 1 check (entries between 1 and 10);
alter table public.aafl_teams   add column if not exists invite_code text references public.aafl_invites (code) on delete set null;

-- Link the teams that already joined to their invite.
update public.aafl_teams t set invite_code = i.code from public.aafl_invites i where i.team_id = t.id and t.invite_code is null;

-- One account can now own several teams.
alter table public.aafl_teams drop constraint if exists aafl_teams_user_id_key;
create index if not exists aafl_teams_user on public.aafl_teams (user_id);

-- Do you own this team?
create or replace function public.aafl_owns_team(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.aafl_teams where id = p_team and user_id = auth.uid());
$$;

drop policy if exists aafl_picks_read   on public.aafl_picks;
drop policy if exists aafl_picks_insert on public.aafl_picks;
drop policy if exists aafl_picks_update on public.aafl_picks;
drop policy if exists aafl_picks_delete on public.aafl_picks;
create policy aafl_picks_read   on public.aafl_picks for select using (public.aafl_owns_team(team_id) or public.aafl_game_locked(game_id) or public.aafl_is_admin());
create policy aafl_picks_insert on public.aafl_picks for insert with check ((public.aafl_owns_team(team_id) and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());
create policy aafl_picks_update on public.aafl_picks for update using ((public.aafl_owns_team(team_id) and not public.aafl_game_locked(game_id)) or public.aafl_is_admin()) with check ((public.aafl_owns_team(team_id) and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());
create policy aafl_picks_delete on public.aafl_picks for delete using ((public.aafl_owns_team(team_id) and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());

-- Join (or add another entry) with an invite.
create or replace function public.aafl_join(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email  text := lower(auth.jwt() ->> 'email');
  v_inv    public.aafl_invites;
  v_cfg    public.aafl_config;
  v_team   uuid;
  v_week   int;
  v_humans int;
  v_mine   int;
  v_used   int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_inv from public.aafl_invites where code = p_code and not revoked;
  if not found then raise exception 'That invite link is not valid'; end if;
  if lower(v_inv.email) <> v_email then raise exception 'This invite was sent to a different email'; end if;
  select * into v_cfg from public.aafl_config where season = v_inv.season;
  select count(*) into v_used from public.aafl_teams where invite_code = p_code;
  if v_used >= v_inv.entries then raise exception 'All the entries on this invite have been used'; end if;
  select count(*) into v_mine from public.aafl_teams where user_id = auth.uid() and season = v_inv.season;
  if v_mine >= coalesce(v_cfg.max_entries, 3) then raise exception 'You already have the most entries allowed (%)', coalesce(v_cfg.max_entries, 3); end if;
  select count(*) into v_humans from public.aafl_teams where season = v_inv.season and not is_bot;
  if v_humans >= coalesce(v_cfg.human_cap, 10) then raise exception 'The league is full'; end if;

  v_week := public.aafl_current_week(v_inv.season);
  if now() >= coalesce(public.aafl_week_lock(v_inv.season, v_week), now() + interval '1 day') and v_week < 18 then v_week := v_week + 1; end if;

  insert into public.aafl_teams (season, name, user_id, joined_week, invite_code)
  values (v_inv.season, trim(p_name), auth.uid(), v_week, p_code) returning id into v_team;

  insert into public.aafl_credits (team_id, week, points)
  select v_team, s.week, round(avg(s.points), 1)
  from public.aafl_week_scores s
  join public.aafl_teams t on t.id = s.team_id
  where s.season = v_inv.season and s.week < v_week and not s.credited and t.id <> v_team
  group by s.week;

  update public.aafl_invites set used_at = coalesce(used_at, now()), team_id = coalesce(team_id, v_team) where code = p_code;
  return v_team;
end $$;
grant execute on function public.aafl_join(text, text) to authenticated;
revoke execute on function public.aafl_join(text, text) from public, anon;
