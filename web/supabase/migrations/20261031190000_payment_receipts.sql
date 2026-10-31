-- Developer console, part 7: receipts for subscription payments.
-- * Each payment gets a receipt number (PSL-000001…) and keeps the plan it paid for.
-- * The receipt's issuer details (name, address, phone, email, bank, footer) are set in the console.

alter table public.subscription_payments add column if not exists receipt_no bigint generated always as identity;
alter table public.subscription_payments add column if not exists plan_name text not null default '';
create unique index if not exists subscription_payments_receipt_no on public.subscription_payments(receipt_no);
-- Payments recorded before now: the business's current plan.
update public.subscription_payments x set plan_name = coalesce((select p.name from public.subscriptions s
  join public.plans p on p.id = s.plan_id where s.shop_id = x.shop_id), '') where x.plan_name = '';

alter table public.platform_settings add column if not exists receipt_issuer jsonb not null
  default '{"name":"PrintShopLedger","address":"","phone":"","email":"","bank":"","footer":"Thank you for using PrintShopLedger."}'::jsonb;

-- It now returns the new payment's receipt number (it returned nothing before).
drop function if exists public.console_record_payment(uuid, jsonb);
create or replace function public.console_record_payment(p_shop uuid, p_payment jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare ext timestamptz := nullif(p_payment->>'extendedTo', '')::timestamptz; rec public.subscription_payments%rowtype;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  if ext is not null and ext <= now() then raise exception 'Extend to a date in the future.'; end if;
  insert into public.subscription_payments (shop_id, amount, paid_on, method, reference, extended_to, note, recorded_by, plan_name)
  values (p_shop, (p_payment->>'amount')::bigint, (p_payment->>'paidOn')::date, btrim(coalesce(p_payment->>'method', '')),
    btrim(coalesce(p_payment->>'reference', '')), ext, btrim(coalesce(p_payment->>'note', '')), auth.uid(),
    coalesce((select p.name from public.subscriptions s join public.plans p on p.id = s.plan_id where s.shop_id = p_shop), ''))
  returning * into rec;
  if ext is not null then
    insert into public.subscriptions as s (shop_id, status, expires_at, updated_by)
    values (p_shop, 'active', ext, auth.uid())
    on conflict (shop_id) do update set expires_at = ext, status = 'active', updated_by = auth.uid(), updated_at = now();
  end if;
  perform private.console_log(p_shop, 'subscription.payment', p_payment || jsonb_build_object('receiptNo', rec.receipt_no));
  return jsonb_build_object('id', rec.id, 'receiptNo', rec.receipt_no);
end $f$;

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
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'receiptNo', x.receipt_no, 'planName', x.plan_name,
        'amount', x.amount, 'paidOn', x.paid_on, 'method', x.method,
        'reference', x.reference, 'extendedTo', x.extended_to, 'note', x.note, 'recordedAt', x.recorded_at,
        'recordedBy', (select name from private.console_members c where c.user_id = x.recorded_by)) order by x.paid_on desc, x.recorded_at desc)
      from public.subscription_payments x where x.shop_id = p_shop), '[]'::jsonb));
end $f$;

create or replace function public.console_receipt_issuer() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return (select receipt_issuer from public.platform_settings where id = 1);
end $f$;

create or replace function public.console_save_receipt_issuer(p_issuer jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare clean jsonb;
begin
  perform private.require_console(true);
  clean := jsonb_build_object(
    'name', left(btrim(coalesce(p_issuer->>'name', '')), 120),
    'address', left(btrim(coalesce(p_issuer->>'address', '')), 300),
    'phone', left(btrim(coalesce(p_issuer->>'phone', '')), 80),
    'email', left(btrim(coalesce(p_issuer->>'email', '')), 120),
    'bank', left(btrim(coalesce(p_issuer->>'bank', '')), 300),
    'footer', left(btrim(coalesce(p_issuer->>'footer', '')), 300));
  if clean->>'name' = '' then raise exception 'Enter the name shown on receipts.'; end if;
  update public.platform_settings set receipt_issuer = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
  perform private.console_log(null, 'receipt_issuer.saved', clean);
end $f$;

revoke all on function public.console_record_payment(uuid,jsonb), public.console_receipt_issuer(), public.console_save_receipt_issuer(jsonb) from public, anon;
grant execute on function public.console_record_payment(uuid,jsonb), public.console_receipt_issuer(), public.console_save_receipt_issuer(jsonb) to authenticated;
