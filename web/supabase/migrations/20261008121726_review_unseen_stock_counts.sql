set local lock_timeout='5s';
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
 if not exists(select 1 from public.customers where shop_id=p_shop and id=c and not archived) then raise exception 'Select an active customer' using errcode='PT409';end if;
 if d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,c) then raise exception 'Customer balances changed. Review the latest account before syncing.' using errcode='PT409';end if;
 if jsonb_typeof(d->'jobs') is distinct from 'array' or jsonb_array_length(d->'jobs')>50 or jsonb_typeof(d->'allocations') is distinct from 'array' then raise exception 'Invalid checkout items';end if;
 cash:=(d->>'cashReceived')::numeric;wu:=(d->>'walletUsed')::numeric;wa:=(d->>'walletAdded')::numeric;
 if cash is null or wu is null or wa is null or cash<0 or wu<0 or wa<0 or cash>100000000000 or wu>100000000000 or wa>100000000000 or cash<>trunc(cash) or wu<>trunc(wu) or wa<>trunc(wa) then raise exception 'Invalid payment amounts';end if;
 select coalesce(sum(wallet_added-wallet_used),0) into wallet from public.payments where shop_id=p_shop and customer_id=c;
 if wu>wallet or (wu>0 and (d->>'useWallet')::boolean is distinct from true) or wallet-wu+wa>100000000000 then raise exception 'Wallet credit is unavailable';end if;
 if jsonb_typeof(d->'method') is distinct from 'string' or jsonb_typeof(d->'paidOn') is distinct from 'string' or jsonb_typeof(d->'createdAt') is distinct from 'string' or jsonb_typeof(d->'useWallet') is distinct from 'boolean' or d->>'method' not in ('Cash','POS','Transfer') or length(coalesce(d->>'reference',''))>200 or d->>'paidOn' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Invalid payment details';end if;
 if d ? 'methodLabel' and (jsonb_typeof(d->'methodLabel') is distinct from 'string' or length(btrim(d->>'methodLabel')) not between 1 and 80 or d->>'methodLabel' ~ '[\x00-\x1f\x7f]') then raise exception 'Invalid payment method name';end if;
 perform (d->>'paidOn')::date;perform (d->>'createdAt')::timestamptz;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 for line in select value from jsonb_array_elements(d->'jobs') loop
  item_id:=(line->>'id')::uuid;
  if item_id is null or item_id=any(seen) then raise exception 'Duplicate job ID';end if;seen:=array_append(seen,item_id);
  select * into svc from public.services where shop_id=p_shop and id=(line->>'serviceId')::uuid and not archived;
  if not found or svc.price is distinct from (line->>'unitPrice')::bigint or svc.version is distinct from (line->>'serviceVersion')::integer then raise exception 'Service or price changed. Review checkout.' using errcode='PT409';end if;
  mat := null;
  if svc.material_id is null then
    if line->'materialId' is distinct from 'null'::jsonb or line->'requireSize' is distinct from 'false'::jsonb or line->'width' is distinct from 'null'::jsonb or line->'height' is distinct from 'null'::jsonb then raise exception 'Service no longer uses a material. Review checkout.' using errcode='PT409';end if;
  else
    select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived for update;
    if not found or mat.id is distinct from (line->>'materialId')::uuid or mat.require_size is distinct from (line->>'requireSize')::boolean then raise exception 'Base material changed. Review checkout.' using errcode='PT409';end if;
  end if;
  if svc.material_id is not null and (line->>'stockCountEventId') is distinct from (select h.id::text from public.material_stock_changes h where h.shop_id=p_shop and h.material_id=svc.material_id and h.action='material.stock_set' order by h.created_at desc,h.id desc limit 1) then raise exception 'A stock count changed while this checkout was offline. An Admin must review whether its material usage was included in the count.' using errcode='PT409';end if;
  q:=(line->>'quantity')::numeric;w:=case when mat.require_size then (line->>'width')::numeric else 1 end;h:=case when mat.require_size then (line->>'height')::numeric else 1 end;
  if q is null or w is null or h is null or q<=0 or w<=0 or h<=0 or q>1000000 or w>1000000 or h>1000000 or q<>round(q,3) or w<>round(w,3) or h<>round(h,3) then raise exception 'Invalid quantity or dimensions';end if;
  needed:=case when svc.material_id is null then 0 else round(q*w*h,3) end;calculated:=round(svc.price*q*w*h);
  if needed<0 or (svc.material_id is not null and needed=0) or needed>1000000000000 or calculated<0 or calculated>100000000000 or calculated is distinct from (line->>'amount')::numeric or needed is distinct from (line->>'materialNeeded')::numeric then raise exception 'Invalid job calculation';end if;
  if jsonb_typeof(line->'description') is distinct from 'string' or length(btrim(line->>'description')) not between 1 and 500 or jsonb_typeof(line->'source') is distinct from 'string' or length(btrim(line->>'source')) not between 1 and 80 or line->>'source' ~ '[\x00-\x1f\x7f]' or length(coalesce(line->>'sourceNote',''))>200 then raise exception 'Invalid job description or source';end if;
  if line ? 'workflow' and not private.valid_job_workflow(line->'workflow') then raise exception 'Invalid job workflow';end if;
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
  if outstanding>job.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.shop_id=p_shop and pa.job_id=item_id),0) then raise exception 'A job balance changed. Review allocation.' using errcode='PT409';end if;
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
end;$function$
;
