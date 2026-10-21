-- AABL 006 — sign-up support (applied Oct 21, 2026 as aabl_006_signup).
alter table aabl.config add column payment_info text;                   -- shown on confirmation + email (set by admin)
alter table aabl.entries add column entry_num int not null default 1;   -- 1st, 2nd... entry for this email
alter table aabl.entries add column idempotency_key uuid unique;        -- safe retries of a sign-up save
-- Note: config.opening_day (the picks deadline) is left empty until MLB posts real
-- 2027 first-pitch times; the current schedule uses 3:33am ET placeholders ("TBD").
