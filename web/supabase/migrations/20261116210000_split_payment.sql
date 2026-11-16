-- Split payment: one sale paid with more than one method at the same moment (₦5,000 cash +
-- ₦20,000 transfer). The checkout keeps `splits` (2–6 parts: id, method, methodLabel, accountId,
-- amount) adding up to the money received; the first part's id is the checkout's id and its method is
-- the checkout's method. Each part is its own payment (same checkout id and time), so drawers, money
-- accounts and reports by method place each part where it belongs. Jobs are paid in order: the first
-- part (with any wallet credit used) pays the first jobs, and so on; money a part doesn't need is that
-- part's wallet top-up. Older single-method checkouts are unchanged.
-- Also: the "collected later" walk-in check now looks for a digit with [0-9].

-- How much of a checkout was paid by a method kind (Cash, POS, Transfer, Other).
create or replace function private.checkout_method_amount(p_data jsonb, p_method text)
returns bigint language sql immutable set search_path to '' as $$
  select case when jsonb_typeof(p_data->'splits') = 'array'
    then coalesce((select sum((s->>'amount')::bigint) from jsonb_array_elements(p_data->'splits') s where s->>'method' = p_method), 0)
    else case when p_data->>'method' = p_method then coalesce((p_data->>'cashReceived')::bigint, 0) else 0 end
  end
$$;

-- The payments of a split checkout: one per part, with the allocations poured into the parts in order.
create or replace function private.insert_split_payments(p_shop uuid, p_checkout uuid, p_customer uuid, d jsonb, p_wallet_used bigint)
returns void language plpgsql security definer set search_path to '' as $$
declare
  jids uuid[]; amts bigint[]; i integer := 1; part record; room bigint; n bigint; pid uuid; added bigint := 0;
  pours jsonb;
begin
  select coalesce(array_agg((a->>'jobId')::uuid order by o), '{}'), coalesce(array_agg((a->>'amount')::bigint order by o), '{}')
    into jids, amts from jsonb_array_elements(d->'allocations') with ordinality t(a, o);
  for part in select value v, ordinality o from jsonb_array_elements(d->'splits') with ordinality loop
    pid := (part.v->>'id')::uuid;
    room := (part.v->>'amount')::bigint + case when part.o = 1 then p_wallet_used else 0 end;
    pours := '[]'::jsonb;
    while room > 0 and i <= coalesce(array_length(jids, 1), 0) loop
      n := least(room, amts[i]);
      pours := pours || jsonb_build_array(jsonb_build_object('jobId', jids[i], 'amount', n));
      amts[i] := amts[i] - n; room := room - n;
      if amts[i] = 0 then i := i + 1; end if;
    end loop;
    insert into public.payments(shop_id, id, customer_id, amount, method, method_label, paid_on, reference, created_at, wallet_used, wallet_added, checkout_id)
      values (p_shop, pid, p_customer, (part.v->>'amount')::bigint, part.v->>'method', btrim(part.v->>'methodLabel'), (d->>'paidOn')::date,
        coalesce(d->>'reference', ''), (d->>'createdAt')::timestamptz, case when part.o = 1 then p_wallet_used else 0 end, room, p_checkout);
    insert into public.payment_allocations(shop_id, payment_id, job_id, amount)
      select p_shop, pid, (x->>'jobId')::uuid, sum((x->>'amount')::bigint) from jsonb_array_elements(pours) x group by x->>'jobId';
    added := added + room;
  end loop;
  if i <= coalesce(array_length(jids, 1), 0) or added is distinct from (d->>'walletAdded')::bigint then
    raise exception 'Checkout balances do not match';
  end if;
end $$;
revoke all on function private.insert_split_payments(uuid, uuid, uuid, jsonb, bigint) from public, anon, authenticated;

do $migration$
declare
  def text := pg_get_functiondef('public.apply_checkout_event'::regproc);
  t text; r text; cnt integer;
begin
  if position('insert_split_payments' in def) > 0 then
    raise notice 'apply_checkout_event already takes split payments';
    return;
  end if;

  -- 1. Check the split before anything is saved.
  t := $t$ perform (d->>'paidOn')::date;perform (d->>'createdAt')::timestamptz;$t$;
  r := t || $r$
 if d ? 'splits' then
  if jsonb_typeof(d->'splits') is distinct from 'array' or jsonb_array_length(d->'splits') not between 2 and 6 then raise exception 'Invalid split payment';end if;
  if exists(select 1 from jsonb_array_elements(d->'splits') s where jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'amount') is distinct from 'number' or (s->>'amount')::numeric<=0 or (s->>'amount')::numeric<>trunc((s->>'amount')::numeric) or (s->>'amount')::numeric>100000000000 or coalesce(s->>'method','') not in ('Cash','POS','Transfer','Other') or jsonb_typeof(s->'methodLabel') is distinct from 'string' or length(btrim(s->>'methodLabel')) not between 1 and 80 or s->>'methodLabel' ~ '[[:cntrl:]]' or coalesce(s->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (s ? 'accountId' and jsonb_typeof(s->'accountId') is distinct from 'string')) then raise exception 'Invalid split payment';end if;
  if (select count(distinct lower(btrim(s->>'methodLabel'))) from jsonb_array_elements(d->'splits') s)<>jsonb_array_length(d->'splits') or (select count(distinct lower(s->>'id')) from jsonb_array_elements(d->'splits') s)<>jsonb_array_length(d->'splits') then raise exception 'Invalid split payment';end if;
  if (d->'splits'->0->>'id')::uuid is distinct from e or d->'splits'->0->>'method' is distinct from d->>'method' or btrim(d->'splits'->0->>'methodLabel') is distinct from btrim(coalesce(d->>'methodLabel',d->>'method')) then raise exception 'Invalid split payment';end if;
  if (select sum((s->>'amount')::numeric) from jsonb_array_elements(d->'splits') s) is distinct from cash then raise exception 'The split parts must add up to the money received';end if;
  if exists(select 1 from jsonb_array_elements(d->'splits') s join public.payments p on p.shop_id=p_shop and p.id=(s->>'id')::uuid) then raise exception 'Operation ID already used';end if;
  if exists(select 1 from jsonb_array_elements(d->'splits') s where nullif(s->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id::text=s->>'accountId' and not (data->>'archived')::boolean and not coalesce((data->>'hidden')::boolean,false) and (d->>'paidOn')::date>=(data->>'openingDate')::date)) then raise exception 'Choose an active payment account with a valid opening date';end if;
 end if;$r$;
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 1 then raise exception 'apply_checkout_event: split check place found % times', cnt; end if;
  def := replace(def, t, r);

  -- 2. One payment per part.
  -- (one line only: the SQL editor may send Windows line endings)
  t := $t$ if cash>0 or wu>0 then$t$;
  r := $r$ if d ? 'splits' then perform private.insert_split_payments(p_shop,e,c,d,wu::bigint); elsif cash>0 or wu>0 then$r$;
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 1 then raise exception 'apply_checkout_event: payment insert found % times', cnt; end if;
  def := replace(def, t, r);

  -- 3. "Paid this checkout" counts every part.
  t := 'pa.payment_id<>e';
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 1 then raise exception 'apply_checkout_event: paid before found % times', cnt; end if;
  def := replace(def, t, 'pa.payment_id not in (select x.id from public.payments x where x.shop_id=p_shop and (x.id=e or x.checkout_id=e))');
  t := 'pa.payment_id=e';
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 2 then raise exception 'apply_checkout_event: paid this checkout found % times', cnt; end if;
  def := replace(def, t, 'pa.payment_id in (select x.id from public.payments x where x.shop_id=p_shop and (x.id=e or x.checkout_id=e))');

  -- 4. The walk-in check looks for a digit.
  t := $t$phone !~ '\\d'$t$;
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt = 1 then def := replace(def, t, $r$phone !~ '[0-9]'$r$); end if;

  execute def;
end $migration$;

-- Drawers: cash, POS and transfer from each part of a split sale.
do $migration$
declare
  f record; def text; fixed text; cnt integer; done integer := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname in ('finish_drawer_handover', 'auto_close_drawer') loop
    def := pg_get_functiondef(f.oid);
    fixed := regexp_replace(def,
      $p$sum\(\(data->>'cashReceived'\)::bigint\)\s*filter\s*\(\s*where\s+data->>'method'\s*=\s*'(Cash|POS|Transfer)'\s*\)$p$,
      $r$sum(private.checkout_method_amount(data,'\1'))$r$, 'g');
    if fixed = def then continue; end if;
    cnt := (length(fixed) - length(replace(fixed, 'private.checkout_method_amount(', ''))) / length('private.checkout_method_amount(');
    if cnt <> 3 then raise exception 'Drawer totals: % places changed in %', cnt, f.oid::regprocedure; end if;
    execute fixed;
    done := done + 1;
  end loop;
  if done = 0 then raise notice 'Drawer totals already read split payments'; end if;
end $migration$;

-- Money accounts: each part of a split sale goes to its own account.
create or replace function private.method_account_transactions(p_shop uuid)
 returns table(transaction_id text, paid_on date, method text, kind text, account_id text, personal boolean)
 language sql stable set search_path to ''
as $function$
 select 'payment:'||p.id,p.paid_on,coalesce(nullif(p.method_label,''),nullif(c.data->>'methodLabel',''),p.method),p.method,
  case when jsonb_typeof(c.data->'splits')='array'
   then nullif((select s->>'accountId' from jsonb_array_elements(c.data->'splits') s where s->>'id'=p.id::text limit 1),'')
   else nullif(c.data->>'accountId','') end,false
 from public.payments p left join public.checkout_records c on c.shop_id=p.shop_id and c.id=coalesce(p.checkout_id,p.id)
 where p.shop_id=p_shop and p.amount>0
 union all
 select 'expense:'||(p->>'id'),(p->>'paidOn')::date,coalesce(nullif(p->>'methodLabel',''),p->>'method'),p->>'method',nullif(p->>'accountId',''),p->>'source'='Personal funds'
 from public.expenses e cross join lateral jsonb_array_elements(e.data->'payments') p where e.shop_id=p_shop and (p->>'amount')::bigint>0
 union all
 select 'refund:'||a.id,coalesce((a.data->>'paidOn')::date,(a.created_at at time zone 'Africa/Lagos')::date),coalesce(nullif(a.data->>'methodLabel',''),a.data->>'method'),a.data->>'method',nullif(a.data->>'accountId',''),false
 from public.sale_adjustments a where a.shop_id=p_shop and a.data->>'action'='sale.refunded' and (a.data->>'refundAmount')::bigint>0
$function$;

-- A split sale's parts each find their account (as a single-method sale does).
create or replace function private.guard_owned_money_record()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare aid uuid;p jsonb;previous jsonb;next_payments jsonb='[]';next_splits jsonb='[]';
begin
 if tg_table_name='checkout_records'then
  if coalesce((new.data->>'cashReceived')::bigint,0)>0 and (tg_op='INSERT' or (new.data->>'cashReceived',new.data->>'method',new.data->>'methodLabel',new.data->>'accountId',new.data->>'paidOn')
      is distinct from (old.data->>'cashReceived',old.data->>'method',old.data->>'methodLabel',old.data->>'accountId',old.data->>'paidOn')) then
   aid:=private.resolve_owned_method(new.shop_id,new.data->>'accountId',coalesce(nullif(new.data->>'methodLabel',''),new.data->>'method'),new.data->>'method',(new.data->>'paidOn')::date,false,new.branch_id);
   if aid is not null then new.data:=jsonb_set(new.data,'{accountId}',to_jsonb(aid::text));end if;
  end if;
  if jsonb_typeof(new.data->'splits')='array' and (tg_op='INSERT' or new.data->'splits' is distinct from old.data->'splits' or new.data->>'paidOn' is distinct from old.data->>'paidOn') then
   for p in select value from jsonb_array_elements(new.data->'splits') loop
    aid:=private.resolve_owned_method(new.shop_id,p->>'accountId',coalesce(nullif(p->>'methodLabel',''),p->>'method'),p->>'method',(new.data->>'paidOn')::date,false,new.branch_id);
    if aid is not null then p:=jsonb_set(p,'{accountId}',to_jsonb(aid::text));end if;
    next_splits:=next_splits||jsonb_build_array(p);
   end loop;
   new.data:=jsonb_set(new.data,'{splits}',next_splits);
  end if;
 elsif tg_table_name='expenses'then
  for p in select value from jsonb_array_elements(coalesce(new.data->'payments','[]'))loop
   previous:=null;if tg_op='UPDATE'then select x into previous from jsonb_array_elements(coalesce(old.data->'payments','[]'))x where x->>'id'=p->>'id';end if;
   if coalesce((p->>'amount')::bigint,0)>0 and(previous is null or(previous->>'method',previous->>'methodLabel',previous->>'accountId',previous->>'paidOn',previous->>'source')is distinct from(p->>'method',p->>'methodLabel',p->>'accountId',p->>'paidOn',p->>'source'))then
    aid:=private.resolve_owned_method(new.shop_id,p->>'accountId',coalesce(nullif(p->>'methodLabel',''),p->>'method'),p->>'method',(p->>'paidOn')::date,p->>'source'='Personal funds',new.branch_id);
    p:=jsonb_set(p,'{accountId}',to_jsonb(coalesce(aid::text,'')));
   end if;
   next_payments:=next_payments||jsonb_build_array(p);
  end loop;
  new.data:=jsonb_set(new.data,'{payments}',next_payments);
 elsif tg_table_name='sale_adjustments'and new.data->>'action'='sale.refunded'and coalesce((new.data->>'refundAmount')::bigint,0)>0 then
  aid:=private.resolve_owned_method(new.shop_id,new.data->>'accountId',coalesce(nullif(new.data->>'methodLabel',''),new.data->>'method'),new.data->>'method',(new.data->>'paidOn')::date,false,new.branch_id);
  if aid is not null then new.data:=jsonb_set(new.data,'{accountId}',to_jsonb(aid::text));end if;
 end if;
 return new;
end $function$;
