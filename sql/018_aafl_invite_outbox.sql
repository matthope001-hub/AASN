-- AAFL 018 — "Send email" from the Admin page. Applied 2026-10-27.
-- The Admin page sets send_requested_at; scripts/aafl-outbox.mjs (GitHub Actions, every 10 min)
-- emails the invite from Matt's Gmail and records sent_at (or send_error).
alter table public.aafl_invites add column if not exists send_requested_at timestamptz;
alter table public.aafl_invites add column if not exists sent_at timestamptz;
alter table public.aafl_invites add column if not exists send_error text;
