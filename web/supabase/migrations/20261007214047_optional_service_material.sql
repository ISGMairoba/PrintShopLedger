begin;
alter table public.services alter column material_id drop not null;
CREATE OR REPLACE FUNCTION public.apply_service_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_data jsonb := p_event->'data';
  v_kind text := p_event->>'kind';
  v_event uuid := (p_event->>'id')::uuid;
  v_id uuid := (v_data->>'id')::uuid;
  v_user uuid := auth.uid();
  v_existing jsonb;
  v_actor uuid;
  v_label text;
  v_service public.services%rowtype;
  v_material public.materials%rowtype;
  v_price numeric;
  v_service_exists boolean;
begin
  if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>0 and role in ('admin','manager','developer')) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing service identifier'; end if;
  if (v_data->>'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id=p_shop for update;
if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2) then raise exception 'Business access denied'; end if;
  select payload,actor_id into v_existing,v_actor from public.ledger_events where shop_id=p_shop and id=v_event;
  if found then
    if v_existing<>p_event or v_actor<>v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),email,id::text) into v_label from auth.users where id=v_user;
  select * into v_service from public.services where id=v_id and shop_id=p_shop for update;
  v_service_exists := found;
  if v_kind='service.created' then
    if v_service_exists then raise exception 'Service ID already exists'; end if;
  else
    if not v_service_exists then raise exception 'Service not found'; end if;
    if (v_data->>'baseVersion')::integer is distinct from v_service.version then raise exception 'Service changed elsewhere. Review the latest version.' using errcode='40001'; end if;
  end if;
  if v_kind in ('service.created','service.updated') then
    if jsonb_typeof(v_data->'description') is distinct from 'string' or length(btrim(v_data->>'description')) not between 1 and 500 then raise exception 'Enter a service description (up to 500 characters)'; end if;
    if jsonb_typeof(v_data->'price') is distinct from 'number' then raise exception 'Price must be a number'; end if;
    v_price := (v_data->>'price')::numeric;
    if v_price<0 or v_price>100000000000 or v_price<>trunc(v_price) then raise exception 'Price must be non-negative integer kobo'; end if;
    if not (v_data ? 'materialId') then raise exception 'Select a base material or No material'; end if;
    v_material := null;
    if v_data->'materialId' <> 'null'::jsonb then
      select * into v_material from public.materials where shop_id=p_shop and id=(v_data->>'materialId')::uuid;
      if not found then raise exception 'Choose a base material from this workspace' using errcode='P0002'; end if;
      if v_material.archived and (not v_service_exists or v_material.id is distinct from v_service.material_id) then raise exception 'Choose an active base material' using errcode='P0002'; end if;
    end if;
    if v_kind='service.created' then
      insert into public.services(id,shop_id,description,material_id,price,created_by,created_by_label,modified_by,modified_by_label,last_event_id)
        values(v_id,p_shop,btrim(v_data->>'description'),v_material.id,v_price::bigint,v_user,v_label,v_user,v_label,v_event);
    else
      if v_service.archived then raise exception 'Restore this service before editing it'; end if;
      update public.services set description=btrim(v_data->>'description'),material_id=v_material.id,price=v_price::bigint,
        modified_by=v_user,modified_by_label=v_label,modified_at=now(),version=version+1,last_event_id=v_event where id=v_id and shop_id=p_shop;
    end if;
  elsif v_kind in ('service.archived','service.restored') then
    if v_service.archived=(v_kind='service.archived') then raise exception 'Service is already in that state'; end if;
    update public.services set archived=(v_kind='service.archived'),modified_by=v_user,modified_by_label=v_label,
      modified_at=now(),version=version+1,last_event_id=v_event where id=v_id and shop_id=p_shop;
  else raise exception 'Unknown service operation'; end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,v_event,v_user,p_event);
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_checkout_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  mat := null;
  if svc.material_id is null then
    if line->'materialId' is distinct from 'null'::jsonb or line->'requireSize' is distinct from 'false'::jsonb or line->'width' is distinct from 'null'::jsonb or line->'height' is distinct from 'null'::jsonb then raise exception 'Service no longer uses a material. Review checkout.' using errcode='40001';end if;
  else
    select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived for update;
    if not found or mat.id is distinct from (line->>'materialId')::uuid or mat.require_size is distinct from (line->>'requireSize')::boolean then raise exception 'Base material changed. Review checkout.' using errcode='40001';end if;
  end if;
  q:=(line->>'quantity')::numeric;w:=case when mat.require_size then (line->>'width')::numeric else 1 end;h:=case when mat.require_size then (line->>'height')::numeric else 1 end;
  if q is null or w is null or h is null or q<=0 or w<=0 or h<=0 or q>1000000 or w>1000000 or h>1000000 or q<>round(q,3) or w<>round(w,3) or h<>round(h,3) then raise exception 'Invalid quantity or dimensions';end if;
  needed:=case when svc.material_id is null then 0 else round(q*w*h,3) end;calculated:=round(svc.price*q*w*h);
  if needed<0 or (svc.material_id is not null and needed=0) or needed>1000000000000 or calculated<0 or calculated>100000000000 or calculated is distinct from (line->>'amount')::numeric or needed is distinct from (line->>'materialNeeded')::numeric then raise exception 'Invalid job calculation';end if;
  if jsonb_typeof(line->'description') is distinct from 'string' or length(btrim(line->>'description')) not between 1 and 500 or jsonb_typeof(line->'source') is distinct from 'string' or line->>'source' not in ('In shop / USB','Shop network','WhatsApp','Email','Other') or length(coalesce(line->>'sourceNote',''))>200 then raise exception 'Invalid job description or source';end if;
  total:=total+calculated;
  insert into public.jobs(shop_id,id,customer_id,service,description,amount,created_at,metadata,modified_by,modified_by_label,modified_at,last_event_id)
   values(p_shop,item_id,c,svc.description,btrim(line->>'description'),calculated,(d->>'createdAt')::timestamptz,line||jsonb_build_object('customerId',c,'service',svc.description,'materialId',svc.material_id,'materialNeeded',needed,'requireSize',coalesce(mat.require_size,false),'measurementUnit',coalesce(mat.measurement_unit,'item'),'createdBy',u,'createdByLabel',label,'checkoutId',e,'checkoutPosition',jsonb_array_length(to_jsonb(seen))-1,'productionStatus','Added','version',1),u,label,now(),e);
  if svc.material_id is not null then
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,item_id,u,jsonb_build_object('id',item_id,'kind','material.job_used','data',jsonb_build_object('id',mat.id,'jobId',item_id,'checkoutId',e,'reason','Checkout '||e||' / Job '||item_id)));
  update public.materials set available=available-needed,version=version+1,modified_by=u,modified_by_label=label,modified_at=now(),last_event_id=item_id where shop_id=p_shop and id=mat.id;
  end if;
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
end;$function$;

commit;
