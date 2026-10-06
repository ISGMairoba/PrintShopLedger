begin;
alter table public.jobs drop constraint if exists jobs_service_check;
alter table public.jobs add constraint jobs_service_check check(length(btrim(service)) between 1 and 500);
alter table public.materials drop constraint if exists materials_available_check;
alter table public.materials add constraint materials_available_check check(available between -1000000000000 and 1000000000000);
alter table public.material_stock_changes drop constraint if exists material_stock_changes_action_check;
alter table public.material_stock_changes add constraint material_stock_changes_action_check check(action in ('material.created','material.updated','material.stock_added','material.stock_set','material.archived','material.restored','material.job_used'));
alter table public.material_stock_changes add column if not exists job_id uuid,add column if not exists checkout_id uuid;
alter table public.jobs add column if not exists metadata jsonb not null default '{}',add column if not exists production_status text not null default 'Added' check(production_status in ('Added','In Queue','Printing','Completed','Collected')),add column if not exists version integer not null default 1,add column if not exists modified_by uuid references auth.users(id),add column if not exists modified_by_label text,add column if not exists modified_at timestamptz,add column if not exists last_event_id uuid;
alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments add constraint payments_amount_check check(amount between 0 and 100000000000);
alter table public.payments add column if not exists wallet_used bigint not null default 0 check(wallet_used between 0 and 100000000000),add column if not exists wallet_added bigint not null default 0 check(wallet_added between 0 and 100000000000),add column if not exists checkout_id uuid;
create table if not exists public.checkout_records(shop_id uuid not null references public.shops(id),id uuid not null,customer_id uuid not null,data jsonb not null,created_at timestamptz not null default now(),primary key(shop_id,id),foreign key(shop_id,customer_id) references public.customers(shop_id,id));
create index if not exists checkout_records_customer on public.checkout_records(shop_id,customer_id,created_at);
alter table public.checkout_records enable row level security;
revoke all on public.checkout_records from public,anon,authenticated;
grant select on public.checkout_records to authenticated;
drop policy if exists member_read on public.checkout_records;
create policy member_read on public.checkout_records for select to authenticated using(public.is_shop_member(shop_id));
create or replace function public.record_material_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_event jsonb;v_before jsonb;v_after jsonb;
begin
select payload into v_event from public.ledger_events where shop_id=new.shop_id and id=new.last_event_id;
if v_event is null then raise exception 'Material change must have an event record';end if;
if tg_op='UPDATE' then v_before:=jsonb_build_object('name',old.name,'available',old.available,'measurementUnit',old.measurement_unit,'requireSize',old.require_size,'archived',old.archived);end if;
v_after:=jsonb_build_object('name',new.name,'available',new.available,'measurementUnit',new.measurement_unit,'requireSize',new.require_size,'archived',new.archived);
insert into public.material_stock_changes(id,shop_id,material_id,action,before_available,after_available,reason,actor_id,actor_label,created_at,material_name,measurement_unit,before_values,after_values,details_complete,job_id,checkout_id)
values(new.last_event_id,new.shop_id,new.id,v_event->>'kind',(v_before->>'available')::numeric,new.available,btrim(coalesce(v_event->'data'->>'reason','')),new.modified_by,new.modified_by_label,new.modified_at,new.name,new.measurement_unit,v_before,v_after,true,(v_event->'data'->>'jobId')::uuid,(v_event->'data'->>'checkoutId')::uuid);
return new;end;$$;
create or replace function public.apply_material_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_data jsonb := p_event -> 'data';
  v_kind text := p_event ->> 'kind';
  v_event uuid := (p_event ->> 'id')::uuid;
  v_id uuid := (v_data ->> 'id')::uuid;
  v_user uuid := auth.uid();
  v_label text;
  v_existing jsonb;
  v_actor uuid;
  v_material public.materials%rowtype;
  v_available numeric;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing material identifier'; end if;
  if (v_data ->> 'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select payload, actor_id into v_existing, v_actor from public.ledger_events where shop_id = p_shop and id = v_event;
  if found then
    if v_existing <> p_event or v_actor <> v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data ->> 'full_name'), ''), email, id::text)
    into v_label from auth.users where id = v_user;
  select * into v_material from public.materials where id = v_id and shop_id = p_shop for update;
  if v_kind = 'material.created' then
    if found then raise exception 'Material ID already exists'; end if;
  else
    if not found then raise exception 'Material not found'; end if;
    if (v_data ->> 'baseVersion')::integer is distinct from v_material.version then
      raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = '40001';
    end if;
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values(p_shop, v_event, v_user, p_event);
  if v_kind in ('material.created', 'material.updated') then
    if jsonb_typeof(v_data -> 'available') is distinct from 'number' then raise exception 'Available must be a number'; end if;
    v_available := (v_data ->> 'available')::numeric;
    if v_available < -1000000000000 or v_available > 1000000000000 or v_available <> round(v_available, 3) then
      raise exception 'Available must be within range with at most three decimal places';
    end if;
    if jsonb_typeof(v_data -> 'requireSize') is distinct from 'boolean' then raise exception 'Require Size must be boolean'; end if;
    if v_kind = 'material.created' then
      insert into public.materials(id, shop_id, name, available, measurement_unit, require_size, created_by,
        created_by_label, modified_by, modified_by_label, last_event_id)
      values(v_id, p_shop, btrim(v_data ->> 'name'), v_available, btrim(v_data ->> 'measurementUnit'),
        (v_data ->> 'requireSize')::boolean, v_user, v_label, v_user, v_label, v_event);
    else
      if v_material.archived then raise exception 'Restore this material before editing it'; end if;
      update public.materials set name = btrim(v_data ->> 'name'),
        measurement_unit = btrim(v_data ->> 'measurementUnit'), require_size = (v_data ->> 'requireSize')::boolean,
        modified_by = v_user, modified_by_label = v_label, modified_at = now(),
        version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
    end if;
  elsif v_kind in ('material.stock_added', 'material.stock_set') then
    if v_material.archived then raise exception 'Restore this material before changing stock'; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' then raise exception 'Stock quantity must be a number'; end if;
    v_available := (v_data ->> 'quantity')::numeric;
    if v_available < -1000000000000 or v_available > 1000000000000 or v_available <> round(v_available,3) then raise exception 'Stock quantity must be within range with at most three decimal places'; end if;
    if length(coalesce(v_data ->> 'reason','')) > 500 then raise exception 'Stock note is too long'; end if;
    if v_kind = 'material.stock_added' then
      if v_available <= 0 then raise exception 'Quantity to add must be greater than zero'; end if;
      v_available := v_material.available + v_available;
    end if;
    if abs(v_available) > 1000000000000 then raise exception 'Available quantity is too large'; end if;
    update public.materials set available = v_available, modified_by = v_user, modified_by_label = v_label,
      modified_at = now(), version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
  elsif v_kind in ('material.archived', 'material.restored') then
    if v_material.archived = (v_kind = 'material.archived') then raise exception 'Material is already in that state'; end if;
    update public.materials set archived = (v_kind = 'material.archived'), modified_by = v_user,
      modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  else raise exception 'Unknown material operation'; end if;

end;
$$;
revoke all on function public.apply_material_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_material_event(uuid, jsonb) to authenticated;


create or replace function public.checkout_account_token(p_shop uuid,p_customer uuid) returns text language sql stable security invoker set search_path='' as $$
select 'wallet='||coalesce((select sum(wallet_added-wallet_used) from public.payments where shop_id=p_shop and customer_id=p_customer),0)::text||';'||coalesce((select string_agg(j.id::text||':'||(j.amount-coalesce((select sum(a.amount) from public.payment_allocations a where a.shop_id=p_shop and a.job_id=j.id),0))::text,',' order by j.id) from public.jobs j where j.shop_id=p_shop and j.customer_id=p_customer),'');$$;
revoke all on function public.checkout_account_token(uuid,uuid) from public,anon;
grant execute on function public.checkout_account_token(uuid,uuid) to authenticated;
create or replace function public.apply_checkout_event(p_shop uuid,p_event jsonb) returns void language plpgsql security definer set search_path='' as $$
declare
 d jsonb:=p_event->'data';e uuid:=(p_event->>'id')::uuid;c uuid:=(d->>'customerId')::uuid;u uuid:=auth.uid();label text;existing jsonb;existing_actor uuid;
 line jsonb;a jsonb;svc public.services%rowtype;mat public.materials%rowtype;job public.jobs%rowtype;
 cash numeric;wu numeric;wa numeric;wallet numeric;total numeric:=0;allocated numeric:=0;debt numeric;needed numeric;calculated numeric;q numeric;w numeric;h numeric;outstanding numeric;seen uuid[]:='{}';item_id uuid;snapshots jsonb;canonical_jobs jsonb;
begin
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
 if p_event->>'kind' is distinct from 'checkout.completed' or e is null or e is distinct from (d->>'id')::uuid or c is null or (d->>'createdBy')::uuid is distinct from u then raise exception 'Invalid checkout identity';end if;
 perform 1 from public.shops where id=p_shop for update;
 select payload,actor_id into existing,existing_actor from public.ledger_events where shop_id=p_shop and id=e;
 if found then if existing<>p_event or existing_actor<>u then raise exception 'Operation ID already used';end if;return;end if;
 select name into label from public.shop_members where shop_id=p_shop and user_id=u;
 if d->'newCustomer' is not null and d->'newCustomer'<>'null'::jsonb then
  if d->'newCustomer'->>'kind' is distinct from 'customer.created' or (d->'newCustomer'->'data'->>'id')::uuid is distinct from c or (d->'newCustomer'->'data'->>'modifiedBy')::uuid is distinct from u then raise exception 'Invalid new customer';end if;
  perform public.apply_customer_event(p_shop,d->'newCustomer');
 end if;
 if not exists(select 1 from public.customers where shop_id=p_shop and id=c and not archived) then raise exception 'Select an active customer' using errcode='40001';end if;
 if d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,c) then raise exception 'Customer balances changed. Review the latest account before syncing.' using errcode='40001';end if;
 if jsonb_typeof(d->'jobs') is distinct from 'array' or jsonb_array_length(d->'jobs')>50 or jsonb_typeof(d->'allocations') is distinct from 'array' then raise exception 'Invalid checkout items';end if;
 cash:=(d->>'cashReceived')::numeric;wu:=(d->>'walletUsed')::numeric;wa:=(d->>'walletAdded')::numeric;
 if cash is null or wu is null or wa is null or cash<0 or wu<0 or wa<0 or cash>100000000000 or wu>100000000000 or wa>100000000000 or cash<>trunc(cash) or wu<>trunc(wu) or wa<>trunc(wa) then raise exception 'Invalid payment amounts';end if;
 select coalesce(sum(wallet_added-wallet_used),0) into wallet from public.payments where shop_id=p_shop and customer_id=c;
 if wu>wallet or (wu>0 and (d->>'useWallet')::boolean is distinct from true) or wallet-wu+wa>100000000000 then raise exception 'Wallet credit is unavailable';end if;
 if jsonb_typeof(d->'method') is distinct from 'string' or jsonb_typeof(d->'paidOn') is distinct from 'string' or jsonb_typeof(d->'createdAt') is distinct from 'string' or jsonb_typeof(d->'useWallet') is distinct from 'boolean' or d->>'method' not in ('Cash','POS','Transfer') or length(coalesce(d->>'reference',''))>200 or d->>'paidOn' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid payment details';end if;
 perform (d->>'paidOn')::date;perform (d->>'createdAt')::timestamptz;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 for line in select value from jsonb_array_elements(d->'jobs') loop
  item_id:=(line->>'id')::uuid;
  if item_id is null or item_id=any(seen) then raise exception 'Duplicate job ID';end if;seen:=array_append(seen,item_id);
  select * into svc from public.services where shop_id=p_shop and id=(line->>'serviceId')::uuid and not archived;
  if not found or svc.price is distinct from (line->>'unitPrice')::bigint or svc.version is distinct from (line->>'serviceVersion')::integer then raise exception 'Service or price changed. Review checkout.' using errcode='40001';end if;
  select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived for update;
  if not found or mat.id is distinct from (line->>'materialId')::uuid or mat.require_size is distinct from (line->>'requireSize')::boolean then raise exception 'Base material changed. Review checkout.' using errcode='40001';end if;
  q:=(line->>'quantity')::numeric;w:=case when mat.require_size then (line->>'width')::numeric else 1 end;h:=case when mat.require_size then (line->>'height')::numeric else 1 end;
  if q is null or w is null or h is null or q<=0 or w<=0 or h<=0 or q>1000000 or w>1000000 or h>1000000 or q<>round(q,3) or w<>round(w,3) or h<>round(h,3) then raise exception 'Invalid quantity or dimensions';end if;
  needed:=round(q*w*h,3);calculated:=round(svc.price*q*w*h);
  if needed<=0 or needed>1000000000000 or calculated<=0 or calculated>100000000000 or calculated is distinct from (line->>'amount')::numeric or needed is distinct from (line->>'materialNeeded')::numeric then raise exception 'Invalid job calculation';end if;
  if jsonb_typeof(line->'description') is distinct from 'string' or length(btrim(line->>'description')) not between 1 and 500 or jsonb_typeof(line->'source') is distinct from 'string' or line->>'source' not in ('In shop / USB','Shop network','WhatsApp','Email','Other') or length(coalesce(line->>'sourceNote',''))>200 then raise exception 'Invalid job description or source';end if;
  total:=total+calculated;
  insert into public.jobs(shop_id,id,customer_id,service,description,amount,created_at,metadata,modified_by,modified_by_label,modified_at,last_event_id)
   values(p_shop,item_id,c,svc.description,btrim(line->>'description'),calculated,(d->>'createdAt')::timestamptz,line||jsonb_build_object('customerId',c,'service',svc.description,'measurementUnit',mat.measurement_unit,'createdBy',u,'createdByLabel',label,'checkoutId',e,'checkoutPosition',jsonb_array_length(to_jsonb(seen))-1,'productionStatus','Added','version',1),u,label,now(),e);
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,item_id,u,jsonb_build_object('id',item_id,'kind','material.job_used','data',jsonb_build_object('id',mat.id,'jobId',item_id,'checkoutId',e,'reason','Checkout '||e||' / Job '||item_id)));
  update public.materials set available=available-needed,version=version+1,modified_by=u,modified_by_label=label,modified_at=now(),last_event_id=item_id where shop_id=p_shop and id=mat.id;
 end loop;
 if total>100000000000 or total is distinct from (d->>'total')::numeric then raise exception 'Invalid checkout total';end if;
 select coalesce(sum(j.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=j.id),0)),0) into debt from public.jobs j where j.shop_id=p_shop and j.customer_id=c;
 seen:='{}';
 for a in select value from jsonb_array_elements(d->'allocations') loop
  item_id:=(a->>'jobId')::uuid;outstanding:=(a->>'amount')::numeric;
  select * into job from public.jobs where shop_id=p_shop and id=item_id and customer_id=c;
  if not found or item_id=any(seen) or outstanding is null or outstanding<=0 or outstanding<>trunc(outstanding) then raise exception 'Invalid job allocation';end if;
  seen:=array_append(seen,item_id);
  if outstanding>job.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=item_id),0) then raise exception 'A job balance changed. Review allocation.' using errcode='40001';end if;
  allocated:=allocated+outstanding;
 end loop;
 if allocated is distinct from (d->>'allocated')::numeric or allocated<>cash+wu-wa or wu<>greatest(0,allocated-cash) or wa<>greatest(0,cash-allocated) or wallet-wu+wa is distinct from (d->>'walletAfter')::numeric or debt is distinct from (d->>'outstandingBefore')::numeric or debt-allocated is distinct from (d->>'outstandingAfter')::numeric then raise exception 'Checkout balances do not match';end if;
 if jsonb_array_length(d->'jobs')=0 and cash=0 and wu=0 then raise exception 'Nothing to save';end if;
 if cash>0 or wu>0 then
  insert into public.payments(shop_id,id,customer_id,amount,method,paid_on,reference,created_at,wallet_used,wallet_added,checkout_id) values(p_shop,e,c,cash,d->>'method',(d->>'paidOn')::date,coalesce(d->>'reference',''),(d->>'createdAt')::timestamptz,wu,wa,e);
  insert into public.payment_allocations(shop_id,payment_id,job_id,amount) select p_shop,e,(value->>'jobId')::uuid,(value->>'amount')::bigint from jsonb_array_elements(d->'allocations');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'description',j.description,'service',j.service,'amount',j.amount,'paidBefore',coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=j.id and pa.payment_id<>e),0),'paidThisCheckout',coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=j.id and pa.payment_id=e),0),'outstandingAfter',j.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=j.id),0)) order by j.created_at,coalesce((j.metadata->>'checkoutPosition')::integer,0),j.id),'[]') into snapshots from public.jobs j where j.shop_id=p_shop and j.customer_id=c and (j.metadata->>'checkoutId'=e::text or exists(select 1 from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=j.id and pa.payment_id=e));
 select coalesce(jsonb_agg(j.metadata||jsonb_build_object('id',j.id,'customerId',j.customer_id,'service',j.service,'description',j.description,'amount',j.amount,'createdAt',j.created_at,'modifiedBy',j.modified_by,'modifiedByLabel',j.modified_by_label,'modifiedAt',j.modified_at,'lastEventId',j.last_event_id) order by (j.metadata->>'checkoutPosition')::integer),'[]') into canonical_jobs from public.jobs j where j.shop_id=p_shop and j.metadata->>'checkoutId'=e::text;
 insert into public.checkout_records(shop_id,id,customer_id,data) select p_shop,e,c,d||jsonb_build_object('createdBy',u,'createdByLabel',label,'jobs',canonical_jobs,'jobBalances',snapshots,'customerSnapshot',jsonb_build_object('id',cu.id,'name',cu.name,'phone',cu.phone,'address',cu.address)) from public.customers cu where cu.shop_id=p_shop and cu.id=c;
end;$$;
revoke all on function public.apply_checkout_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_checkout_event(uuid,jsonb) to authenticated;
create or replace function public.apply_job_status_event(p_shop uuid,p_event jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_event->'data';e uuid:=(p_event->>'id')::uuid;j public.jobs%rowtype;payload jsonb;actor uuid;label text;next_status text;
begin
if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
if p_event->>'kind' is distinct from 'job.status_changed' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity';end if;
perform 1 from public.shops where id=p_shop for update;
select le.payload,le.actor_id into payload,actor from public.ledger_events le where shop_id=p_shop and id=e;
if found then if payload<>p_event or actor<>auth.uid() then raise exception 'Operation ID already used';end if;return;end if;
select * into j from public.jobs where shop_id=p_shop and id=(d->>'id')::uuid for update;
if not found then raise exception 'Job not found';end if;
next_status:=case j.production_status when 'Added' then 'In Queue' when 'In Queue' then 'Printing' when 'Printing' then 'Completed' when 'Completed' then 'Collected' end;
if j.version is distinct from (d->>'baseVersion')::integer or next_status is null or next_status is distinct from d->>'status' then raise exception 'Job status changed. Review the latest version.' using errcode='40001';end if;
select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();
insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,auth.uid(),p_event);
update public.jobs set production_status=next_status,version=version+1,modified_by=auth.uid(),modified_by_label=label,modified_at=now(),last_event_id=e where shop_id=p_shop and id=j.id;
end;$$;
revoke all on function public.apply_job_status_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_job_status_event(uuid,jsonb) to authenticated;
do $$begin if to_regprocedure('public.get_ledger_before_checkout(uuid)') is null then alter function public.get_ledger(uuid) rename to get_ledger_before_checkout;end if;end$$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare base jsonb;
begin
if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
base:=public.get_ledger_before_checkout(p_shop);
return base||jsonb_build_object(
 'jobs',(select coalesce(jsonb_agg(j.metadata||jsonb_build_object('id',j.id,'customerId',j.customer_id,'service',j.service,'description',j.description,'amount',j.amount,'createdAt',j.created_at,'productionStatus',j.production_status,'version',j.version,'modifiedBy',j.modified_by,'modifiedByLabel',j.modified_by_label,'modifiedAt',j.modified_at,'lastEventId',j.last_event_id) order by j.created_at,j.id),'[]'::jsonb) from public.jobs j where j.shop_id=p_shop),
 'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'customerId',p.customer_id,'amount',p.amount,'method',p.method,'paidOn',p.paid_on,'reference',p.reference,'createdAt',p.created_at,'walletUsed',p.wallet_used,'walletAdded',p.wallet_added,'checkoutId',p.checkout_id,'allocations',coalesce((select jsonb_agg(jsonb_build_object('jobId',a.job_id,'amount',a.amount) order by a.job_id) from public.payment_allocations a where a.shop_id=p_shop and a.payment_id=p.id),'[]'::jsonb)) order by p.created_at,p.id),'[]'::jsonb) from public.payments p where p.shop_id=p_shop),
 'checkouts',(select coalesce(jsonb_agg(data order by created_at,id),'[]'::jsonb) from public.checkout_records where shop_id=p_shop),
 'materialHistory',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'materialId',material_id,'materialName',material_name,'measurementUnit',measurement_unit,'action',action,'beforeAvailable',before_available,'afterAvailable',after_available,'reason',reason,'changedBy',actor_id,'changedByLabel',actor_label,'changedAt',created_at,'before',before_values,'after',after_values,'detailsComplete',details_complete,'jobId',job_id,'checkoutId',checkout_id) order by created_at,id),'[]'::jsonb) from public.material_stock_changes where shop_id=p_shop));
end;$$;
revoke all on function public.get_ledger(uuid) from public,anon;
grant execute on function public.get_ledger(uuid) to authenticated;
commit;
