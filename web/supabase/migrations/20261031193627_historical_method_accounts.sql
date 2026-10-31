begin;
-- Read immutable method labels from the actual movements, never from a renamed current option.
create function private.method_account_transactions(p_shop uuid)
returns table(transaction_id text,paid_on date,method text,kind text,account_id text,personal boolean)
language sql stable security invoker set search_path='' as $f$
 select 'payment:'||p.id,p.paid_on,coalesce(nullif(p.method_label,''),nullif(c.data->>'methodLabel',''),p.method),p.method,nullif(c.data->>'accountId',''),false
 from public.payments p left join public.checkout_records c on c.shop_id=p.shop_id and c.id=coalesce(p.checkout_id,p.id)
 where p.shop_id=p_shop and p.amount>0
 union all
 select 'expense:'||(p->>'id'),(p->>'paidOn')::date,coalesce(nullif(p->>'methodLabel',''),p->>'method'),p->>'method',nullif(p->>'accountId',''),p->>'source'='Personal funds'
 from public.expenses e cross join lateral jsonb_array_elements(e.data->'payments') p where e.shop_id=p_shop and (p->>'amount')::bigint>0
 union all
 select 'refund:'||a.id,coalesce((a.data->>'paidOn')::date,(a.created_at at time zone 'Africa/Lagos')::date),coalesce(nullif(a.data->>'methodLabel',''),a.data->>'method'),a.data->>'method',nullif(a.data->>'accountId',''),false
 from public.sale_adjustments a where a.shop_id=p_shop and a.data->>'action'='sale.refunded' and (a.data->>'refundAmount')::bigint>0
$f$;
revoke all on function private.method_account_transactions(uuid) from public,anon,authenticated;

-- One-time import, kept private for rollback-only regression fixtures. Re-running is harmless.
create function private.backfill_method_accounts(p_shop uuid) returns jsonb
language plpgsql security invoker set search_path='' as $f$
declare m record;t record;aid uuid;rid uuid;on_day date;name text;account_data jsonb;entry jsonb;created integer:=0;assigned integer:=0;stamp timestamptz:=now();
begin
 perform 1 from public.shops where id=p_shop for update;
 for m in
  with methods as (
   select btrim(value->>'label') label,value->>'kind' kind from public.business_settings b cross join lateral jsonb_array_elements(coalesce(b.settings->'options'->'paymentMethods','[{"label":"Cash","kind":"Cash"},{"label":"POS","kind":"POS"},{"label":"Transfer","kind":"Transfer"}]'::jsonb)) where b.shop_id=p_shop
   union all select btrim(method),kind from private.method_account_transactions(p_shop)
  ) select min(label) label,min(kind) kind from methods where length(label) between 1 and 80 group by lower(label) order by lower(min(label))
 loop
  select r.id into aid from public.business_operations_records r where shop_id=p_shop and collection='moneyAccounts' and not coalesce((data->>'archived')::boolean,false) and exists(select 1 from jsonb_array_elements_text(data->'methods') x where lower(btrim(x))=lower(m.label)) order by r.id limit 1;
  if aid is null then
   aid:=gen_random_uuid();name:=m.label;
   while exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and not coalesce((data->>'archived')::boolean,false) and lower(btrim(data->>'name'))=lower(name)) loop name:=left(m.label,80)||' (method '||left(gen_random_uuid()::text,8)||')';end loop;
   select coalesce(min(paid_on),(stamp at time zone 'Africa/Lagos')::date) into on_day from private.method_account_transactions(p_shop) where lower(btrim(method))=lower(m.label) and not coalesce(personal,false);
   account_data:=jsonb_build_object('id',aid,'name',name,'accountType',case m.kind when 'Cash' then 'cash' when 'POS' then 'pos' when 'Transfer' then 'bank' else 'other' end,'methods',jsonb_build_array(m.label),'openingDate',on_day,'openingBalance',0,'importedFromPaymentMethod',true,'archived',false,'version',1,'createdAt',stamp,'modifiedAt',stamp,'createdByLabel','Payment-method import','modifiedByLabel','Payment-method import');
   insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'moneyAccounts',aid,account_data);
   rid:=gen_random_uuid();insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'operationHistory',rid,jsonb_build_object('id',rid,'recordId',aid,'action','account.imported_from_method','after',account_data,'modifiedAt',stamp,'modifiedByLabel','Payment-method import','reason','Existing payment method imported as an account; zero baseline before recorded movements. Reconcile to actual balance.'));
   created:=created+1;
  end if;
  for t in select * from private.method_account_transactions(p_shop) where lower(btrim(method))=lower(m.label) and account_id is null and not coalesce(personal,false) loop
   if exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and data->>'action'='assignment' and data->>'transactionId'=t.transaction_id) then continue;end if;
   rid:=gen_random_uuid();entry:=jsonb_build_object('id',rid,'action','assignment','accountId',aid,'transactionId',t.transaction_id,'paidOn',t.paid_on,'amount',0,'reason','Historical payment mapped from its recorded method: '||m.label,'importedFromPaymentMethod',true,'modifiedAt',stamp,'modifiedByLabel','Payment-method import');
   insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'accountEntries',rid,entry);
   assigned:=assigned+1;
  end loop;
 end loop;
 return jsonb_build_object('accountsCreated',created,'transactionsAssigned',assigned);
end $f$;
revoke all on function private.backfill_method_accounts(uuid) from public,anon,authenticated;
do $import$
declare sid uuid;
begin
 for sid in select id from public.shops loop perform private.backfill_method_accounts(sid);end loop;
end $import$;

-- Staff may operate accounts; only Developers may create them or change method links.
do $patch$
declare src text;marker text;
begin
 src:=pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
 marker:=$m$ audit:=jsonb_build_object$m$;
 if strpos(src,marker)=0 then raise exception 'Operations permission marker changed';end if;
 src:=replace(src,marker,$m$ if k in ('account.created','account.updated') and lvl<>4 then raise exception 'Only a Developer can create accounts or change payment-method links' using errcode='42501';end if;
 audit:=jsonb_build_object$m$);
 execute src;
end $patch$;
commit;
