-- Developer console, part 5.
-- * A free trial for every new business: set once in the console (plan, days, what happens after).
--   Each new business gets its own trial subscription the moment it is created.
-- * A full backup of one business, downloaded from the console: records, settings, staff,
--   subscription and payments.

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  trial_enabled boolean not null default false,
  trial_plan_id text references public.plans(id),
  trial_days integer not null default 14 check (trial_days between 1 and 365),
  trial_grace_days integer not null default 3 check (trial_grace_days between 0 and 60),
  trial_expiry_mode text not null default 'read_only' check (trial_expiry_mode in ('warn', 'read_only', 'pages_off', 'locked')),
  trial_pages_off text[] not null default '{}',
  trial_message text not null default '' check (length(trial_message) <= 500),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;

-- New businesses start on the trial (when it is turned on).
create or replace function private.start_trial() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare t public.platform_settings%rowtype;
begin
  select * into t from public.platform_settings where id = 1;
  if not found or not t.trial_enabled then return new; end if;
  insert into public.subscriptions (shop_id, plan_id, status, starts_at, expires_at, grace_days, expiry_mode, pages_off, message, updated_at)
  values (new.id, t.trial_plan_id, 'trial', now(), now() + make_interval(days => t.trial_days), t.trial_grace_days,
    t.trial_expiry_mode, t.trial_pages_off, t.trial_message, now())
  on conflict (shop_id) do nothing;
  return new;
end $f$;
drop trigger if exists start_trial on public.shops;
create trigger start_trial after insert on public.shops for each row execute function private.start_trial();

create or replace function public.console_trial_settings() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return (select jsonb_build_object('enabled', t.trial_enabled, 'planId', t.trial_plan_id, 'days', t.trial_days,
      'graceDays', t.trial_grace_days, 'expiryMode', t.trial_expiry_mode, 'pagesOff', to_jsonb(t.trial_pages_off),
      'message', t.trial_message, 'updatedAt', t.updated_at)
    from public.platform_settings t where t.id = 1);
end $f$;

create or replace function public.console_save_trial_settings(p_trial jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console();
  if nullif(p_trial->>'planId', '') is not null and not exists (select 1 from public.plans where id = p_trial->>'planId') then
    raise exception 'Choose a plan from the list.';
  end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_trial->'pagesOff', '[]'::jsonb)) x(page)
      where x.page not in ('Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
        'Payment Reminders','Payments','Expenses','Materials','Services','Edit Products','Stock History','Print Settings','Users',
        'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste')) then
    raise exception 'Choose pages from the list.';
  end if;
  update public.platform_settings set
    trial_enabled = coalesce((p_trial->>'enabled')::boolean, false),
    trial_plan_id = nullif(p_trial->>'planId', ''),
    trial_days = coalesce((p_trial->>'days')::integer, 14),
    trial_grace_days = coalesce((p_trial->>'graceDays')::integer, 3),
    trial_expiry_mode = coalesce(p_trial->>'expiryMode', 'read_only'),
    trial_pages_off = array(select jsonb_array_elements_text(coalesce(p_trial->'pagesOff', '[]'::jsonb))),
    trial_message = btrim(coalesce(p_trial->>'message', '')),
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
  perform private.console_log(null, 'trial.saved', p_trial);
end $f$;

-- A full backup of one business. The business's records are read exactly as its own devices read
-- them, as its highest-ranked active staff account, then the console team member is restored.
create or replace function public.console_business_backup(p_shop uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare
  me uuid := auth.uid();
  claims text := current_setting('request.jwt.claims', true);
  member uuid;
  ledger jsonb;
  result jsonb;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  select m.user_id into member from public.shop_members m
    where m.shop_id = p_shop and not m.archived and m.access_level > 0 and m.user_id is not null
    order by m.rank desc, m.created_at limit 1;
  if member is null then raise exception 'This business has no active staff account to read its records with.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  begin
    ledger := public.get_ledger(p_shop);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  if auth.uid() is distinct from me then raise exception 'Could not restore the console session.'; end if;
  result := jsonb_build_object(
    'format', 'printshopledger-backup', 'version', 1, 'createdAt', now(),
    'business', (select jsonb_build_object('id', s.id, 'name', s.name, 'createdAt', s.created_at) from public.shops s where s.id = p_shop),
    'settings', (select jsonb_build_object('settings', b.settings, 'version', b.version, 'modifiedAt', b.modified_at)
                   from public.business_settings b where b.shop_id = p_shop),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'username', m.username, 'role', m.role,
                   'rank', m.rank, 'accessLevel', m.access_level, 'archived', m.archived) order by m.rank desc, m.name)
                 from public.shop_members m where m.shop_id = p_shop), '[]'::jsonb),
    'subscription', public.console_subscription(p_shop),
    'ledger', ledger);
  perform private.console_log(p_shop, 'business.backup', jsonb_build_object('bytes', length(result::text)));
  return result;
end $f$;

revoke all on function private.start_trial() from public, anon, authenticated;
revoke all on function public.console_trial_settings(), public.console_save_trial_settings(jsonb), public.console_business_backup(uuid) from public, anon;
grant execute on function public.console_trial_settings(), public.console_save_trial_settings(jsonb), public.console_business_backup(uuid) to authenticated;
