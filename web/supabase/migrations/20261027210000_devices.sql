-- Developer console, part 3: devices. Each phone or computer reports a few facts when it syncs
-- (at most every few minutes): who is signed in, app version, unsent and held work, last sync and
-- its History check. The console lists them and can sign a device out; the device signs out the
-- next time it reports, keeping any unsent work on the device.

create table if not exists public.devices (
  shop_id uuid not null references public.shops(id) on delete cascade,
  id uuid not null,
  name text not null default '',
  user_id uuid references auth.users(id) on delete set null,
  user_label text not null default '',
  app_version text not null default '',
  pending integer not null default 0,
  held integer not null default 0,
  last_synced timestamptz,
  history jsonb not null default '{}'::jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  sign_out_requested_at timestamptz,
  signed_out_at timestamptz,
  primary key (shop_id, id)
);
alter table public.devices enable row level security;
revoke all on public.devices from public, anon, authenticated;

-- Called by the app after a sync. Returns { signOut } when the console asked this device to sign out.
create or replace function public.report_device(p_shop uuid, p_device uuid, p_info jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare rec public.devices%rowtype; who text;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_device is null or jsonb_typeof(p_info) is distinct from 'object' or octet_length(p_info::text) > 4000 then
    raise exception 'Invalid device report';
  end if;
  select coalesce(m.name, '') into who from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid();
  insert into public.devices as d (shop_id, id, name, user_id, user_label, app_version, pending, held, last_synced, history, last_seen)
  values (p_shop, p_device, left(coalesce(p_info->>'name', ''), 120), auth.uid(), left(coalesce(who, ''), 160),
    left(coalesce(p_info->>'appVersion', ''), 60),
    greatest(0, least(coalesce((p_info->>'pending')::integer, 0), 1000000)),
    greatest(0, least(coalesce((p_info->>'held')::integer, 0), 1000000)),
    case when p_info->>'lastSynced' ~ '^\d{4}-\d{2}-\d{2}T' then (p_info->>'lastSynced')::timestamptz end,
    case when jsonb_typeof(p_info->'history') = 'object' then p_info->'history' else '{}'::jsonb end,
    now())
  on conflict (shop_id, id) do update set name = excluded.name, user_id = excluded.user_id, user_label = excluded.user_label,
    app_version = excluded.app_version, pending = excluded.pending, held = excluded.held,
    last_synced = coalesce(excluded.last_synced, d.last_synced), history = excluded.history, last_seen = now()
  returning * into rec;
  return jsonb_build_object('signOut', rec.sign_out_requested_at is not null
    and (rec.signed_out_at is null or rec.signed_out_at < rec.sign_out_requested_at));
end $f$;

-- The device confirms it signed out.
create or replace function public.ack_device_sign_out(p_shop uuid, p_device uuid) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  update public.devices set signed_out_at = now() where shop_id = p_shop and id = p_device and sign_out_requested_at is not null;
end $f$;

create or replace function public.console_devices(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'userLabel', d.user_label,
      'appVersion', d.app_version, 'pending', d.pending, 'held', d.held, 'lastSynced', d.last_synced,
      'history', d.history, 'firstSeen', d.first_seen, 'lastSeen', d.last_seen,
      'signOutRequestedAt', d.sign_out_requested_at, 'signedOutAt', d.signed_out_at) order by d.last_seen desc)
    from public.devices d where d.shop_id = p_shop), '[]'::jsonb);
end $f$;

create or replace function public.console_device_action(p_shop uuid, p_device uuid, p_action text) returns void
language plpgsql security definer set search_path to '' as $f$
declare label text;
begin
  perform private.require_console();
  select name || coalesce(' · ' || nullif(user_label, ''), '') into label from public.devices where shop_id = p_shop and id = p_device;
  if label is null then raise exception 'Device not found.'; end if;
  if p_action = 'sign-out' then
    update public.devices set sign_out_requested_at = now() where shop_id = p_shop and id = p_device;
  elsif p_action = 'cancel-sign-out' then
    update public.devices set sign_out_requested_at = null where shop_id = p_shop and id = p_device;
  elsif p_action = 'forget' then
    delete from public.devices where shop_id = p_shop and id = p_device;
  else raise exception 'Unknown device action.'; end if;
  perform private.console_log(p_shop, 'device.' || p_action, jsonb_build_object('device', label, 'id', p_device));
end $f$;

revoke all on function public.report_device(uuid,uuid,jsonb), public.ack_device_sign_out(uuid,uuid),
  public.console_devices(uuid), public.console_device_action(uuid,uuid,text) from public, anon;
grant execute on function public.report_device(uuid,uuid,jsonb), public.ack_device_sign_out(uuid,uuid),
  public.console_devices(uuid), public.console_device_action(uuid,uuid,text) to authenticated;

-- The business list shows how many devices were seen in the last 7 days.
do $mig$
declare src text;
  a text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id)$x$;
  b text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),
      'devices7', (select count(*) from public.devices d where d.shop_id = s.id and d.last_seen > now() - interval '7 days')$x$;
begin
  src := pg_get_functiondef('public.console_businesses()'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'console_businesses changed; review the devices migration'; end if;
  execute replace(src, a, b);
end $mig$;
