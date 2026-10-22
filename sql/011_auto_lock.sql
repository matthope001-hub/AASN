-- AABL 011 — picks lock automatically at the deadline (first pitch of
-- Opening Day, config.opening_day), even if the admin toggle isn't flipped.
-- Picks, division picks, trades and "Picked by" counts become visible then.
-- Already applied to the Supabase project on Oct 21, 2026.
create or replace function aabl.picks_locked()
returns boolean
language sql stable security definer
set search_path = aabl
as $$
  select coalesce((select picks_locked or (opening_day is not null and now() >= opening_day)
                   from aabl.config order by season desc limit 1), false);
$$;
