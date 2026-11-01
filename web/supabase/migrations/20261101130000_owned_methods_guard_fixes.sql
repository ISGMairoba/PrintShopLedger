-- Account-owned payment methods: two fixes to the server checks (20261101111535).
-- * A sale is checked against its account and method only when its payment changes (as expenses
--   already were), so editing an old sale still works after its account is archived or its method
--   disabled.
-- * The check uses the record's own branch rather than the branch of the device making the change,
--   so the General Manager can correct another branch's sale from any device.
-- * A business that has not set up any money accounts yet (every new business) keeps taking
--   payments with its payment methods as before; the money waits unassigned until accounts exist.
begin;
drop function if exists private.resolve_owned_method(uuid,text,text,text,date,boolean);
create or replace function private.resolve_owned_method(p_shop uuid,p_account text,p_label text,p_kind text,p_day date,p_personal boolean default false,p_branch text default null)returns uuid language plpgsql security definer set search_path=''as $f$
declare result uuid;matches int;
begin
 if p_personal and coalesce(p_account,'')=''then return null;end if;
 if not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts')then return null;end if;
 select count(*),min(r.id::text)::uuid into matches,result from public.business_operations_records r where shop_id=p_shop and collection='moneyAccounts'and not coalesce((data->>'archived')::boolean,false)and(coalesce(p_account,'')=''or r.id::text=p_account)and coalesce(data->>'branch','main')in('*',coalesce(p_branch,private.request_branch(p_shop),'main'))and(data->>'openingDate')::date<=p_day and exists(select 1 from jsonb_array_elements(coalesce(data->'paymentMethods','[]'))m where(m->>'enabled')::boolean and m->>'kind'=p_kind and(m->>'label'=p_label or m->'aliases'?p_label));
 if matches<>1 then raise exception 'Choose an active account and one of its enabled payment methods. Account and method must match.'using errcode='PT409';end if;
 return result;
end $f$;
revoke all on function private.resolve_owned_method(uuid,text,text,text,date,boolean,text) from public,anon,authenticated;
create or replace function private.guard_owned_money_record()returns trigger language plpgsql security definer set search_path=''as $f$
declare aid uuid;p jsonb;previous jsonb;next_payments jsonb='[]';
begin
 if tg_table_name='checkout_records'then
  if coalesce((new.data->>'cashReceived')::bigint,0)>0 and (tg_op='INSERT' or (new.data->>'cashReceived',new.data->>'method',new.data->>'methodLabel',new.data->>'accountId',new.data->>'paidOn')
      is distinct from (old.data->>'cashReceived',old.data->>'method',old.data->>'methodLabel',old.data->>'accountId',old.data->>'paidOn')) then
   aid:=private.resolve_owned_method(new.shop_id,new.data->>'accountId',coalesce(nullif(new.data->>'methodLabel',''),new.data->>'method'),new.data->>'method',(new.data->>'paidOn')::date,false,new.branch_id);
   if aid is not null then new.data:=jsonb_set(new.data,'{accountId}',to_jsonb(aid::text));end if;
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
end $f$;
create or replace function private.route_owned_payment()returns trigger language plpgsql security definer set search_path=''as $f$
declare aid uuid;checkout jsonb;label text;entry_id uuid;
begin
 if new.amount<=0 then return new;end if;
 if tg_op='UPDATE'and old.amount>0 and(new.method,new.method_label,new.paid_on)is not distinct from(old.method,old.method_label,old.paid_on)then return new;end if;
 select data into checkout from public.checkout_records where shop_id=new.shop_id and id=coalesce(new.checkout_id,new.id);
 label:=coalesce(nullif(new.method_label,''),nullif(checkout->>'methodLabel',''),new.method);
 aid:=private.resolve_owned_method(new.shop_id,case when tg_op='INSERT'then checkout->>'accountId'else null end,label,new.method,new.paid_on,false,new.branch_id);
 if aid is null then return new;end if;
 if checkout is not null then
  update public.checkout_records set data=data||jsonb_build_object('accountId',aid,'method',new.method,'methodLabel',label)where shop_id=new.shop_id and id=coalesce(new.checkout_id,new.id);
 else
  select id into entry_id from public.business_operations_records where shop_id=new.shop_id and collection='accountEntries'and data->>'action'='assignment'and data->>'transactionId'='payment:'||new.id::text limit 1;
  entry_id:=coalesce(entry_id,gen_random_uuid());
  insert into public.business_operations_records(shop_id,collection,id,data)values(new.shop_id,'accountEntries',entry_id,jsonb_build_object('id',entry_id,'action','assignment','accountId',aid,'transactionId','payment:'||new.id::text,'paidOn',new.paid_on,'amount',0,'reason','Account routed from payment method','modifiedAt',now(),'modifiedByLabel','Automatic method routing'))on conflict(shop_id,collection,id)do update set data=excluded.data;
 end if;
 return new;
end $f$;
commit;
