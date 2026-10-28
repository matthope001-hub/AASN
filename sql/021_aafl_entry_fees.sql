-- AAFL 021/022 — entry fees by Interac e-Transfer (marked paid by the commissioner). Applied 2026-10-28.
--   aafl_config.entry_fee (0 = free, the 2026 trial) and pay_to (e-Transfer address).
--   aafl_teams.paid / paid_at: only the commissioner (or the service key) can change them.
--   When there's a fee, an unpaid human team's picks and credits score 0 until it's marked paid.
alter table public.aafl_config add column if not exists entry_fee numeric not null default 0;
alter table public.aafl_config add column if not exists pay_to text not null default 'matt.hope@rocketmail.com';
alter table public.aafl_teams  add column if not exists paid boolean not null default false;
alter table public.aafl_teams  add column if not exists paid_at timestamptz;

create or replace function public.aafl_paid_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.paid is distinct from old.paid or new.paid_at is distinct from old.paid_at)
     and not public.aafl_is_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the commissioner can mark entry fees paid';
  end if;
  return new;
end $$;
drop trigger if exists aafl_paid_guard on public.aafl_teams;
create trigger aafl_paid_guard before update on public.aafl_teams for each row execute function public.aafl_paid_guard();

create or replace view public.aafl_week_scores with (security_invoker = true) as
  select t.id as team_id, t.season, g.week,
         count(*) filter (where g.state = 'post' and p.pick = g.winner
                          and (t.is_bot or t.paid or coalesce(c.entry_fee, 0) = 0))::numeric as points,
         count(*) filter (where g.state = 'post')::int as graded,
         count(*)::int as games,
         count(p.pick)::int as picked,
         false as credited
  from public.aafl_teams t
  left join public.aafl_config c on c.season = t.season
  join public.aafl_games g on g.season = t.season and g.week >= t.joined_week
  left join public.aafl_picks p on p.team_id = t.id and p.game_id = g.id
  group by t.id, t.season, g.week
  union all
  select cr.team_id, t.season, cr.week,
         case when t.paid or coalesce(cf.entry_fee, 0) = 0 then cr.points else 0 end, 0, 0, 0, true
  from public.aafl_credits cr join public.aafl_teams t on t.id = cr.team_id
  left join public.aafl_config cf on cf.season = t.season;
grant select on public.aafl_week_scores to anon, authenticated;
