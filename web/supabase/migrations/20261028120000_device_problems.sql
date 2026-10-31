-- Developer console, part 6: Problems.
-- Devices report app errors and failed syncs (sent with their next sync). The same problem on the
-- same device is one row with a count. The console lists them across businesses and marks them fixed;
-- a fixed problem that happens again opens again.

create table if not exists public.device_problems (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  device_id uuid not null,
  kind text not null check (kind in ('error', 'sync')),
  message text not null check (length(message) between 1 and 300),
  detail jsonb not null default '{}'::jsonb,
  user_id uuid,
  user_label text not null default '',
  app_version text not null default '',
  count integer not null default 1 check (count > 0),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  unique (shop_id, device_id, kind, message)
);
create index if not exists device_problems_open on public.device_problems(last_at desc) where resolved_at is null;
alter table public.device_problems enable row level security;
revoke all on public.device_problems from public, anon, authenticated;

-- From a device: up to 20 problems at a time. Each is { kind, message, detail, count, firstAt, lastAt }.
create or replace function public.report_problems(p_shop uuid, p_device uuid, p_items jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare item jsonb; who text; ver text; seen timestamptz; began timestamptz;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Invalid problems.'; end if;
  -- A device may keep at most 200 problems; beyond that only existing ones are counted.
  select coalesce(m.name, '') into who from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid();
  for item in select x from jsonb_array_elements(p_items) with ordinality t(x, n) where n <= 20 loop
    continue when coalesce(item->>'kind', '') not in ('error', 'sync') or btrim(coalesce(item->>'message', '')) = '';
    begin
      seen := least(coalesce((item->>'lastAt')::timestamptz, now()), now());
      began := least(coalesce((item->>'firstAt')::timestamptz, seen), seen);
    exception when others then seen := now(); began := now();
    end;
    ver := left(coalesce(item->'detail'->>'appVersion', ''), 60);
    if exists (select 1 from public.device_problems p where p.shop_id = p_shop and p.device_id = p_device
        and p.kind = item->>'kind' and p.message = left(btrim(item->>'message'), 300)) then
      update public.device_problems p set
        count = least(p.count + greatest(1, least(coalesce((item->>'count')::integer, 1), 10000)), 1000000000),
        last_at = greatest(p.last_at, seen),
        detail = case when length(coalesce(item->'detail', '{}'::jsonb)::text) <= 4000 then coalesce(item->'detail', '{}'::jsonb) else p.detail end,
        user_id = auth.uid(), user_label = coalesce(who, ''), app_version = ver,
        resolved_at = case when p.resolved_at is not null and seen > p.resolved_at then null else p.resolved_at end,
        resolved_by = case when p.resolved_at is not null and seen > p.resolved_at then null else p.resolved_by end
      where p.shop_id = p_shop and p.device_id = p_device and p.kind = item->>'kind' and p.message = left(btrim(item->>'message'), 300);
    elsif (select count(*) from public.device_problems p where p.shop_id = p_shop and p.device_id = p_device) < 200 then
      insert into public.device_problems (shop_id, device_id, kind, message, detail, user_id, user_label, app_version, count, first_at, last_at)
      values (p_shop, p_device, item->>'kind', left(btrim(item->>'message'), 300),
        case when length(coalesce(item->'detail', '{}'::jsonb)::text) <= 4000 then coalesce(item->'detail', '{}'::jsonb) else '{}'::jsonb end,
        auth.uid(), coalesce(who, ''), ver, greatest(1, least(coalesce((item->>'count')::integer, 1), 10000)), began, seen);
    end if;
  end loop;
end $f$;

-- Console: problems, open ones first; one business or all.
create or replace function public.console_problems(p_shop uuid default null, p_open boolean default true) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'shopId', p.shop_id, 'business', s.name,
      'deviceId', p.device_id, 'device', coalesce(d.name, ''), 'kind', p.kind, 'message', p.message, 'detail', p.detail,
      'userLabel', p.user_label, 'appVersion', p.app_version, 'count', p.count, 'firstAt', p.first_at, 'lastAt', p.last_at,
      'resolvedAt', p.resolved_at, 'resolvedBy', (select c.name from private.console_members c where c.user_id = p.resolved_by))
      order by p.last_at desc)
    from (select * from public.device_problems x
          where (p_shop is null or x.shop_id = p_shop) and (not p_open or x.resolved_at is null)
          order by x.last_at desc limit 300) p
    join public.shops s on s.id = p.shop_id
    left join public.devices d on d.shop_id = p.shop_id and d.id = p.device_id), '[]'::jsonb);
end $f$;

create or replace function public.console_problem_action(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path to '' as $f$
declare p public.device_problems%rowtype;
begin
  perform private.require_console();
  select * into p from public.device_problems where id = p_id;
  if not found then raise exception 'Problem not found.'; end if;
  if p_action = 'resolve' then
    update public.device_problems set resolved_at = now(), resolved_by = auth.uid() where id = p_id;
  elsif p_action = 'reopen' then
    update public.device_problems set resolved_at = null, resolved_by = null where id = p_id;
  else
    raise exception 'Unknown action.';
  end if;
  perform private.console_log(p.shop_id, 'problem.' || p_action, jsonb_build_object('message', p.message, 'kind', p.kind));
end $f$;

-- The business list shows each business's open problems.
do $mig$
declare src text;
  a text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),$x$;
  b text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),
      'problems', (select count(*) from public.device_problems p where p.shop_id = s.id and p.resolved_at is null),$x$;
begin
  src := pg_get_functiondef('public.console_businesses()'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'console_businesses changed; review the problems migration'; end if;
  execute replace(src, a, b);
end $mig$;

revoke all on function public.report_problems(uuid,uuid,jsonb), public.console_problems(uuid,boolean), public.console_problem_action(uuid,text) from public, anon;
grant execute on function public.report_problems(uuid,uuid,jsonb), public.console_problems(uuid,boolean), public.console_problem_action(uuid,text) to authenticated;
