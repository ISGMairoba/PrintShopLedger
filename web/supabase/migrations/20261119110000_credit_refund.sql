-- Refund a customer's unused credit (audit AUD-12, decided 19 Nov): money a customer paid ahead (a
-- deposit with no job, or credit left after a job was reduced) given back, as a refund, not as a
-- "correction". It is a sale.refunded with no job: filed under the customer (sale_adjustments.job_id
-- empty), paid out of the customer's credit (a payment line of 0 using that credit, like any refund),
-- counted in the drawer when paid in cash and in the chosen account. Who may do it: the same ranks
-- as correcting a deposit (Business Settings → Corrections, corrections.depositCorrection).
create or replace function private.refund_credit(p_shop uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; u uuid := auth.uid(); label text; lvl integer; need integer;
  at_time timestamptz := clock_timestamp(); reason text := btrim(d->>'reason'); existing jsonb; existing_actor uuid; cust uuid;
  requested numeric; wallet bigint; day date; account uuid; snap jsonb := '{"description":"Customer credit","amount":0}';
begin
  perform 1 from public.shops where id = p_shop for update;
  select name, access_level into label, lvl from public.shop_members
   where shop_id = p_shop and user_id = u and not archived and access_level >= 2 for share;
  if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action'; end if;
  need := case when (private.branch_settings(p_shop, private.request_branch(p_shop))->'corrections'->>'depositCorrection') = 'manager' then 3 else 2 end;
  if lvl < need then raise exception 'In this business only Managers and above refund customer credit.' using errcode = '42501'; end if;
  if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or reason is null
     or length(reason) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u then
    raise exception 'Invalid refund identity or reason';
  end if;
  select payload, actor_id into existing, existing_actor from public.ledger_events where shop_id = p_shop and id = e;
  if existing is not null then
    if existing <> p_event or existing_actor is distinct from u then raise exception 'Adjustment ID is already used'; end if;
    return public.get_ledger(p_shop);
  end if;
  if coalesce(d->>'customerId', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Customer not found'; end if;
  cust := (d->>'customerId')::uuid;
  perform 1 from public.customers where shop_id = p_shop and id = cust for update;
  if not found then raise exception 'Customer not found'; end if;
  if not private.account_token_ok(d->>'expectedAccount', p_shop, cust) then
    raise exception 'The customer account changed. Sync and reopen the refund.' using errcode = 'PT409';
  end if;
  requested := (d->>'refundAmount')::numeric;
  select coalesce(sum(wallet_added - wallet_used), 0) into wallet from public.payments where shop_id = p_shop and customer_id = cust;
  if requested is null or requested <= 0 or requested > 100000000000 or requested <> trunc(requested) then raise exception 'Enter the amount to refund'; end if;
  if requested > wallet then raise exception 'The refund is more than the customer''s credit.'; end if;
  if coalesce(d->>'method', '') not in ('Cash', 'POS', 'Transfer', 'Other') or jsonb_typeof(d->'methodLabel') is distinct from 'string'
     or length(btrim(d->>'methodLabel')) not between 1 and 80 then
    raise exception 'Choose a refund payment method';
  end if;
  day := (d->>'paidOn')::date;
  if day is null or day <> (at_time at time zone 'Africa/Lagos')::date then raise exception 'Refunds must be recorded on the day money is returned'; end if;
  if coalesce(d->>'accountId', '') ~* '^[0-9a-f-]{36}$' and exists (select 1 from public.business_operations_records
       where shop_id = p_shop and collection = 'moneyAccounts' and id = (d->>'accountId')::uuid and not coalesce((data->>'archived')::boolean, false)) then
    account := (d->>'accountId')::uuid;
  end if;
  insert into public.ledger_events (shop_id, id, actor_id, payload) values (p_shop, e, u, p_event);
  insert into public.payments (shop_id, id, customer_id, amount, method, method_label, paid_on, reference, created_at, wallet_used, wallet_added)
    values (p_shop, e, cust, 0, d->>'method', btrim(d->>'methodLabel'), day, 'Refund ' || upper(left(e::text, 8)), at_time, requested::bigint, 0);
  insert into public.sale_adjustments (shop_id, id, job_id, actor_id, created_at, data) values (p_shop, e, null, u, at_time,
    jsonb_build_object('id', e, 'jobId', null, 'customerId', cust, 'action', 'sale.refunded', 'reason', reason, 'changedBy', u,
      'changedByLabel', label, 'changedAt', at_time, 'before', snap, 'after', snap, 'creditReleased', 0, 'refundAmount', requested::bigint,
      'method', d->>'method', 'methodLabel', btrim(d->>'methodLabel'), 'paidOn', day, 'returnQuantity', 0, 'stockChanges', '[]'::jsonb,
      'paymentChanges', '[]'::jsonb, 'affectedJobIds', '[]'::jsonb, 'event', p_event)
      || case when account is not null then jsonb_build_object('accountId', account) else '{}'::jsonb end);
  return public.get_ledger(p_shop);
end $f$;
revoke all on function private.refund_credit(uuid, jsonb) from public, anon, authenticated;

-- A refund with no job goes to the credit refund (before the job refund, which needs a job).
do $m$
declare d text := replace(pg_get_functiondef('private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure), E'\r', '');
  t text := $x$ if k not in ('sale.details_corrected','payment.corrected') then return private.apply_supervised_event_v1(p_shop,p_event);end if;$x$;
begin
  if position('private.refund_credit' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'apply_supervised_event_v2: pattern not found'; end if;
  execute replace(d, t, $x$ if k='sale.refunded' and coalesce(d->>'jobId','')='' then return private.refund_credit(p_shop,p_event);end if;
$x$ || t);
end $m$;
