-- AABL 012 — live "Tonight" points, written every minute during games by the
-- Worker cron (one row). Public read; team totals only appear once picks lock.
-- Already applied to the Supabase project on Oct 21, 2026.
create table aabl.live (
  id          int primary key default 1 check (id = 1),
  game_date   date,
  players     jsonb not null default '{}',   -- "mlb_id|role" -> { pts, line }
  entries     jsonb not null default '{}',   -- entry_id -> { pts, n }
  games       jsonb not null default '[]',   -- tonight's games with live scores
  finals      jsonb not null default '{}',   -- cached lines for finished games
  updated_at  timestamptz not null default now()
);
insert into aabl.live (id) values (1);
alter table aabl.live enable row level security;
create policy live_read on aabl.live for select to anon, authenticated using (true);
grant select on aabl.live to anon, authenticated;
