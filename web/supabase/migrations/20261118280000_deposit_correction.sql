-- A deposit with no job can be corrected (plans/audit-1-review.md, AUD-12): a customer who paid
-- ahead and has no jobs yet. The correction is filed under the customer (sale_adjustments.job_id
-- empty). Lowering the amount takes it back off their credit, refused when that credit is spent.
-- Who may do it is the business's choice (Business Settings → Corrections,
-- corrections.depositCorrection): 'admin' (default, like any payment) or 'manager'.
alter table public.sale_adjustments alter column job_id drop not null;

create or replace function private.correct_deposit(p_shop uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare d jsonb := p_event->'data'; k text := p_event->>'kind'; e uuid := (p_event->>'id')::uuid; u uuid := auth.uid();
  label text; lvl integer; need integer; at_time timestamptz := clock_timestamp(); reason text := btrim(d->>'reason');
  existing jsonb; existing_actor uuid; cust uuid; p public.payments%rowtype; c public.checkout_records%rowtype;
  before_pay jsonb; after_pay jsonb; token jsonb; new_payment numeric; difference bigint; wallet bigint; move bigint;
  cash_delta bigint; methods jsonb; drawer_actor uuid; historical uuid; snap jsonb := '{"description":"Deposit with no job","amount":0}';
begin
  perform 1 from public.shops where id = p_shop for update;
  select name, access_level into label, lvl from public.shop_members
   where shop_id = p_shop and user_id = u and not archived and access_level >= 2 for share;
  if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action'; end if;
  need := case when (select settings->'corrections'->>'depositCorrection' from public.business_settings where shop_id = p_shop) = 'manager' then 3 else 2 end;
  if lvl < need then
    raise exception 'In this business only Managers and above correct a deposit with no job.' using errcode = '42501';
  end if;
  if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or reason is null
     or length(reason) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u then
    raise exception 'Invalid correction identity or reason';
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
  if exists (select 1 from public.jobs where shop_id = p_shop and customer_id = cust) then
    raise exception 'This customer has jobs now. Sync and reopen the correction.' using errcode = 'PT409';
  end if;
  if not private.account_token_ok(d->>'expectedAccount', p_shop, cust) then
    raise exception 'The customer account changed. Sync and reopen the correction.' using errcode = 'PT409';
  end if;
  select * into p from public.payments where shop_id = p_shop and id = (d->>'paymentId')::uuid and customer_id = cust for update;
  if not found or exists (select 1 from public.sale_adjustments where shop_id = p_shop and id = p.id and data->>'action' = 'sale.refunded') then
    raise exception 'Choose a payment for this customer';
  end if;
  before_pay := private.adjustment_payment(p_shop, p.id);
  token := before_pay - 'id' - 'customerId' - 'createdAt' - 'checkoutId';
  if d->'expectedPayment' is distinct from token then
    raise exception 'Payment changed. Sync and reopen the correction.' using errcode = 'PT409';
  end if;
  new_payment := (d->>'paymentAmount')::numeric;
  if new_payment is null or new_payment < 0 or new_payment > 100000000000 or new_payment <> trunc(new_payment)
     or coalesce(d->>'method', '') not in ('Cash', 'POS', 'Transfer', 'Other') or jsonb_typeof(d->'methodLabel') is distinct from 'string'
     or length(btrim(d->>'methodLabel')) not between 1 and 80 or jsonb_typeof(d->'reference') is distinct from 'string' or length(d->>'reference') > 500
     or (d ? 'paidOn' and (jsonb_typeof(d->'paidOn') is distinct from 'string' or d->>'paidOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then
    raise exception 'Enter valid payment details';
  end if;
  if d ? 'paidOn' and to_char((d->>'paidOn')::date, 'YYYY-MM-DD') <> d->>'paidOn' then raise exception 'Choose a valid payment date'; end if;
  if new_payment = p.amount and d->>'method' = p.method and d->>'methodLabel' = before_pay->>'methodLabel'
     and btrim(d->>'reference') = p.reference and coalesce(d->>'paidOn', p.paid_on::text) = p.paid_on::text then
    raise exception 'Nothing changed';
  end if;
  difference := new_payment::bigint - p.amount;
  if difference > 0 then
    update public.payments set wallet_added = wallet_added + difference where shop_id = p_shop and id = p.id;
  elsif difference < 0 then
    select coalesce(sum(wallet_added - wallet_used), 0) into wallet from public.payments where shop_id = p_shop and customer_id = cust;
    move := least(-difference, p.wallet_added, greatest(0, wallet));
    if move < -difference then raise exception 'This payment credit has already been spent. Correct the dependent payments first.'; end if;
    update public.payments set wallet_added = wallet_added - move where shop_id = p_shop and id = p.id;
  end if;
  update public.payments set amount = new_payment::bigint, method = d->>'method', method_label = d->>'methodLabel',
    reference = btrim(d->>'reference'), paid_on = coalesce((d->>'paidOn')::date, paid_on) where shop_id = p_shop and id = p.id;
  select * into c from public.checkout_records where shop_id = p_shop and id = coalesce(p.checkout_id, p.id);
  if found then historical := c.drawer_closing_id; if historical is null then drawer_actor := (c.data->>'createdBy')::uuid; end if; end if;
  cash_delta := (case when d->>'method' = 'Cash' then new_payment::bigint else 0 end) - (case when p.method = 'Cash' then p.amount else 0 end);
  methods := jsonb_build_object('Cash', cash_delta,
    'POS', (case when d->>'method' = 'POS' then new_payment::bigint else 0 end) - (case when p.method = 'POS' then p.amount else 0 end),
    'Transfer', (case when d->>'method' = 'Transfer' then new_payment::bigint else 0 end) - (case when p.method = 'Transfer' then p.amount else 0 end));
  insert into public.ledger_events (shop_id, id, actor_id, payload) values (p_shop, e, u, p_event);
  after_pay := private.adjustment_payment(p_shop, p.id);
  insert into public.sale_adjustments (shop_id, id, job_id, actor_id, created_at, data) values (p_shop, e, null, u, at_time,
    jsonb_build_object('id', e, 'jobId', null, 'customerId', cust, 'action', k, 'reason', reason, 'changedBy', u, 'changedByLabel', label,
      'changedAt', at_time, 'before', snap, 'after', snap, 'creditReleased', 0, 'refundAmount', 0, 'returnQuantity', 0,
      'paymentChanges', jsonb_build_array(jsonb_build_object('before', before_pay, 'after', after_pay)), 'stockChanges', '[]'::jsonb,
      'cashDelta', cash_delta, 'methodDeltas', methods, 'drawerActor', drawer_actor, 'historicalClosingId', historical,
      'paymentId', p.id, 'affectedJobIds', '[]'::jsonb, 'event', p_event));
  return public.get_ledger(p_shop);
end $f$;
revoke all on function private.correct_deposit(uuid, jsonb) from public, anon, authenticated;

-- Payment corrections without a job go to the deposit correction.
do $m$
declare f regprocedure := 'private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure; d text := pg_get_functiondef(f);
  t text := $x$ if k not in ('sale.details_corrected','payment.corrected') then return private.apply_supervised_event_v1(p_shop,p_event);end if;$x$;
begin
  if position('private.correct_deposit' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'apply_supervised_event_v2: pattern not found'; end if;
  execute replace(d, t, t || $x$
 if k='payment.corrected' and coalesce(d->>'jobId','')='' then return private.correct_deposit(p_shop,p_event);end if;$x$);
end $m$;
