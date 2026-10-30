-- AABL player news (RotoWire blurbs via ESPN). New table only - touches nothing existing.
-- One row per pool player (mlb_id), written by the "AABL player news" GitHub Action.
-- mlb_id 0 is a meta row: last run time and any players that couldn't be matched to ESPN.

create table if not exists aabl.player_news (
  mlb_id     int primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table aabl.player_news enable row level security;

create policy read_all on aabl.player_news for select using (true);

grant select on aabl.player_news to anon, authenticated;
grant all on aabl.player_news to service_role;
