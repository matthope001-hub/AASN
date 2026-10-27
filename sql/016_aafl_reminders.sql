-- AAFL 016 — players can turn email reminders off (picks page toggle). Applied 2026-10-27.
alter table public.aafl_teams add column if not exists email_reminders boolean not null default true;
