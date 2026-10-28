-- AAFL 019 — one-click unsubscribe from any AAFL email (no sign-in). Applied 2026-10-27.
-- Every invite has a secret unsub_token; emails link to aafl/unsubscribe.html?t=<token>.
-- aafl_set_emails(token, on): turns reminders off/on for every team that person has, and marks
-- their invite(s) so the outbox won't send them invite emails while opted out.
alter table public.aafl_invites add column if not exists unsub_token uuid not null default gen_random_uuid();
alter table public.aafl_invites add column if not exists email_opt_out boolean not null default false;
create unique index if not exists aafl_invites_unsub on public.aafl_invites (unsub_token);

create or replace function public.aafl_set_emails(p_token uuid, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select lower(email) into v_email from public.aafl_invites where unsub_token = p_token;
  if v_email is null then raise exception 'This link is not valid'; end if;
  update public.aafl_invites set email_opt_out = not p_on where lower(email) = v_email;
  update public.aafl_teams set email_reminders = p_on
    where invite_code in (select code from public.aafl_invites where lower(email) = v_email);
  return regexp_replace(v_email, '^(.).*(@.*)$', '\1•••\2');
end $$;
grant execute on function public.aafl_set_emails(uuid, boolean) to anon, authenticated;
