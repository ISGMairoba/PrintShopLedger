begin;
create table public.business_operations_records (
 shop_id uuid not null references public.shops(id), collection text not null check(collection in ('payees','moneyAccounts','accountEntries','operationHistory')), id uuid not null,
 data jsonb not null check(jsonb_typeof(data)='object'), sync_xid xid8 not null default pg_current_xact_id(), primary key(shop_id,collection,id)
);
alter table public.business_operations_records enable row level security;
revoke all on public.business_operations_records from public,anon,authenticated;
grant select on public.business_operations_records to authenticated;
create policy member_read on public.business_operations_records for select to authenticated using(public.is_shop_member(shop_id));
create index business_operations_names on public.business_operations_records(shop_id,collection,lower(data->>'name')) where collection in ('payees','moneyAccounts');
create unique index business_operations_unique_name on public.business_operations_records(shop_id,collection,lower(btrim(data->>'name'))) where collection in ('payees','moneyAccounts') and not coalesce((data->>'archived')::boolean,false);
create unique index business_operations_transaction_assignment on public.business_operations_records(shop_id,(data->>'transactionId')) where collection='accountEntries' and data->>'action'='assignment';
create trigger touch_sync_xid before insert or update on public.business_operations_records for each row execute function private.touch_sync_xid();

-- Existing supplier names become payees; keep the original name on every expense snapshot.
insert into public.business_operations_records(shop_id,collection,id,data)
select shop_id,'payees',gen_random_uuid(),jsonb_build_object('name',min(btrim(data->>'payee')),'phone','','address','','note','','archived',false,'version',1,'createdAt',now(),'modifiedAt',now(),'createdByLabel','Imported from expenses','modifiedByLabel','Imported from expenses')
from public.expenses where length(btrim(coalesce(data->>'payee','')))>0 group by shop_id,lower(btrim(data->>'payee'));
update public.business_operations_records set data=data||jsonb_build_object('id',id) where collection='payees';
update public.expenses e set data=e.data||jsonb_build_object('payeeId',p.id) from public.business_operations_records p where p.collection='payees' and p.shop_id=e.shop_id and lower(btrim(e.data->>'payee'))=lower(btrim(p.data->>'name'));

alter function public.get_ledger(uuid) rename to get_ledger_before_operations;
create function public.get_ledger(p_shop uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare result jsonb;key text;
begin
 result:=public.get_ledger_before_operations(p_shop);
 foreach key in array array['payees','moneyAccounts','accountEntries','operationHistory'] loop
  result:=result||jsonb_build_object(key,(select coalesce(jsonb_agg(data order by data->>'createdAt',id),'[]'::jsonb) from public.business_operations_records where shop_id=p_shop and collection=key));
 end loop;
 return result;
end $f$;
revoke all on function public.get_ledger(uuid) from public,anon;
grant execute on function public.get_ledger(uuid) to authenticated;
alter function public.get_ledger_changes(uuid,text) rename to get_ledger_changes_before_operations;
create function public.get_ledger_changes(p_shop uuid,p_since text default null) returns jsonb language plpgsql stable security invoker set search_path='' as $f$
declare result jsonb;key text;extra jsonb:='{}';
begin
 result:=public.get_ledger_changes_before_operations(p_shop,p_since);
 foreach key in array array['payees','moneyAccounts','accountEntries','operationHistory'] loop
  extra:=extra||jsonb_build_object(key,(select coalesce(jsonb_agg(data order by data->>'modifiedAt',id),'[]'::jsonb) from public.business_operations_records where shop_id=p_shop and collection=key and (coalesce((result->>'full')::boolean,false) or sync_xid>=p_since::xid8)));
 end loop;
 return jsonb_set(result,'{ledger}',(result->'ledger')||extra);
end $f$;
revoke all on function public.get_ledger_changes(uuid,text) from public,anon;
grant execute on function public.get_ledger_changes(uuid,text) to authenticated;

-- Canonical movements, shared by reconciliation and assignment checks. Transfers are not sales.
create function private.operations_transactions(p_shop uuid) returns jsonb language sql stable security invoker set search_path='' as $f$
 with l as (select public.get_ledger_before_operations(p_shop) j), transactions as (
 select 'payment:'||(p->>'id') id,coalesce(p->>'paidOn',left(p->>'createdAt',10)) as paid_on,(p->>'amount')::bigint amount,1 direction,
 coalesce(nullif(p->>'accountId',''),(select nullif(c->>'accountId','') from jsonb_array_elements((select j->'checkouts' from l)) c where c->>'id'=coalesce(p->>'checkoutId',p->>'id') limit 1)) account_id
 from jsonb_array_elements((select j->'payments' from l)) p where not p ? 'refundId' and (p->>'amount')::bigint>0
 union all
 select 'expense:'||(p->>'id'),p->>'paidOn',(p->>'amount')::bigint,-1,nullif(p->>'accountId','') from jsonb_array_elements((select j->'expenses' from l)) e cross join lateral jsonb_array_elements(e->'payments') p
 union all
 select 'refund:'||(a->>'id'),coalesce(a->>'paidOn',to_char((a->>'changedAt')::timestamptz at time zone 'Africa/Lagos','YYYY-MM-DD')),(a->>'refundAmount')::bigint,-1,nullif(a->>'accountId','') from jsonb_array_elements((select j->'saleAdjustments' from l)) a where a->>'action'='sale.refunded' and (a->>'refundAmount')::bigint>0
 ) select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'paidOn',t.paid_on,'amount',t.amount,'direction',t.direction,'accountId',coalesce(t.account_id,(select data->>'accountId' from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and data->>'action'='assignment' and data->>'transactionId'=t.id),''))),'[]'::jsonb) from transactions t
$f$;
revoke all on function private.operations_transactions(uuid) from public,anon,authenticated;
create function private.operations_balance(p_shop uuid,p_account uuid,p_day date) returns bigint language plpgsql stable security invoker set search_path='' as $f$
declare a jsonb;total bigint;e jsonb;t jsonb;
begin
 select data into a from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=p_account;
 if a is null then raise exception 'Account not found';end if;
 total:=(a->>'openingBalance')::bigint;
 for t in select value from jsonb_array_elements(private.operations_transactions(p_shop)) loop
  if t->>'accountId'=p_account::text and (t->>'paidOn')::date between (a->>'openingDate')::date and p_day then total:=total+(t->>'direction')::bigint*(t->>'amount')::bigint;end if;
 end loop;
 for e in select data from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and (data->>'paidOn')::date between (a->>'openingDate')::date and p_day loop
  if e->>'action'='transfer' then
   if e->>'accountId'=p_account::text then total:=total-(e->>'amount')::bigint;end if;
   if e->>'toAccountId'=p_account::text then total:=total+(e->>'amount')::bigint;end if;
  elsif e->>'action'='reconciliation' and e->>'accountId'=p_account::text then total:=total+(e->>'amount')::bigint;
  end if;
 end loop;
 return total;
end $f$;
revoke all on function private.operations_balance(uuid,uuid,date) from public,anon,authenticated;

create function private.apply_operations_event(p_shop uuid,p_event jsonb) returns void language plpgsql security definer set search_path='' as $f$
declare
 d jsonb:=p_event->'data';k text:=p_event->>'kind';eid uuid:=(p_event->>'id')::uuid;rid uuid:=(d->>'id')::uuid;u uuid:=auth.uid();lvl integer;label text;prior jsonb;old jsonb;nxt jsonb;audit jsonb;col text;job public.jobs%rowtype;jid uuid;ids uuid[];expected text;reason text;due text;on_day date;a jsonb;dest jsonb;v numeric;actual numeric;expected_balance bigint;t jsonb;
begin
 select access_level,name into lvl,label from public.shop_members where shop_id=p_shop and user_id=u and not archived;
 if u is null or lvl is null or lvl<1 or (k<>'job.due_changed' and lvl<2) then raise exception 'Business access denied';end if;
 if eid is null or rid is null or (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Invalid operation identity';end if;
 perform private.assert_sync_dependencies(p_shop,p_event);
 if public.my_subscription(p_shop)->>'restriction'='locked' then raise exception 'This business subscription has ended' using errcode='PSLSB';end if;
 perform 1 from public.shops where id=p_shop for update;
 select payload into prior from public.ledger_events where shop_id=p_shop and id=eid;
 if found then if prior is distinct from p_event then raise exception 'Operation ID reused for different data';end if;return;end if;
 audit:=jsonb_build_object('modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now(),'lastEventId',eid);
 if k='job.due_changed' then
  if jsonb_typeof(d->'jobIds') is distinct from 'array' or jsonb_array_length(d->'jobIds') not between 1 and 100 or jsonb_typeof(d->'expectedDueDates') is distinct from 'object' then raise exception 'Select 1 to 100 jobs';end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(d->'jobIds');
  if cardinality(ids)<>(select count(distinct value) from unnest(ids) value) then raise exception 'Select each job once';end if;
  if jsonb_typeof(d->'dueAt') is distinct from 'string' then raise exception 'Invalid due date';end if;
  due:=d->>'dueAt';reason:=btrim(d->>'reason');
  if reason is null or length(reason) not between 1 and 500 then raise exception 'Enter a reason up to 500 characters';end if;
  if due<>'' and due::timestamptz>now()+interval '5 years 6 days' then raise exception 'Choose a deadline within five years';end if;
  foreach jid in array ids loop
   select * into job from public.jobs where shop_id=p_shop and id=jid for update;
   if not found or job.production_status in ('Completed','Collected','Cancelled') then raise exception 'Choose active jobs';end if;
   if coalesce(d->'expectedDueDates'->>jid::text,'') is distinct from coalesce(job.metadata->>'dueAt','') then raise exception 'A due date changed elsewhere. Refresh before postponing.' using errcode='PT409';end if;
   update public.jobs set metadata=metadata||jsonb_build_object('dueAt',due,'dueHistory',coalesce(metadata->'dueHistory','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id',eid,'from',coalesce(metadata->>'dueAt',''),'to',due,'reason',reason,'changedBy',label,'changedAt',now()))),version=version+1,modified_by=u,modified_by_label=label,modified_at=now(),last_event_id=eid where shop_id=p_shop and id=jid;
  end loop;
 elsif k in ('payee.created','payee.updated','payee.archived','payee.restored','account.created','account.updated','account.archived','account.restored') then
  col:=case when k like 'payee.%' then 'payees' else 'moneyAccounts' end;
  select data into old from public.business_operations_records where shop_id=p_shop and collection=col and id=rid for update;
  if k like '%.created' then if old is not null then raise exception 'Record already exists';end if;
  elsif old is null or (d->>'baseVersion')::integer is distinct from (old->>'version')::integer then raise exception 'Record changed elsewhere. Reopen it.' using errcode='PT409';end if;
  if k like '%.archived' or k like '%.restored' then nxt:=old||audit||jsonb_build_object('archived',k like '%.archived','version',(old->>'version')::integer+1);
  else
   if jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 160 then raise exception 'Enter a name up to 160 characters';end if;
   nxt:=coalesce(old,'{}')||audit||jsonb_build_object('id',rid,'name',btrim(d->>'name'),'archived',coalesce((old->>'archived')::boolean,false),'version',coalesce((old->>'version')::integer,0)+1,'createdAt',coalesce(old->'createdAt',to_jsonb(now())),'createdBy',coalesce(old->'createdBy',to_jsonb(u)),'createdByLabel',coalesce(old->'createdByLabel',to_jsonb(label)));
   if col='payees' then
    if jsonb_typeof(d->'phone') is distinct from 'string' or length(d->>'phone')>40 or jsonb_typeof(d->'address') is distinct from 'string' or length(d->>'address')>500 or jsonb_typeof(d->'note') is distinct from 'string' or length(d->>'note')>1000 then raise exception 'Invalid payee details';end if;
    nxt:=nxt||jsonb_build_object('phone',btrim(d->>'phone'),'address',btrim(d->>'address'),'note',btrim(d->>'note'));
   else
    if jsonb_typeof(d->'accountType') is distinct from 'string' or d->>'accountType' not in ('cash','bank','pos','other') or jsonb_typeof(d->'methods') is distinct from 'array' or jsonb_array_length(d->'methods')>30 or exists(select 1 from jsonb_array_elements(d->'methods') m where jsonb_typeof(m) is distinct from 'string' or length(m#>>'{}') not between 1 and 80) then raise exception 'Invalid account details';end if;
    if exists(select 1 from public.business_operations_records r where shop_id=p_shop and collection='moneyAccounts' and id<>rid and not coalesce((data->>'archived')::boolean,false) and exists(select 1 from jsonb_array_elements_text(data->'methods') as methods(value) where d->'methods' ? methods.value)) then raise exception 'Each payment method can have only one default account';end if;
    v:=coalesce(old->>'openingBalance',d->>'openingBalance')::numeric;on_day:=coalesce(old->>'openingDate',d->>'openingDate')::date;
    if v is null or abs(v)>100000000000 or v<>trunc(v) or on_day is null then raise exception 'Enter a valid opening balance and date';end if;
    nxt:=nxt||jsonb_build_object('accountType',d->>'accountType','openingDate',on_day,'openingBalance',v::bigint,'methods',d->'methods');
   end if;
  end if;
  if col='moneyAccounts' and not (nxt->>'archived')::boolean and exists(select 1 from public.business_operations_records r where shop_id=p_shop and collection=col and id<>rid and not (data->>'archived')::boolean and exists(select 1 from jsonb_array_elements_text(data->'methods') as methods(value) where nxt->'methods' ? methods.value)) then raise exception 'Each payment method can have only one default account';end if;
  if not (nxt->>'archived')::boolean and exists(select 1 from public.business_operations_records where shop_id=p_shop and collection=col and id<>rid and not (data->>'archived')::boolean and lower(btrim(data->>'name'))=lower(nxt->>'name')) then raise exception 'An active record already has that name' using errcode='PT409';end if;
  insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,col,rid,nxt) on conflict(shop_id,collection,id) do update set data=excluded.data;
 elsif k in ('account.transferred','account.reconciled','account.assigned') then
  select data into a from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->>'accountId')::uuid and not (data->>'archived')::boolean;
  if a is null then raise exception 'Choose an active account';end if;
  on_day:=(d->>'paidOn')::date;reason:=btrim(d->>'reason');
  if on_day is null or on_day<(a->>'openingDate')::date or reason is null or length(reason) not between 1 and 500 then raise exception 'Choose a date after opening and provide a reason';end if;
  nxt:=audit||jsonb_build_object('id',rid,'accountId',a->>'id','paidOn',on_day,'reason',reason);
  if k='account.transferred' then
   select data into dest from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->>'toAccountId')::uuid and not (data->>'archived')::boolean;
   v:=(d->>'amount')::numeric;
   if dest is null or a->>'id'=dest->>'id' or on_day<(dest->>'openingDate')::date or v is null or v<=0 or v>100000000000 or v<>trunc(v) then raise exception 'Choose different accounts and a positive amount';end if;
   nxt:=nxt||jsonb_build_object('action','transfer','toAccountId',dest->>'id','amount',v::bigint);
  elsif k='account.reconciled' then
   actual:=(d->>'actualBalance')::numeric;expected_balance:=private.operations_balance(p_shop,(a->>'id')::uuid,on_day);
   if actual is null or abs(actual)>100000000000 or actual<>trunc(actual) then raise exception 'Enter a valid counted balance';end if;
   if expected_balance is distinct from (d->>'expectedBalance')::bigint then raise exception 'The account balance changed. Review it before reconciling.' using errcode='PT409';end if;
   nxt:=nxt||jsonb_build_object('action','reconciliation','amount',actual::bigint-expected_balance,'expectedBalance',expected_balance,'actualBalance',actual::bigint);
  else
   select value into t from jsonb_array_elements(private.operations_transactions(p_shop)) where value->>'id'=d->>'transactionId';
   if t is null or coalesce(t->>'accountId','')<>'' or (t->>'paidOn')::date<(a->>'openingDate')::date then raise exception 'Choose an unassigned transaction after opening';end if;
   nxt:=nxt||jsonb_build_object('action','assignment','transactionId',t->>'id','amount',0,'paidOn',t->>'paidOn');
  end if;
  insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'accountEntries',rid,nxt);
 else raise exception 'Unknown operation';end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,eid,u,p_event);
 insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'operationHistory',eid,audit||jsonb_build_object('id',eid,'action',k,'recordId',rid,'before',old,'after',nxt,'event',p_event));
end $f$;
revoke all on function private.apply_operations_event(uuid,jsonb) from public,anon;
grant execute on function private.apply_operations_event(uuid,jsonb) to authenticated;
create function public.apply_operations_event(p_shop uuid,p_event jsonb) returns void language sql security invoker set search_path='' as $f$select private.apply_operations_event(p_shop,p_event);$f$;
revoke all on function public.apply_operations_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_operations_event(uuid,jsonb) to authenticated;

-- Carry optional payee/account references through the existing atomic saves and reject cross-business links.
do $patch$
declare src text;marker text;
begin
 src:=pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
 marker:=$m$'payee',btrim(d->>'payee'),$m$;
 if strpos(src,marker)=0 then raise exception 'Expense payee marker changed';end if;
 src:=replace(src,marker,$m$'payeeId',coalesce(d->'payeeId',old->'payeeId','null'::jsonb),'payee',btrim(d->>'payee'),$m$);
 marker:=$m$p:=jsonb_build_object('methodLabel',$m$;
 if strpos(src,marker)=0 then raise exception 'Expense payment marker changed';end if;
 src:=replace(src,marker,$m$p:=jsonb_build_object('accountId',p->'accountId','methodLabel',$m$);
 src:=replace(src,E'begin\n',E'begin\n'||$guard$
 if nullif(d->>'payeeId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='payees' and id=(d->>'payeeId')::uuid and (not coalesce((data->>'archived')::boolean,false) or id::text=(select data->>'payeeId' from public.expenses where shop_id=p_shop and id=(d->>'id')::uuid))) then raise exception 'Choose an active payee from this business';end if;
 if nullif(d->'payment'->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->'payment'->>'accountId')::uuid and not (data->>'archived')::boolean and (d->'payment'->>'paidOn')::date>=(data->>'openingDate')::date) then raise exception 'Choose an active payment account with a valid opening date';end if;
$guard$);
 execute src;
 src:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 src:=replace(src,E'begin\n',E'begin\n'||$guard$
 if nullif(d->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->>'accountId')::uuid and not (data->>'archived')::boolean and (d->>'paidOn')::date>=(data->>'openingDate')::date) then raise exception 'Choose an active payment account with a valid opening date';end if;
$guard$);
 execute src;
end $patch$;
-- Extend the same remote-review and dependency mechanism used by existing offline edits.
do $patch$
declare src text;marker text;
begin
 src:=pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
 marker:=$m$'checkout.completed','job.status_changed'$m$;
 if strpos(src,marker)=0 then raise exception 'Conflict kind marker changed';end if;
 src:=replace(src,marker,$m$'job.due_changed','payee.created','payee.updated','payee.archived','payee.restored','account.created','account.updated','account.archived','account.restored','account.transferred','account.reconciled','account.assigned','checkout.completed','job.status_changed'$m$);execute src;
 src:=pg_get_functiondef('private.apply_reviewed_operation(uuid,jsonb,uuid)'::regprocedure);
 marker:=$m$else raise exception 'Unsupported review operation';$m$;
 if strpos(src,marker)=0 then raise exception 'Reviewed operation marker changed';end if;
 src:=replace(src,marker,$m$when p_event->>'kind'='job.due_changed' or p_event->>'kind' like 'payee.%' or p_event->>'kind' like 'account.%' then perform public.apply_operations_event(p_shop,p_event);
 else raise exception 'Unsupported review operation';$m$);execute src;
end $patch$;
alter function private.sync_resource_keys(uuid,jsonb,boolean,text) rename to sync_resource_keys_before_operations;
create function private.sync_resource_keys(p_shop uuid,p_event jsonb,p_hold boolean default false,p_message text default '') returns text[] language plpgsql stable set search_path='' as $f$
declare d jsonb:=p_event->'data';keys text[]:=private.sync_resource_keys_before_operations(p_shop,p_event,p_hold,p_message);j text;
begin
 if p_event->>'kind'='job.due_changed' then for j in select value from jsonb_array_elements_text(d->'jobIds') loop keys:=array_append(keys,'job:'||j);end loop;end if;
 if p_event->>'kind' like 'payee.%' then keys:=array_append(keys,'payee:'||(d->>'id'));end if;
 if p_event->>'kind' like 'account.%' then keys:=keys||array['account:'||coalesce(d->>'accountId',d->>'id'),'account:'||(d->>'toAccountId'),'transaction:'||(d->>'transactionId')];end if;
 keys:=keys||array['account:'||(d->>'accountId'),'payee:'||(d->>'payeeId'),'account:'||(d->'payment'->>'accountId')];
 return array_remove(keys,null);
end $f$;
revoke all on function private.sync_resource_keys(uuid,jsonb,boolean,text) from public,anon,authenticated;
alter function private.conflict_token(uuid,jsonb) rename to conflict_token_before_operations;
create function private.conflict_token(p_shop uuid,p_source jsonb) returns text language sql stable set search_path='' as $f$
select md5(private.conflict_token_before_operations(p_shop,p_source)||coalesce((select jsonb_agg(data order by collection,id)::text from public.business_operations_records where shop_id=p_shop and collection in ('payees','moneyAccounts','accountEntries')),'[]')||coalesce((select jsonb_agg(to_jsonb(j) order by j.id)::text from public.jobs j where j.shop_id=p_shop and p_source->>'kind'='job.due_changed' and p_source->'data'->'jobIds' ? j.id::text),'[]'))
$f$;
revoke all on function private.conflict_token(uuid,jsonb) from public,anon,authenticated;
commit;
