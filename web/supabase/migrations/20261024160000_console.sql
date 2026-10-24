-- Developer console, part 1: a separate sign-in for the platform team (not any business's account),
-- a list of every business, each business's overview and usage, and a log of console actions.
-- Console members are their own accounts listed in private.console_members:
--   owner   – everything, including adding or removing team members
--   support – everything except managing the team
-- Every console function checks the caller first; business staff can never use them.

create table if not exists private.console_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','support')),
  name text not null check (length(btrim(name)) between 1 and 80),
  disabled boolean not null default false,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now()
);

create table if not exists public.console_actions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete set null,
  actor uuid not null references auth.users(id),
  actor_name text not null,
  action text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists console_actions_shop_at on public.console_actions(shop_id, at desc);
create index if not exists console_actions_at on public.console_actions(at desc);
alter table public.console_actions enable row level security;
revoke all on public.console_actions from public, anon, authenticated;

create or replace function private.console_role() returns text
language sql stable security definer set search_path to '' as $f$
  select role from private.console_members where user_id = auth.uid() and not disabled
$f$;

create or replace function private.require_console(p_owner boolean default false) returns text
language plpgsql stable security definer set search_path to '' as $f$
declare r text := private.console_role();
begin
  if r is null then raise exception 'Only the PrintShopLedger console team can do this.' using errcode = '42501'; end if;
  if p_owner and r <> 'owner' then raise exception 'Only the console owner can do this.' using errcode = '42501'; end if;
  return r;
end $f$;

-- Write a console log line (called by console functions and the console's server functions).
create or replace function private.console_log(p_shop uuid, p_action text, p_details jsonb default '{}'::jsonb, p_reason text default null)
returns void language sql security definer set search_path to '' as $f$
  insert into public.console_actions(shop_id, actor, actor_name, action, reason, details)
  select p_shop, auth.uid(), coalesce((select name from private.console_members where user_id = auth.uid()), 'Unknown'),
         p_action, nullif(btrim(coalesce(p_reason,'')),''), coalesce(p_details,'{}'::jsonb)
$f$;

-- Who is signed in to the console (null for anyone who is not a console member).
create or replace function public.console_whoami() returns jsonb
language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('userId', m.user_id, 'role', m.role, 'name', m.name, 'email', u.email)
  from private.console_members m join auth.users u on u.id = m.user_id
  where m.user_id = auth.uid() and not m.disabled
$f$;

-- The business account (the email the shop signs in with) of a business.
create or replace function private.console_owner_email(p_shop uuid) returns text
language sql stable security definer set search_path to '' as $f$
  select u.email from public.shop_members m join auth.users u on u.id = m.user_id
  where m.shop_id = p_shop and u.email not like '%@staff.printshopledger.invalid'
  order by m.created_at limit 1
$f$;

create or replace function public.console_businesses() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(x.rw order by x.rw->>'name') from (
    select jsonb_build_object(
      'id', s.id, 'name', s.name, 'createdAt', s.created_at,
      'ownerEmail', private.console_owner_email(s.id),
      'staff', (select count(*) from public.shop_members m where m.shop_id = s.id and not m.archived and m.role <> 'developer'),
      'customers', (select count(*) from public.customers c where c.shop_id = s.id and not c.archived),
      'jobs', (select count(*) from public.jobs j where j.shop_id = s.id),
      'sales30', coalesce((select sum(j.amount) from public.jobs j where j.shop_id = s.id and j.created_at > now() - interval '30 days'), 0),
      'events7', (select count(*) from public.ledger_events e where e.shop_id = s.id and e.received_at > now() - interval '7 days'),
      'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id)
    ) as rw from public.shops s
  ) x), '[]'::jsonb);
end $f$;

-- One business: its staff, record counts, storage and activity over the last 30 days.
create or replace function public.console_business(p_shop uuid) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare result jsonb;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'currency', s.currency, 'createdAt', s.created_at,
    'ownerEmail', private.console_owner_email(s.id),
    'settingsVersion', (select b.version from public.business_settings b where b.shop_id = s.id),
    'settingsChangedAt', (select b.modified_at from public.business_settings b where b.shop_id = s.id),
    'staff', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'name', m.name, 'username', m.username, 'role', m.role, 'rank', m.rank,
        'accessLevel', m.access_level, 'archived', m.archived, 'createdAt', m.created_at,
        'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id and e.actor_id = m.user_id)
      ) order by m.archived, m.rank desc, m.name) from public.shop_members m where m.shop_id = s.id), '[]'::jsonb),
    'records', jsonb_build_object(
      'customers', (select count(*) from public.customers x where x.shop_id = s.id),
      'jobs', (select count(*) from public.jobs x where x.shop_id = s.id),
      'payments', (select count(*) from public.payments x where x.shop_id = s.id),
      'services', (select count(*) from public.services x where x.shop_id = s.id),
      'materials', (select count(*) from public.materials x where x.shop_id = s.id),
      'stockChanges', (select count(*) from public.material_stock_changes x where x.shop_id = s.id),
      'expenses', (select count(*) from public.expenses x where x.shop_id = s.id),
      'quotations', (select count(*) from public.quotations x where x.shop_id = s.id),
      'events', (select count(*) from public.ledger_events x where x.shop_id = s.id)
    ),
    'storageBytes', jsonb_build_object(
      'jobs', coalesce((select sum(pg_column_size(x.*)) from public.jobs x where x.shop_id = s.id), 0),
      'payments', coalesce((select sum(pg_column_size(x.*)) from public.payments x where x.shop_id = s.id), 0),
      'customers', coalesce((select sum(pg_column_size(x.*)) from public.customers x where x.shop_id = s.id), 0),
      'stockChanges', coalesce((select sum(pg_column_size(x.*)) from public.material_stock_changes x where x.shop_id = s.id), 0),
      'events', coalesce((select sum(pg_column_size(x.*)) from public.ledger_events x where x.shop_id = s.id), 0),
      'settings', coalesce((select sum(pg_column_size(x.*)) from public.business_settings x where x.shop_id = s.id), 0)
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.dd, 'events', d.events, 'sales', d.sales) order by d.dd) from (
        select g.dd::date as dd,
          (select count(*) from public.ledger_events e where e.shop_id = s.id and (e.received_at at time zone 'Africa/Lagos')::date = g.dd::date) as events,
          coalesce((select sum(j.amount) from public.jobs j where j.shop_id = s.id and (j.created_at at time zone 'Africa/Lagos')::date = g.dd::date), 0) as sales
        from generate_series((now() at time zone 'Africa/Lagos')::date - 29, (now() at time zone 'Africa/Lagos')::date, interval '1 day') as g(dd)
      ) d), '[]'::jsonb)
  ) into result from public.shops s where s.id = p_shop;
  perform private.console_log(p_shop, 'business.viewed');
  return result;
end $f$;

-- The console log: everything done from the console, newest first (one business, or all).
create or replace function public.console_activity(p_shop uuid default null, p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'shopId', a.shop_id, 'business', s.name, 'actorName', a.actor_name, 'action', a.action,
      'reason', a.reason, 'details', a.details, 'at', a.at) order by a.at desc)
    from (select * from public.console_actions where p_shop is null or shop_id = p_shop order by at desc limit least(greatest(p_limit,1),1000)) a
    left join public.shops s on s.id = a.shop_id), '[]'::jsonb);
end $f$;

-- The console team (owner and support members).
create or replace function public.console_team() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', m.name, 'email', u.email, 'role', m.role,
      'disabled', m.disabled, 'addedAt', m.added_at) order by m.role, m.name)
    from private.console_members m join auth.users u on u.id = m.user_id), '[]'::jsonb);
end $f$;

-- The owner adds an existing account to the team (the console-team server function creates the
-- account first), changes a member's role, or turns a member off.
create or replace function public.console_set_member(p_user uuid, p_name text, p_role text, p_disabled boolean default false) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console(true);
  if p_role not in ('owner','support') then raise exception 'Choose owner or support.'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Enter a name.'; end if;
  if p_user = auth.uid() and (p_disabled or p_role <> 'owner') then raise exception 'You cannot remove your own owner access.'; end if;
  if exists (select 1 from public.shop_members where user_id = p_user) then
    raise exception 'That account belongs to a business. Use a separate email for the console.';
  end if;
  insert into private.console_members(user_id, role, name, disabled, added_by)
  values (p_user, p_role, btrim(p_name), p_disabled, auth.uid())
  on conflict (user_id) do update set role = excluded.role, name = excluded.name, disabled = excluded.disabled;
  perform private.console_log(null, 'team.member_set', jsonb_build_object('userId', p_user, 'name', btrim(p_name), 'role', p_role, 'disabled', p_disabled));
end $f$;

revoke all on function private.console_role(), private.require_console(boolean), private.console_log(uuid,text,jsonb,text), private.console_owner_email(uuid) from public, anon, authenticated;
revoke all on function public.console_whoami(), public.console_businesses(), public.console_business(uuid), public.console_activity(uuid,integer), public.console_team(), public.console_set_member(uuid,text,text,boolean) from public, anon;
grant execute on function public.console_whoami(), public.console_businesses(), public.console_business(uuid), public.console_activity(uuid,integer), public.console_team(), public.console_set_member(uuid,text,text,boolean) to authenticated;
