-- PrintShopLedger: audit fixes (2026-10-11)
-- Applied 2026-10-11 through the SQL editor; safe to re-run.


-- 1. Business settings: anon never needs table access; authenticated never needs TRUNCATE/DELETE/TRIGGER/REFERENCES.
revoke all on public.business_settings, public.business_settings_history from anon;
revoke truncate, delete, trigger, references on public.business_settings from authenticated;
revoke truncate, delete, trigger, references, insert, update on public.business_settings_history from authenticated;

-- History rows are written only by the trigger, so users cannot forge audit entries.
alter function private.audit_business_settings() security definer;
drop policy if exists business_history_insert on public.business_settings_history;

-- 2. Superseded correction handler should not stay callable.
revoke execute on function private.apply_supervised_event_v1(uuid, jsonb) from authenticated, public;

-- 3. RLS policies: evaluate auth.uid() once per query instead of per row.
drop policy own_memberships on public.shop_members;
create policy own_memberships on public.shop_members for select to authenticated
 using (user_id = (select auth.uid()));

drop policy business_settings_insert on public.business_settings;
create policy business_settings_insert on public.business_settings for insert to authenticated
 with check (modified_by = (select auth.uid()) and exists (select 1 from public.shop_members m where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4));

drop policy business_settings_update on public.business_settings;
create policy business_settings_update on public.business_settings for update to authenticated
 using (exists (select 1 from public.shop_members m where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4))
 with check (modified_by = (select auth.uid()) and exists (select 1 from public.shop_members m where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4));

drop policy business_history_read on public.business_settings_history;
create policy business_history_read on public.business_settings_history for select to authenticated
 using (exists (select 1 from public.shop_members m where m.shop_id = business_settings_history.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4));

drop policy manager_business_name on public.shops;
create policy manager_business_name on public.shops for update to authenticated
 using (exists (select 1 from public.shop_members m where m.shop_id = shops.id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4))
 with check (exists (select 1 from public.shop_members m where m.shop_id = shops.id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 4));

-- 4. Index the customer-payments lookup used on every checkout and ledger load.
create index if not exists payments_shop_customer on public.payments (shop_id, customer_id);

