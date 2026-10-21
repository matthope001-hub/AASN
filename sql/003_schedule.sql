-- AABL 003 — MLB schedule (filled by the "Import MLB schedule" GitHub Action).
-- Already applied to the Supabase project on Oct 21, 2026.
create table aabl.schedule (
  game_pk     bigint primary key,
  season      int  not null,
  game_date   date not null,
  start_time  timestamptz,
  game_type   text not null,
  away_abbr   text not null,
  home_abbr   text not null,
  venue       text,
  status      text,
  away_score  int,
  home_score  int,
  doubleheader text,
  game_number int,
  updated_at  timestamptz not null default now()
);
create index on aabl.schedule (season, game_date);
alter table aabl.schedule enable row level security;
create policy read_all on aabl.schedule for select using (true);
create policy admin_write on aabl.schedule for all using (aabl.is_admin()) with check (aabl.is_admin());
grant select on aabl.schedule to anon, authenticated;
grant insert, update, delete on aabl.schedule to authenticated;
grant all on aabl.schedule to service_role;
