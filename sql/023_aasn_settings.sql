-- AASN-wide settings (read by every site, changed only by the commissioner on /admin.html).
-- key 'themes': { enabled: bool, off: [theme names], cup_final: {start,end} | null }
create table if not exists public.aasn_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.aasn_settings enable row level security;
create policy aasn_settings_read on public.aasn_settings for select using (true);
create policy aasn_settings_admin_ins on public.aasn_settings for insert with check (public.aafl_is_admin());
create policy aasn_settings_admin_upd on public.aasn_settings for update using (public.aafl_is_admin()) with check (public.aafl_is_admin());
grant select on public.aasn_settings to anon, authenticated;
grant insert, update on public.aasn_settings to authenticated;
insert into public.aasn_settings (key, value) values ('themes', '{"enabled": true, "off": [], "cup_final": null}') on conflict (key) do nothing;
