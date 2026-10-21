-- =====================================================================
-- AASN / AABL — 001 schema
-- Run once in the Supabase SQL editor (project "AAHL").
-- Creates the `aabl` schema plus two shared AASN tables in `public`
-- (profiles, champions). Does NOT touch any existing AAHL table.
--
-- After running: Supabase → Project Settings → API → "Exposed schemas"
-- → add `aabl`, then Save. Without this the site cannot read AABL data.
--
-- Security model:
--   * Public (anon) can READ league data (boxes, players, stats, standings).
--   * Picks are hidden from others until config.picks_locked = true.
--   * Entries (emails) are readable only by their owner and the admin.
--   * All member saves go through the Cloudflare Worker (service role),
--     so there are no public insert/update policies.
-- =====================================================================

create schema if not exists aabl;

-- ---------- Admin check (commissioner emails) ----------
create or replace function aabl.is_admin()
returns boolean
language sql stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') in (
    'matt.hope001@gmail.com',
    'matt.hope@rocketmail.com'
  ), false);
$$;

-- ---------- Season config ----------
create table aabl.config (
  season          int primary key,                -- e.g. 2027
  opening_day     timestamptz,                    -- picks lock (MLB Opening Day)
  trade_deadline  timestamptz,                    -- matches MLB trade deadline
  picks_locked    boolean not null default false, -- admin toggle in UI
  signups_open    boolean not null default false,
  digest_day      text    not null default 'MONDAY',
  entry_fee       numeric not null default 10,
  season_moves    int     not null default 2,
  updated_at      timestamptz not null default now()
);

create or replace function aabl.picks_locked()
returns boolean
language sql stable security definer
set search_path = aabl
as $$
  select coalesce((select picks_locked from aabl.config order by season desc limit 1), false);
$$;

-- ---------- Scoring (editable, never hardcoded) ----------
create table aabl.scoring (
  player_type text not null check (player_type in ('hitter','pitcher')),
  stat        text not null,
  label       text not null,
  points      numeric not null,
  primary key (player_type, stat)
);

insert into aabl.scoring (player_type, stat, label, points) values
  ('hitter','singles','Single',1),
  ('hitter','doubles','Double',2),
  ('hitter','triples','Triple',3),
  ('hitter','hr','Home run',4),
  ('hitter','rbi','RBI',1),
  ('hitter','runs','Run scored',1),
  ('hitter','bb','Walk',1),
  ('hitter','hbp','Hit by pitch',1),
  ('hitter','sb','Stolen base',2),
  ('hitter','so','Strikeout',-0.5),
  ('hitter','cs','Caught stealing',-1),
  ('pitcher','outs','Out recorded',1),
  ('pitcher','k','Strikeout',1),
  ('pitcher','w','Win',5),
  ('pitcher','qs','Quality start',3),
  ('pitcher','sv','Save',5),
  ('pitcher','hld','Hold',2),
  ('pitcher','er','Earned run',-2),
  ('pitcher','l','Loss',-3),
  ('pitcher','bb_allowed','Walk allowed',-0.5),
  ('pitcher','h_allowed','Hit allowed',-0.5);

-- ---------- Boxes ----------
create table aabl.boxes (
  season   int not null,
  box_id   int not null check (box_id between 1 and 21),
  name     text not null,                 -- e.g. "Catchers – Tier 1"
  section  text not null,                 -- Infield / Outfield & DH / Pitching
  role     text not null check (role in ('hitter','pitcher')),
  primary key (season, box_id)
);

-- ---------- Players (MLB) ----------
create table aabl.players (
  mlb_id       int primary key,           -- statsapi.mlb.com person id
  full_name    text not null,
  team_abbr    text,                      -- updated by nightly roster sync
  position     text,
  headshot_url text,
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- ---------- Box options (player + role; two-way players listed twice) ----------
create table aabl.box_options (
  option_id  bigserial primary key,
  season     int  not null,
  box_id     int  not null,
  mlb_id     int  not null references aabl.players(mlb_id),
  role       text not null check (role in ('hitter','pitcher')),
  sort_order int  not null default 0,
  foreign key (season, box_id) references aabl.boxes(season, box_id) on delete cascade,
  unique (season, box_id, mlb_id, role)
);

-- ---------- Stats per game (keyed by gamePk: handles doubleheaders/suspended) ----------
create table aabl.stats_game (
  mlb_id     int    not null references aabl.players(mlb_id),
  game_pk    bigint not null,
  role       text   not null check (role in ('hitter','pitcher')),
  game_date  date   not null,
  -- hitting
  singles int default 0, doubles int default 0, triples int default 0, hr int default 0,
  rbi int default 0, runs int default 0, bb int default 0, hbp int default 0,
  sb int default 0, so int default 0, cs int default 0,
  -- pitching
  outs int default 0, k int default 0, w int default 0, qs int default 0, sv int default 0,
  hld int default 0, er int default 0, l int default 0,
  bb_allowed int default 0, h_allowed int default 0,
  points     numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (mlb_id, game_pk, role)
);
create index on aabl.stats_game (game_date);

-- ---------- Season totals (rebuilt nightly from stats_game, never hand-patched) ----------
create table aabl.stats_season (
  season  int  not null,
  mlb_id  int  not null references aabl.players(mlb_id),
  role    text not null check (role in ('hitter','pitcher')),
  games   int  not null default 0,
  singles int default 0, doubles int default 0, triples int default 0, hr int default 0,
  rbi int default 0, runs int default 0, bb int default 0, hbp int default 0,
  sb int default 0, so int default 0, cs int default 0,
  outs int default 0, k int default 0, w int default 0, qs int default 0, sv int default 0,
  hld int default 0, er int default 0, l int default 0,
  bb_allowed int default 0, h_allowed int default 0,
  points     numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (season, mlb_id, role)
);

-- ---------- Entries ----------
create table aabl.entries (
  entry_id          text primary key default replace(gen_random_uuid()::text, '-', ''),
  season            int  not null,
  user_id           uuid references auth.users(id) on delete set null,  -- null if never signed in
  email             text not null,
  manager_name      text not null,
  team_name         text not null,
  paid              boolean not null default false,
  paid_at           timestamptz,
  free_entry        boolean not null default false,   -- last place from prior year
  moves_used        int not null default 0,
  access_token_hash text,                             -- emailed-link access
  created_at        timestamptz not null default now()
);
create index on aabl.entries (lower(email));
create index on aabl.entries (user_id);

-- Public team list (no emails)
create view aabl.teams as
  select entry_id, season, team_name, manager_name, created_at
  from aabl.entries;

-- ---------- Picks ----------
create table aabl.picks (
  entry_id      text not null references aabl.entries(entry_id) on delete cascade,
  season        int  not null,
  box_id        int  not null,
  option_id     bigint not null references aabl.box_options(option_id),
  banked_points numeric not null default 0,   -- points from players traded away
  picked_at     timestamptz not null default now(),
  primary key (entry_id, box_id)
);

create table aabl.division_picks (
  entry_id  text not null references aabl.entries(entry_id) on delete cascade,
  division  text not null check (division in
            ('AL East','AL Central','AL West','NL East','NL Central','NL West')),
  team_abbr text not null,
  primary key (entry_id, division)
);

create table aabl.division_winners (
  season    int  not null,
  division  text not null,
  team_abbr text not null,
  primary key (season, division)
);

-- ---------- Trades (same box only; counts as a move after Opening Day) ----------
create table aabl.trades (
  trade_id      bigserial primary key,
  entry_id      text not null references aabl.entries(entry_id) on delete cascade,
  box_id        int  not null,
  old_option_id bigint not null references aabl.box_options(option_id),
  new_option_id bigint not null references aabl.box_options(option_id),
  points_banked numeric not null default 0,
  preseason     boolean not null default false,  -- free, unlimited before Opening Day
  official      boolean not null default false,  -- recorded by admin
  made_at       timestamptz not null default now()
);

-- ---------- Injured list (admin flags manually) ----------
create table aabl.il (
  mlb_id     int primary key references aabl.players(mlb_id),
  note       text,
  flagged_at timestamptz not null default now()
);

-- ---------- Standings (daily snapshot) ----------
create table aabl.standings (
  season        int  not null,
  snapshot_date date not null,
  entry_id      text not null references aabl.entries(entry_id) on delete cascade,
  points        numeric not null default 0,
  last_night    numeric not null default 0,
  rank          int,
  primary key (season, snapshot_date, entry_id)
);

-- =====================================================================
-- Shared AASN tables (public schema)
-- =====================================================================
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table public.champions (
  id           bigserial primary key,
  league       text not null check (league in ('AAHL','AABL')),
  season_label text not null,              -- "2024-25", "2027"
  place        int  not null check (place between 1 and 3),
  team_name    text not null,
  owner_name   text,
  points       numeric,
  unique (league, season_label, place)
);

insert into public.champions (league, season_label, place, team_name) values
  ('AAHL','2024-25',1,'Trish H'),
  ('AAHL','2024-25',2,'Nova Scotia JWM'),
  ('AAHL','2024-25',3,'Sklepo2');

-- =====================================================================
-- Grants
-- =====================================================================
grant usage on schema aabl to anon, authenticated, service_role;
grant select on all tables in schema aabl to anon, authenticated;
revoke select on aabl.entries from anon;
grant select on aabl.entries to authenticated;
grant all on all tables in schema aabl to service_role;
grant all on all sequences in schema aabl to service_role;
grant execute on function aabl.is_admin(), aabl.picks_locked() to anon, authenticated;

grant select on public.champions to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table aabl.config           enable row level security;
alter table aabl.scoring          enable row level security;
alter table aabl.boxes            enable row level security;
alter table aabl.players          enable row level security;
alter table aabl.box_options      enable row level security;
alter table aabl.stats_game       enable row level security;
alter table aabl.stats_season     enable row level security;
alter table aabl.entries          enable row level security;
alter table aabl.picks            enable row level security;
alter table aabl.division_picks   enable row level security;
alter table aabl.division_winners enable row level security;
alter table aabl.trades           enable row level security;
alter table aabl.il               enable row level security;
alter table aabl.standings        enable row level security;
alter table public.profiles       enable row level security;
alter table public.champions      enable row level security;

-- Public read: league data
create policy read_all on aabl.config           for select using (true);
create policy read_all on aabl.scoring          for select using (true);
create policy read_all on aabl.boxes            for select using (true);
create policy read_all on aabl.players          for select using (true);
create policy read_all on aabl.box_options      for select using (true);
create policy read_all on aabl.stats_game       for select using (true);
create policy read_all on aabl.stats_season     for select using (true);
create policy read_all on aabl.division_winners for select using (true);
create policy read_all on aabl.il               for select using (true);
create policy read_all on aabl.standings        for select using (true);
create policy read_all on aabl.trades           for select using (true);
create policy read_all on public.champions      for select using (true);

-- Entries: owner or admin only
create policy own_or_admin on aabl.entries for select
  using (user_id = auth.uid() or aabl.is_admin());

-- Ownership check that works for anon too (security definer, no email exposure)
create or replace function aabl.owns_entry(p_entry_id text)
returns boolean
language sql stable security definer
set search_path = aabl
as $$
  select auth.uid() is not null
     and exists (select 1 from aabl.entries where entry_id = p_entry_id and user_id = auth.uid());
$$;
grant execute on function aabl.owns_entry(text) to anon, authenticated;

-- Picks: everyone after lock; before lock only owner or admin
create policy picks_read on aabl.picks for select
  using (aabl.picks_locked() or aabl.is_admin()
         or aabl.owns_entry(entry_id));
create policy divpicks_read on aabl.division_picks for select
  using (aabl.picks_locked() or aabl.is_admin()
         or aabl.owns_entry(entry_id));

-- Admin: full write access from the site's admin menu
do $$
declare t text;
begin
  foreach t in array array['config','scoring','boxes','players','box_options','entries',
                           'picks','division_picks','division_winners','trades','il','standings']
  loop
    execute format('create policy admin_write on aabl.%I for all using (aabl.is_admin()) with check (aabl.is_admin())', t);
    execute format('grant insert, update, delete on aabl.%I to authenticated', t);
  end loop;
end $$;

create policy admin_write on public.champions for all
  using (aabl.is_admin()) with check (aabl.is_admin());
grant insert, update, delete on public.champions to authenticated;

-- Profiles: each user manages their own
create policy own_profile on public.profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Starter season row ----------
insert into aabl.config (season) values (2027);
