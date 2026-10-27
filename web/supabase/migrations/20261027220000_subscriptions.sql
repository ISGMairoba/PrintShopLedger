-- Developer console, part 4: subscriptions.
-- * plans: name, price, length and the most devices a business may use.
-- * subscriptions: one per business, set from the console: plan, dates, grace days, what happens
--   when it runs out (expiry_mode), pages turned off, a message for the business, a device limit.
--   A business without a subscription row works as before.
-- * subscription_payments: payments recorded by hand, each extending the subscription.
-- On expiry (after grace days):
--   warn      – everything keeps working; the app shows a reminder
--   read_only – records can be viewed and exported; new work is refused by the server (devices keep
--               it and send it after renewal; work done before the expiry is still accepted)
--   pages_off – the chosen pages are hidden in the app
--   locked    – the app shows only the message; the server refuses downloads and new work
-- A suspended subscription behaves as expired straight away.

create table if not exists public.plans (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  price bigint not null default 0 check (price between 0 and 100000000000),
  period_days integer not null default 30 check (period_days between 1 and 3660),
  max_devices integer check (max_devices is null or max_devices between 1 and 1000),
  description text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
revoke all on public.plans from public, anon, authenticated;

create table if not exists public.subscriptions (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  plan_id text references public.plans(id),
  status text not null default 'active' check (status in ('trial', 'active', 'suspended')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  grace_days integer not null default 3 check (grace_days between 0 and 60),
  expiry_mode text not null default 'read_only' check (expiry_mode in ('warn', 'read_only', 'pages_off', 'locked')),
  pages_off text[] not null default '{}',
  message text not null default '' check (length(message) <= 500),
  max_devices integer check (max_devices is null or max_devices between 1 and 1000),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from public, anon, authenticated;

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  amount bigint not null check (amount between 0 and 100000000000),
  paid_on date not null,
  method text not null default '' check (length(method) <= 80),
  reference text not null default '' check (length(reference) <= 200),
  extended_to timestamptz,
  note text not null default '' check (length(note) <= 500),
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);
create index if not exists subscription_payments_shop on public.subscription_payments(shop_id, paid_on desc);
alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from public, anon, authenticated;

-- The state of a business's subscription at a moment: none, trial, active, grace, expired, suspended.
create or replace function private.subscription_state(p_shop uuid, p_at timestamptz default now()) returns text
language sql stable security definer set search_path to '' as $f$
  select coalesce((
    select case
      when s.status = 'suspended' then 'suspended'
      when s.expires_at is null or p_at < s.expires_at then s.status
      when p_at < s.expires_at + make_interval(days => s.grace_days) then 'grace'
      else 'expired' end
    from public.subscriptions s where s.shop_id = p_shop), 'none')
$f$;
-- What expiry does to the business now ('' while it may work normally).
create or replace function private.subscription_restriction(p_shop uuid, p_at timestamptz default now()) returns text
language sql stable security definer set search_path to '' as $f$
  select case when private.subscription_state(p_shop, p_at) in ('expired', 'suspended')
    then (select expiry_mode from public.subscriptions where shop_id = p_shop) else '' end
$f$;

-- For the app: the business's subscription as its staff see it.
create or replace function public.my_subscription(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare s public.subscriptions%rowtype; st text;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  select * into s from public.subscriptions where shop_id = p_shop;
  if not found then return jsonb_build_object('state', 'none'); end if;
  st := private.subscription_state(p_shop);
  return jsonb_build_object('state', st, 'plan', (select name from public.plans where id = s.plan_id),
    'expiresAt', s.expires_at,
    'graceEndsAt', case when s.expires_at is null then null else s.expires_at + make_interval(days => s.grace_days) end,
    'restriction', case when st in ('expired', 'suspended') then s.expiry_mode else '' end,
    'pagesOff', case when st in ('expired', 'suspended') and s.expiry_mode = 'pages_off' then to_jsonb(s.pages_off) else '[]'::jsonb end,
    'message', s.message);
end $f$;

-- The server's check on new work: refused when read-only or locked, unless the work was done
-- before the subscription ran out (saved offline earlier and sent now).
create or replace function private.enforce_subscription() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare mode text; done_at timestamptz; ends timestamptz;
begin
  mode := private.subscription_restriction(new.shop_id);
  if mode not in ('read_only', 'locked') then return new; end if;
  -- The console team can still fix a business (staff, settings) while it is read-only or locked.
  if private.console_role() is not null then return new; end if;
  select case when s.status = 'suspended' then s.updated_at else s.expires_at + make_interval(days => s.grace_days) end
    into ends from public.subscriptions s where s.shop_id = new.shop_id;
  begin
    done_at := coalesce(new.payload->'data'->>'createdAt', new.payload->'data'->>'modifiedAt', new.payload->'data'->>'changedAt')::timestamptz;
  exception when others then done_at := null;
  end;
  if done_at is not null and ends is not null and done_at < ends and done_at > now() - interval '60 days' then return new; end if;
  raise exception 'This business''s subscription has ended. New work is kept on this device and sends once it is renewed.'
    using errcode = 'PSLSB';
end $f$;
drop trigger if exists enforce_subscription on public.ledger_events;
create trigger enforce_subscription before insert on public.ledger_events
  for each row execute function private.enforce_subscription();

-- Locked businesses cannot download their records. get_ledger_changes runs with the caller's rights,
-- so it asks my_subscription (which checks membership) rather than the private helper.
do $mig$
declare src text;
  a text := $x$ledger := public.get_ledger(p_shop);$x$;
  b text := $x$if public.my_subscription(p_shop)->>'restriction' = 'locked' then raise exception 'This business''s subscription has ended. Contact PrintShopLedger to renew.' using errcode = 'PSLSB'; end if; ledger := public.get_ledger(p_shop);$x$;
begin
  src := pg_get_functiondef('public.get_ledger_changes(uuid,text)'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'get_ledger_changes changed; review the subscriptions migration'; end if;
  execute replace(src, a, b);
end $mig$;

-- Device limit: a new device is refused when the business already uses its plan's (or its own) limit.
-- Devices count when seen in the last 30 days and not signed out from the console.
do $mig$
declare src text;
  a text := $x$  select coalesce(m.name, '') into who from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid();$x$;
  b text := $x$  select coalesce(m.name, '') into who from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid();
  if not exists (select 1 from public.devices d where d.shop_id = p_shop and d.id = p_device) then
    declare lim integer := (select coalesce(s.max_devices, p.max_devices) from public.subscriptions s left join public.plans p on p.id = s.plan_id where s.shop_id = p_shop);
    begin
      if lim is not null and (select count(*) from public.devices d where d.shop_id = p_shop and d.last_seen > now() - interval '30 days'
          and not (d.sign_out_requested_at is not null and (d.signed_out_at is null or d.signed_out_at >= d.sign_out_requested_at))) >= lim then
        return jsonb_build_object('signOut', false, 'deviceLimit', lim);
      end if;
    end;
  end if;$x$;
begin
  src := pg_get_functiondef('public.report_device(uuid,uuid,jsonb)'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'report_device changed; review the subscriptions migration'; end if;
  execute replace(src, a, b);
end $mig$;

-- Console: plans.
create or replace function public.console_plans() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'periodDays', p.period_days,
      'maxDevices', p.max_devices, 'description', p.description, 'archived', p.archived,
      'businesses', (select count(*) from public.subscriptions s where s.plan_id = p.id)) order by p.archived, p.price, p.name)
    from public.plans p), '[]'::jsonb);
end $f$;
create or replace function public.console_save_plan(p_plan jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console();
  insert into public.plans (id, name, price, period_days, max_devices, description, archived)
  values (p_plan->>'id', btrim(p_plan->>'name'), (p_plan->>'price')::bigint, (p_plan->>'periodDays')::integer,
    nullif(p_plan->>'maxDevices', '')::integer, coalesce(p_plan->>'description', ''), coalesce((p_plan->>'archived')::boolean, false))
  on conflict (id) do update set name = excluded.name, price = excluded.price, period_days = excluded.period_days,
    max_devices = excluded.max_devices, description = excluded.description, archived = excluded.archived;
  perform private.console_log(null, 'plan.saved', p_plan);
end $f$;

-- Console: one business's subscription and payments.
create or replace function public.console_subscription(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return jsonb_build_object(
    'subscription', (select jsonb_build_object('planId', s.plan_id, 'status', s.status, 'startsAt', s.starts_at,
        'expiresAt', s.expires_at, 'graceDays', s.grace_days, 'expiryMode', s.expiry_mode, 'pagesOff', to_jsonb(s.pages_off),
        'message', s.message, 'maxDevices', s.max_devices, 'updatedAt', s.updated_at)
      from public.subscriptions s where s.shop_id = p_shop),
    'state', private.subscription_state(p_shop),
    'devices', (select count(*) from public.devices d where d.shop_id = p_shop and d.last_seen > now() - interval '30 days'
          and not (d.sign_out_requested_at is not null and (d.signed_out_at is null or d.signed_out_at >= d.sign_out_requested_at))),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'paidOn', x.paid_on, 'method', x.method,
        'reference', x.reference, 'extendedTo', x.extended_to, 'note', x.note, 'recordedAt', x.recorded_at,
        'recordedBy', (select name from private.console_members c where c.user_id = x.recorded_by)) order by x.paid_on desc, x.recorded_at desc)
      from public.subscription_payments x where x.shop_id = p_shop), '[]'::jsonb));
end $f$;

create or replace function public.console_save_subscription(p_shop uuid, p_sub jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare before jsonb;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  if p_sub->>'planId' is not null and not exists (select 1 from public.plans where id = p_sub->>'planId') then raise exception 'Choose a plan from the list.'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_sub->'pagesOff', '[]'::jsonb)) x(page)
      where x.page not in ('Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
        'Payment Reminders','Payments','Expenses','Materials','Services','Edit Products','Stock History','Print Settings','Users',
        'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste')) then
    raise exception 'Choose pages from the list.';
  end if;
  select to_jsonb(s) into before from public.subscriptions s where s.shop_id = p_shop;
  insert into public.subscriptions as s (shop_id, plan_id, status, starts_at, expires_at, grace_days, expiry_mode, pages_off, message, max_devices, updated_by, updated_at)
  values (p_shop, p_sub->>'planId', coalesce(p_sub->>'status', 'active'), coalesce((p_sub->>'startsAt')::timestamptz, now()),
    (p_sub->>'expiresAt')::timestamptz, coalesce((p_sub->>'graceDays')::integer, 3), coalesce(p_sub->>'expiryMode', 'read_only'),
    array(select jsonb_array_elements_text(coalesce(p_sub->'pagesOff', '[]'::jsonb))), btrim(coalesce(p_sub->>'message', '')),
    nullif(p_sub->>'maxDevices', '')::integer, auth.uid(), now())
  on conflict (shop_id) do update set plan_id = excluded.plan_id, status = excluded.status, starts_at = excluded.starts_at,
    expires_at = excluded.expires_at, grace_days = excluded.grace_days, expiry_mode = excluded.expiry_mode,
    pages_off = excluded.pages_off, message = excluded.message, max_devices = excluded.max_devices,
    updated_by = excluded.updated_by, updated_at = now();
  perform private.console_log(p_shop, 'subscription.saved', jsonb_build_object('before', before, 'after', p_sub), nullif(btrim(coalesce(p_sub->>'reason', '')), ''));
end $f$;

-- Record a payment; with extendedTo, the subscription runs to that date and becomes active.
create or replace function public.console_record_payment(p_shop uuid, p_payment jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare ext timestamptz := nullif(p_payment->>'extendedTo', '')::timestamptz;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  insert into public.subscription_payments (shop_id, amount, paid_on, method, reference, extended_to, note, recorded_by)
  values (p_shop, (p_payment->>'amount')::bigint, (p_payment->>'paidOn')::date, btrim(coalesce(p_payment->>'method', '')),
    btrim(coalesce(p_payment->>'reference', '')), ext, btrim(coalesce(p_payment->>'note', '')), auth.uid());
  if ext is not null then
    if ext <= now() then raise exception 'Extend to a date in the future.'; end if;
    insert into public.subscriptions as s (shop_id, status, expires_at, updated_by)
    values (p_shop, 'active', ext, auth.uid())
    on conflict (shop_id) do update set expires_at = ext, status = 'active', updated_by = auth.uid(), updated_at = now();
  end if;
  perform private.console_log(p_shop, 'subscription.payment', p_payment);
end $f$;

-- The business list shows each business's plan and subscription state.
do $mig$
declare src text;
  a text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),$x$;
  b text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),
      'plan', (select p.name from public.subscriptions x join public.plans p on p.id = x.plan_id where x.shop_id = s.id),
      'subscription', private.subscription_state(s.id),
      'expiresAt', (select x.expires_at from public.subscriptions x where x.shop_id = s.id),$x$;
begin
  src := pg_get_functiondef('public.console_businesses()'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'console_businesses changed; review the subscriptions migration'; end if;
  execute replace(src, a, b);
end $mig$;

revoke all on function private.subscription_state(uuid,timestamptz), private.subscription_restriction(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.my_subscription(uuid), public.console_plans(), public.console_save_plan(jsonb), public.console_subscription(uuid),
  public.console_save_subscription(uuid,jsonb), public.console_record_payment(uuid,jsonb) from public, anon;
grant execute on function public.my_subscription(uuid), public.console_plans(), public.console_save_plan(jsonb), public.console_subscription(uuid),
  public.console_save_subscription(uuid,jsonb), public.console_record_payment(uuid,jsonb) to authenticated;
