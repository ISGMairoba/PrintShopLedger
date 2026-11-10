-- Indexes for the 27 foreign keys Supabase's performance advisor listed (9 Nov), mostly "who made or
-- changed this" columns. Small tables today; keeps lookups and deletes of the linked rows fast as
-- the business grows.
create index if not exists devices_user_id_idx on public.devices (user_id);
create index if not exists business_settings_modified_by_idx on public.business_settings (modified_by);
create index if not exists business_settings_history_modified_by_idx on public.business_settings_history (modified_by);
create index if not exists services_created_by_idx on public.services (created_by);
create index if not exists services_modified_by_idx on public.services (modified_by);
create index if not exists materials_created_by_idx on public.materials (created_by);
create index if not exists materials_modified_by_idx on public.materials (modified_by);
create index if not exists material_stock_changes_actor_id_idx on public.material_stock_changes (actor_id);
create index if not exists ledger_events_actor_id_idx on public.ledger_events (actor_id);
create index if not exists print_signing_keys_created_by_idx on private.print_signing_keys (created_by);
create index if not exists customers_created_by_idx on public.customers (created_by);
create index if not exists customers_modified_by_idx on public.customers (modified_by);
create index if not exists console_actions_actor_idx on public.console_actions (actor);
create index if not exists console_members_added_by_idx on private.console_members (added_by);
create index if not exists jobs_modified_by_idx on public.jobs (modified_by);
create index if not exists shop_members_created_by_idx on public.shop_members (created_by);
create index if not exists shop_members_modified_by_idx on public.shop_members (modified_by);
create index if not exists device_problems_resolved_by_idx on public.device_problems (resolved_by);
create index if not exists subscription_payments_recorded_by_idx on public.subscription_payments (recorded_by);
create index if not exists platform_settings_trial_plan_id_idx on public.platform_settings (trial_plan_id);
create index if not exists platform_settings_updated_by_idx on public.platform_settings (updated_by);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists subscriptions_updated_by_idx on public.subscriptions (updated_by);
create index if not exists branch_prices_modified_by_idx on public.branch_prices (modified_by);
create index if not exists stock_requests_handled_by_idx on public.stock_requests (handled_by);
create index if not exists stock_requests_requested_by_idx on public.stock_requests (requested_by);
create index if not exists stock_requests_shop_id_material_id_idx on public.stock_requests (shop_id, material_id);
