-- AUD-21: the live database already has row level security on these four private tables (the
-- Supabase SQL editor offers to switch it on when a table is created without it). This records
-- that here so a database built from the migrations matches live. Nothing changes live.
-- Only SECURITY DEFINER functions owned by postgres read these tables, and the owner is not
-- subject to RLS, so no policy is needed: every other role sees nothing.
alter table private.console_members enable row level security;
alter table private.member_pins enable row level security;
alter table private.page_limits enable row level security;
alter table private.stock_values enable row level security;
