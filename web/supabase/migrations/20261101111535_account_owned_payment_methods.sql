begin;
create or replace function private.prepare_owned_account(p_shop uuid,d jsonb)returns jsonb language plpgsql security definer set search_path=''as $f$
declare old jsonb;drafts jsonb;result jsonb='[]';m jsonb;prior jsonb;aliases jsonb;label text;method_name text;kind text;mid uuid;ids text[]='{}';names text[]='{}';labels jsonb;v text;
begin
 select data into old from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts'and id=(d->>'id')::uuid;
 drafts:=d->'paymentMethods';
 if drafts is null then
  if old?'paymentMethods'then
   if d?'methods'and d->'methods'is distinct from old->'methods'then raise exception 'Update the app and manage methods inside their account';end if;
   drafts:=old->'paymentMethods';
  else
   drafts:='[]';
   for v in select jsonb_array_elements_text(coalesce(d->'methods','[]'))loop
    select x->>'kind'into kind from public.business_settings b cross join lateral jsonb_array_elements(b.settings->'options'->'paymentMethods')x where b.shop_id=p_shop and x->>'label'=v limit 1;
    kind:=coalesce(kind,case d->>'accountType'when 'cash'then 'Cash'when 'pos'then 'POS'when 'bank'then 'Transfer'else 'Other'end);
    drafts:=drafts||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',case when jsonb_array_length(coalesce(d->'methods','[]'))>1 then left(v,40)when kind='POS'then 'Card'else kind end,'kind',kind,'enabled',true));
   end loop;
   if jsonb_array_length(drafts)=0 then kind:=case d->>'accountType'when 'cash'then 'Cash'when 'pos'then 'POS'when 'bank'then 'Transfer'else 'Other'end;drafts:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',case kind when 'POS'then 'Card'else kind end,'kind',kind,'enabled',true));end if;
  end if;
 end if;
 if jsonb_typeof(drafts)is distinct from 'array'or jsonb_array_length(drafts)not between 1 and 30 then raise exception 'Each account needs 1–30 methods';end if;
 for m in select value from jsonb_array_elements(drafts)loop
  mid:=(m->>'id')::uuid;method_name:=btrim(m->>'name');kind:=m->>'kind';
  if mid is null or mid::text=any(ids)or method_name is null or length(method_name)not between 1 and 40 or lower(method_name)=any(names)or coalesce(kind,'')not in('Cash','POS','Transfer','Other')or jsonb_typeof(m->'enabled')is distinct from 'boolean'then raise exception 'Choose a unique method name and Cash, Card, Transfer or Other';end if;
  ids:=array_append(ids,mid::text);names:=array_append(names,lower(method_name));
  select x into prior from jsonb_array_elements(coalesce(old->'paymentMethods','[]'))x where x->>'id'=mid::text;
  label:=case when prior is not null and jsonb_array_length(coalesce(old->'paymentMethods','[]'))=jsonb_array_length(drafts)and old->>'name'=btrim(d->>'name')and prior->>'name'=method_name then prior->>'label'when jsonb_array_length(drafts)=1 then btrim(d->>'name')else btrim(d->>'name')||' — '||method_name end;
  if length(label)>80 then label:=left(label,69)||' #'||left(mid::text,8);end if;
  aliases:=coalesce(prior->'aliases','[]');if prior is not null and prior->>'label'<>label and not aliases?(prior->>'label')then aliases:=aliases||jsonb_build_array(prior->>'label');end if;
  if jsonb_array_length(aliases)>80 then raise exception 'Too many saved aliases for this method';end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',mid,'name',method_name,'label',label,'kind',kind,'enabled',(m->>'enabled')::boolean,'aliases',aliases));
 end loop;
 if exists(select 1 from jsonb_array_elements(coalesce(old->'paymentMethods','[]'))x where not(x->>'id'=any(ids)))then raise exception 'Disable saved methods instead of deleting their history';end if;
 select coalesce(jsonb_agg(distinct to_jsonb(t.v)),'[]')into labels from(select x->>'label'v from jsonb_array_elements(result)x where(x->>'enabled')::boolean union all select a#>>'{}'from jsonb_array_elements(result)x cross join lateral jsonb_array_elements(x->'aliases')a where(x->>'enabled')::boolean)t;
 return d||jsonb_build_object('paymentMethods',result,'methods',labels);
end $f$;
revoke all on function private.prepare_owned_account(uuid,jsonb)from public,anon,authenticated;
do $import$
declare sid uuid;r record;m text;k text;methods jsonb;stamp timestamptz:=now();hid uuid;after_data jsonb;
begin
 for sid in select id from public.shops loop
  perform private.backfill_method_accounts(sid);
  for r in select * from public.business_operations_records where shop_id=sid and collection='moneyAccounts'and not data?'paymentMethods'for update loop
   methods:='[]';
   for m in select jsonb_array_elements_text(coalesce(r.data->'methods','[]'))loop
    select x->>'kind'into k from public.business_settings b cross join lateral jsonb_array_elements(b.settings->'options'->'paymentMethods')x where b.shop_id=sid and lower(btrim(x->>'label'))=lower(btrim(m))limit 1;
    if k is null then select kind into k from private.method_account_transactions(sid)where method=m limit 1;end if;
    k:=coalesce(k,case r.data->>'accountType'when 'cash'then 'Cash'when 'pos'then 'POS'when 'bank'then 'Transfer'else 'Other'end);
    methods:=methods||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',case when jsonb_array_length(r.data->'methods')>1 then left(m,40)when k='POS'then 'Card'else k end,'label',m,'kind',k,'enabled',true,'aliases','[]'::jsonb));
   end loop;
   if jsonb_array_length(methods)=0 then k:=case r.data->>'accountType'when 'cash'then 'Cash'when 'pos'then 'POS'when 'bank'then 'Transfer'else 'Other'end;methods:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name',case k when 'POS'then 'Card'else k end,'label',r.data->>'name','kind',k,'enabled',true,'aliases','[]'::jsonb));end if;
   after_data:=r.data||jsonb_build_object('paymentMethods',methods,'paymentMethodsVersion',1,'version',coalesce((r.data->>'version')::int,1)+1,'modifiedAt',stamp,'modifiedByLabel','Account method migration');
   update public.business_operations_records set data=after_data where shop_id=sid and collection='moneyAccounts'and id=r.id;
   hid:=gen_random_uuid();insert into public.business_operations_records(shop_id,collection,id,data)values(sid,'operationHistory',hid,jsonb_build_object('id',hid,'recordId',r.id,'action','account.methods_migrated','before',r.data,'after',after_data,'modifiedAt',stamp,'modifiedByLabel','Account method migration','reason','Methods now belong to their existing accounts; account IDs, opening balances and historical payments are preserved.'));
  end loop;
 end loop;
end $import$;
create or replace function private.resolve_owned_method(p_shop uuid,p_account text,p_label text,p_kind text,p_day date,p_personal boolean default false)returns uuid language plpgsql security definer set search_path=''as $f$
declare result uuid;matches int;
begin
 if p_personal and coalesce(p_account,'')=''then return null;end if;
 select count(*),min(r.id::text)::uuid into matches,result from public.business_operations_records r where shop_id=p_shop and collection='moneyAccounts'and not coalesce((data->>'archived')::boolean,false)and(coalesce(p_account,'')=''or r.id::text=p_account)and coalesce(data->>'branch','main')in('*',coalesce(private.request_branch(p_shop),'main'))and(data->>'openingDate')::date<=p_day and exists(select 1 from jsonb_array_elements(coalesce(data->'paymentMethods','[]'))m where(m->>'enabled')::boolean and m->>'kind'=p_kind and(m->>'label'=p_label or m->'aliases'?p_label));
 if matches<>1 then raise exception 'Choose an active account and one of its enabled payment methods. Account and method must match.'using errcode='PT409';end if;
 return result;
end $f$;
revoke all on function private.resolve_owned_method(uuid,text,text,text,date,boolean)from public,anon,authenticated;
create or replace function private.guard_owned_money_record()returns trigger language plpgsql security definer set search_path=''as $f$
declare aid uuid;p jsonb;previous jsonb;next_payments jsonb='[]';
begin
 if tg_table_name='checkout_records'then
  if coalesce((new.data->>'cashReceived')::bigint,0)>0 then
   aid:=private.resolve_owned_method(new.shop_id,new.data->>'accountId',coalesce(nullif(new.data->>'methodLabel',''),new.data->>'method'),new.data->>'method',(new.data->>'paidOn')::date);
   new.data:=jsonb_set(new.data,'{accountId}',to_jsonb(aid::text));
  end if;
 elsif tg_table_name='expenses'then
  for p in select value from jsonb_array_elements(coalesce(new.data->'payments','[]'))loop
   previous:=null;if tg_op='UPDATE'then select x into previous from jsonb_array_elements(coalesce(old.data->'payments','[]'))x where x->>'id'=p->>'id';end if;
   if coalesce((p->>'amount')::bigint,0)>0 and(previous is null or(previous->>'method',previous->>'methodLabel',previous->>'accountId',previous->>'paidOn',previous->>'source')is distinct from(p->>'method',p->>'methodLabel',p->>'accountId',p->>'paidOn',p->>'source'))then
    aid:=private.resolve_owned_method(new.shop_id,p->>'accountId',coalesce(nullif(p->>'methodLabel',''),p->>'method'),p->>'method',(p->>'paidOn')::date,p->>'source'='Personal funds');
    p:=jsonb_set(p,'{accountId}',to_jsonb(coalesce(aid::text,'')));
   end if;
   next_payments:=next_payments||jsonb_build_array(p);
  end loop;
  new.data:=jsonb_set(new.data,'{payments}',next_payments);
 elsif tg_table_name='sale_adjustments'and new.data->>'action'='sale.refunded'and coalesce((new.data->>'refundAmount')::bigint,0)>0 then
  aid:=private.resolve_owned_method(new.shop_id,new.data->>'accountId',coalesce(nullif(new.data->>'methodLabel',''),new.data->>'method'),new.data->>'method',(new.data->>'paidOn')::date);
  new.data:=jsonb_set(new.data,'{accountId}',to_jsonb(aid::text));
 end if;
 return new;
end $f$;
revoke all on function private.guard_owned_money_record()from public,anon,authenticated;
create trigger guard_owned_checkout before insert or update on public.checkout_records for each row execute function private.guard_owned_money_record();
create trigger guard_owned_expense before insert or update on public.expenses for each row execute function private.guard_owned_money_record();
create trigger guard_owned_refund before insert on public.sale_adjustments for each row execute function private.guard_owned_money_record();
create or replace function private.route_owned_payment()returns trigger language plpgsql security definer set search_path=''as $f$
declare aid uuid;checkout jsonb;label text;entry_id uuid;
begin
 if new.amount<=0 then return new;end if;
 if tg_op='UPDATE'and old.amount>0 and(new.method,new.method_label,new.paid_on)is not distinct from(old.method,old.method_label,old.paid_on)then return new;end if;
 select data into checkout from public.checkout_records where shop_id=new.shop_id and id=coalesce(new.checkout_id,new.id);
 label:=coalesce(nullif(new.method_label,''),nullif(checkout->>'methodLabel',''),new.method);
 aid:=private.resolve_owned_method(new.shop_id,case when tg_op='INSERT'then checkout->>'accountId'else null end,label,new.method,new.paid_on);
 if checkout is not null then
  update public.checkout_records set data=data||jsonb_build_object('accountId',aid,'method',new.method,'methodLabel',label)where shop_id=new.shop_id and id=coalesce(new.checkout_id,new.id);
 else
  select id into entry_id from public.business_operations_records where shop_id=new.shop_id and collection='accountEntries'and data->>'action'='assignment'and data->>'transactionId'='payment:'||new.id::text limit 1;
  entry_id:=coalesce(entry_id,gen_random_uuid());
  insert into public.business_operations_records(shop_id,collection,id,data)values(new.shop_id,'accountEntries',entry_id,jsonb_build_object('id',entry_id,'action','assignment','accountId',aid,'transactionId','payment:'||new.id::text,'paidOn',new.paid_on,'amount',0,'reason','Account routed from payment method','modifiedAt',now(),'modifiedByLabel','Automatic method routing'))on conflict(shop_id,collection,id)do update set data=excluded.data;
 end if;
 return new;
end $f$;
revoke all on function private.route_owned_payment()from public,anon,authenticated;
create trigger route_owned_payment after insert or update on public.payments for each row execute function private.route_owned_payment();
alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check check(method in('Cash','POS','Transfer','Other'));
do $patch$
declare src text;signature text;marker text;
begin
 foreach signature in array array['public.apply_checkout_event(uuid,jsonb)','private.apply_expense_event(uuid,jsonb)','private.apply_supervised_event_v1(uuid,jsonb)','private.apply_supervised_event_v2(uuid,jsonb)','private.check_business_options()']loop
  src:=pg_get_functiondef(signature::regprocedure);
  src:=replace(src,$m$('Cash','POS','Transfer')$m$,$m$('Cash','POS','Transfer','Other')$m$);
  if signature='private.check_business_options()'then
   src:=replace(src,E'begin\n',E'begin\n'||$m$
    if tg_op='UPDATE'and new.settings->'options'->'paymentMethods'is distinct from old.settings->'options'->'paymentMethods'and exists(select 1 from public.business_operations_records where shop_id=new.shop_id and collection='moneyAccounts'and data?'paymentMethods')then raise exception 'Manage payment methods inside Business Settings → Accounts & payment methods';end if;
$m$);
  end if;
  execute src;
 end loop;
 src:=pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
 marker:='audit:=jsonb_build_object';if strpos(src,marker)=0 then raise exception 'Operations audit marker changed';end if;
 src:=replace(src,marker,$m$if k in('account.created','account.updated')then d:=private.prepare_owned_account(p_shop,d);end if;
 audit:=jsonb_build_object$m$);
 marker:=$m$'methods',d->'methods','branch',private.account_branch(p_shop,d,old)$m$;if strpos(src,marker)=0 then raise exception 'Account branch marker changed';end if;
 src:=replace(src,marker,$m$'methods',d->'methods','paymentMethods',d->'paymentMethods','paymentMethodsVersion',1,'branch',private.account_branch(p_shop,d,old)$m$);
 src:=replace(src,$m$jsonb_array_length(d->'methods')>30$m$,$m$jsonb_array_length(d->'methods')>3000$m$);execute src;
end $patch$;
commit;
