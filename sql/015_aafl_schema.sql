-- =====================================================================
-- AASN / AAFL — 015 schema (NFL pick'em, 2026 trial season)
-- Tables live in `public` with an aafl_ prefix, so no "Exposed schemas" change is needed.
-- Additive only: creates aafl_* objects and touches no AAHL / AABL / Death Pool table.
--
-- Security model:
--   * Anyone can read games, teams (no emails), weekly scores and settings.
--   * A player's picks are visible to them always; everyone else's only once that week locks
--     (first kickoff of the week). Picks can be saved/changed only before the week locks.
--   * Players join with an invite (aafl_join), which only works for the invited email.
--   * Invites are admin-only. The sync job uses the service key (bypasses RLS).
-- =====================================================================

-- ---------- Admin check (commissioner emails) ----------
create or replace function public.aafl_is_admin()
returns boolean language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') in ('matt.hope001@gmail.com', 'matt.hope@rocketmail.com'), false);
$$;

-- ---------- Settings ----------
create table public.aafl_config (
  season      int primary key,
  trial       boolean not null default true,   -- 2026 = free trial, no prizes
  human_cap   int     not null default 10,     -- invited human players allowed
  updated_at  timestamptz not null default now()
);
insert into public.aafl_config (season) values (2026);

-- ---------- NFL games (filled by scripts/aafl-sync.mjs from ESPN) ----------
create table public.aafl_games (
  id             text primary key,             -- ESPN event id
  season         int  not null,
  week           int  not null check (week between 1 and 18),
  kickoff        timestamptz not null,
  away           text not null,                -- team abbreviation, e.g. BUF
  home           text not null,
  away_name      text,
  home_name      text,
  away_score     int,
  home_score     int,
  state          text not null default 'pre' check (state in ('pre', 'in', 'post')),
  status_detail  text,                         -- "Final", "Q3 6:12", ...
  winner         text,                         -- abbreviation, 'TIE', or null until final
  spread         text,                         -- "BUF -5.5"
  over_under     numeric,
  away_ml        int,
  home_ml        int,
  updated_at     timestamptz not null default now()
);
create index aafl_games_week on public.aafl_games (season, week);

-- ---------- Pool teams (computer + human) ----------
create table public.aafl_teams (
  id           uuid primary key default gen_random_uuid(),
  season       int  not null,
  name         text not null check (char_length(name) between 2 and 40),
  is_bot       boolean not null default false,
  bot_key      text unique,                    -- bot1..bot10: seed for its random picks
  user_id      uuid unique references auth.users (id) on delete set null,
  joined_week  int  not null default 1,
  created_at   timestamptz not null default now(),
  unique (season, name)
);

-- ---------- Invites (admin only) ----------
create table public.aafl_invites (
  code        text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 18),
  email       text not null,
  season      int  not null default 2026,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  team_id     uuid references public.aafl_teams (id) on delete set null,
  revoked     boolean not null default false
);
create unique index aafl_invites_email on public.aafl_invites (season, lower(email)) where not revoked;

-- ---------- Picks ----------
create table public.aafl_picks (
  team_id     uuid not null references public.aafl_teams (id) on delete cascade,
  game_id     text not null references public.aafl_games (id) on delete cascade,
  pick        text not null,
  updated_at  timestamptz not null default now(),
  primary key (team_id, game_id)
);
create index aafl_picks_game on public.aafl_picks (game_id);

-- ---------- Credits: league-average points for weeks a late joiner missed ----------
create table public.aafl_credits (
  team_id  uuid not null references public.aafl_teams (id) on delete cascade,
  week     int  not null,
  points   numeric not null,
  primary key (team_id, week)
);

-- ---------- Helpers ----------
-- A week locks at its first kickoff.
create or replace function public.aafl_week_lock(p_season int, p_week int)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(kickoff) from public.aafl_games where season = p_season and week = p_week;
$$;

create or replace function public.aafl_game_locked(p_game text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select now() >= public.aafl_week_lock(g.season, g.week) from public.aafl_games g where g.id = p_game), true);
$$;

create or replace function public.aafl_my_team()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.aafl_teams where user_id = auth.uid() order by season desc limit 1;
$$;

-- The week players are picking now: the earliest week that still has an unfinished game.
create or replace function public.aafl_current_week(p_season int default 2026)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(min(week), 18) from public.aafl_games where season = p_season and state <> 'post';
$$;

-- Picks must name one of the two teams in that game.
create or replace function public.aafl_pick_valid()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.aafl_games g where g.id = new.game_id and new.pick in (g.away, g.home)) then
    raise exception 'Pick must be one of the two teams in the game';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger aafl_pick_valid before insert or update on public.aafl_picks
  for each row execute function public.aafl_pick_valid();

-- ---------- Weekly scores (1 point per correct pick, plus any credit) ----------
create view public.aafl_week_scores with (security_invoker = true) as
  select t.id as team_id, t.season, g.week,
         count(*) filter (where g.state = 'post' and p.pick = g.winner)::numeric as points,
         count(*) filter (where g.state = 'post')::int as graded,
         count(*)::int as games,
         count(p.pick)::int as picked,
         false as credited
  from public.aafl_teams t
  join public.aafl_games g on g.season = t.season and g.week >= t.joined_week
  left join public.aafl_picks p on p.team_id = t.id and p.game_id = g.id
  group by t.id, t.season, g.week
  union all
  select c.team_id, t.season, c.week, c.points, 0, 0, 0, true
  from public.aafl_credits c join public.aafl_teams t on t.id = c.team_id;

-- ---------- Join with an invite ----------
create or replace function public.aafl_join(p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_inv   public.aafl_invites;
  v_cfg   public.aafl_config;
  v_team  uuid;
  v_week  int;
  v_humans int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_inv from public.aafl_invites where code = p_code and not revoked;
  if not found then raise exception 'That invite link is not valid'; end if;
  if lower(v_inv.email) <> v_email then raise exception 'This invite was sent to a different email'; end if;
  if v_inv.used_at is not null then raise exception 'This invite has already been used'; end if;
  if exists (select 1 from public.aafl_teams where user_id = auth.uid() and season = v_inv.season) then raise exception 'You already have a team'; end if;
  select * into v_cfg from public.aafl_config where season = v_inv.season;
  select count(*) into v_humans from public.aafl_teams where season = v_inv.season and not is_bot;
  if v_humans >= coalesce(v_cfg.human_cap, 10) then raise exception 'The league is full'; end if;

  v_week := public.aafl_current_week(v_inv.season);
  -- If this week has already kicked off, the player starts next week.
  if now() >= coalesce(public.aafl_week_lock(v_inv.season, v_week), now() + interval '1 day') and v_week < 18 then v_week := v_week + 1; end if;

  insert into public.aafl_teams (season, name, user_id, joined_week)
  values (v_inv.season, trim(p_name), auth.uid(), v_week) returning id into v_team;

  -- League-average points for every week missed (average of the teams that played it).
  insert into public.aafl_credits (team_id, week, points)
  select v_team, s.week, round(avg(s.points), 1)
  from public.aafl_week_scores s
  where s.season = v_inv.season and s.week < v_week and not s.credited
  group by s.week;

  update public.aafl_invites set used_at = now(), team_id = v_team where code = p_code;
  return v_team;
end $$;

-- ---------- Row-level security ----------
alter table public.aafl_config  enable row level security;
alter table public.aafl_games   enable row level security;
alter table public.aafl_teams   enable row level security;
alter table public.aafl_invites enable row level security;
alter table public.aafl_picks   enable row level security;
alter table public.aafl_credits enable row level security;

create policy aafl_config_read   on public.aafl_config  for select using (true);
create policy aafl_config_admin  on public.aafl_config  for update using (public.aafl_is_admin()) with check (public.aafl_is_admin());

create policy aafl_games_read    on public.aafl_games   for select using (true);

create policy aafl_teams_read    on public.aafl_teams   for select using (true);
create policy aafl_teams_rename  on public.aafl_teams   for update using (user_id = auth.uid() or public.aafl_is_admin()) with check (user_id = auth.uid() or public.aafl_is_admin());
create policy aafl_teams_admin_del on public.aafl_teams for delete using (public.aafl_is_admin());

create policy aafl_invites_read  on public.aafl_invites for select using (public.aafl_is_admin() or lower(email) = lower(auth.jwt() ->> 'email'));
create policy aafl_invites_admin on public.aafl_invites for all using (public.aafl_is_admin()) with check (public.aafl_is_admin());

create policy aafl_picks_read    on public.aafl_picks   for select using (team_id = public.aafl_my_team() or public.aafl_game_locked(game_id) or public.aafl_is_admin());
create policy aafl_picks_insert  on public.aafl_picks   for insert with check ((team_id = public.aafl_my_team() and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());
create policy aafl_picks_update  on public.aafl_picks   for update using ((team_id = public.aafl_my_team() and not public.aafl_game_locked(game_id)) or public.aafl_is_admin()) with check ((team_id = public.aafl_my_team() and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());
create policy aafl_picks_delete  on public.aafl_picks   for delete using ((team_id = public.aafl_my_team() and not public.aafl_game_locked(game_id)) or public.aafl_is_admin());

create policy aafl_credits_read  on public.aafl_credits for select using (true);
create policy aafl_credits_admin on public.aafl_credits for all using (public.aafl_is_admin()) with check (public.aafl_is_admin());

grant select on public.aafl_week_scores to anon, authenticated;
grant execute on function public.aafl_join(text, text) to authenticated;
revoke execute on function public.aafl_join(text, text) from public, anon;

-- ---------- The 10 computer teams ----------
insert into public.aafl_teams (season, name, is_bot, bot_key) values
  (2026, 'Gridiron Goats', true, 'bot1'), (2026, 'Blitz Llamas', true, 'bot2'), (2026, 'Hail Mary Herd', true, 'bot3'),
  (2026, 'Spit Happens', true, 'bot4'), (2026, 'Fourth & Fluff', true, 'bot5'), (2026, 'Pack Animals', true, 'bot6'),
  (2026, 'The Woolly Bullies', true, 'bot7'), (2026, 'Llama Drama', true, 'bot8'), (2026, 'Cria Kickers', true, 'bot9'),
  (2026, 'Andes Avalanche', true, 'bot10');

-- Fixed search_path on the two helpers that don't set one (Supabase security advisor).
alter function public.aafl_is_admin() set search_path = public;
alter function public.aafl_pick_valid() set search_path = public;
