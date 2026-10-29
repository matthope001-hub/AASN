-- Champions: when each row was added (the AASN home throws confetti for a champion added in the last 7 days).
alter table public.champions add column if not exists created_at timestamptz not null default now();
update public.champions set created_at = '2025-05-01T12:00:00Z' where created_at > now() - interval '1 minute';
