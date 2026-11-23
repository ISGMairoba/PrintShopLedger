-- Housekeeping (plans/audit-2-overnight.md):
--   * AUD-26: a payment recorded in the Developer console carries an intent id, the same for every try;
--     a retry after a lost reply returns the payment already recorded instead of recording it twice.
--   * SEC-01: quotations and customer reminders kept every table right Supabase grants by default
--     (including TRUNCATE, which row rules do not stop). The app only reads them, through the
--     download; every change goes through server functions. Now: read only, like the other tables.

alter table public.subscription_payments add column if not exists intent_id uuid;
create unique index if not exists subscription_payments_intent on public.subscription_payments (shop_id, intent_id)
  where intent_id is not null;

create or replace function public.console_record_payment(p_shop uuid, p_payment jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare ext timestamptz := nullif(p_payment->>'extendedTo', '')::timestamptz; rec public.subscription_payments%rowtype;
  intent uuid;
begin
  perform private.require_console();
  if not exists (select 1 from public.shops where id = p_shop) then raise exception 'Business not found.'; end if;
  begin intent := nullif(p_payment->>'intentId', '')::uuid; exception when others then raise exception 'Invalid payment id.'; end;
  -- The same payment sent again: what was recorded, nothing new.
  if intent is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_shop::text || intent::text, 0));
    select * into rec from public.subscription_payments where shop_id = p_shop and intent_id = intent;
    if found then return jsonb_build_object('id', rec.id, 'receiptNo', rec.receipt_no, 'repeated', true); end if;
  end if;
  if ext is not null and ext <= now() then raise exception 'Extend to a date in the future.'; end if;
  insert into public.subscription_payments (shop_id, amount, paid_on, method, reference, extended_to, note, recorded_by, plan_name, intent_id)
  values (p_shop, (p_payment->>'amount')::bigint, (p_payment->>'paidOn')::date, btrim(coalesce(p_payment->>'method', '')),
    btrim(coalesce(p_payment->>'reference', '')), ext, btrim(coalesce(p_payment->>'note', '')), auth.uid(),
    coalesce((select p.name from public.subscriptions s join public.plans p on p.id = s.plan_id where s.shop_id = p_shop), ''), intent)
  returning * into rec;
  if ext is not null then
    insert into public.subscriptions as s (shop_id, status, expires_at, updated_by)
    values (p_shop, 'active', ext, auth.uid())
    on conflict (shop_id) do update set expires_at = ext, status = 'active', updated_by = auth.uid(), updated_at = now();
  end if;
  perform private.console_log(p_shop, 'subscription.payment', p_payment || jsonb_build_object('receiptNo', rec.receipt_no));
  return jsonb_build_object('id', rec.id, 'receiptNo', rec.receipt_no);
end $function$;

revoke all on public.quotations, public.customer_reminders from anon, authenticated;
grant select on public.quotations, public.customer_reminders to authenticated;
