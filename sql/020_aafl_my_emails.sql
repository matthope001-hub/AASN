-- AAFL 020 — signed-in players turn reminder emails on/off for ALL their teams at once
-- (Picks page "Email me reminders"). Also clears/sets their unsubscribe flag. Applied 2026-10-27.
create or replace function public.aafl_my_emails(p_on boolean)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.aafl_teams set email_reminders = p_on where user_id = auth.uid();
  get diagnostics v_n = row_count;
  update public.aafl_invites set email_opt_out = not p_on where lower(email) = lower(auth.jwt() ->> 'email');
  return v_n;
end $$;
grant execute on function public.aafl_my_emails(boolean) to authenticated;
revoke execute on function public.aafl_my_emails(boolean) from public, anon;
