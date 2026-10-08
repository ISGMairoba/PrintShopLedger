create or replace function private.apply_supervised_event(p_shop uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_event->'data';k text:=p_event->>'kind';e uuid:=(p_event->>'id')::uuid;u uuid:=auth.uid();label text;at_time timestamptz:=clock_timestamp();reason text:=btrim(d->>'reason');existing jsonb;actor uuid;
 j public.jobs%rowtype;m public.materials%rowtype;r record;before_job jsonb;before_pay jsonb;after_job jsonb;changes jsonb:='[]';rec jsonb;
 new_amount bigint;requested numeric;paid bigint;remaining bigint;move bigint;released bigint:=0;refund bigint:=0;wallet bigint;returned numeric:=coalesce((d->>'returnQuantity')::numeric,0);usable numeric;stock_id uuid;next_stock numeric;day date;
begin
 perform 1 from public.shops where id=p_shop for update;
 select name into label from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action';end if;
 if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or reason is null or length(reason) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u or k is null or k not in ('sale.corrected','sale.cancelled','sale.refunded','material.wasted') then raise exception 'Invalid adjustment identity, action or reason';end if;
 select payload,actor_id into existing,actor from public.ledger_events where shop_id=p_shop and id=e;
 if existing is not null then
  if existing<>p_event or actor is distinct from u then raise exception 'Adjustment ID is already used';end if;
  return public.get_ledger(p_shop);
 end if;
 if k='material.wasted' then
  select * into m from public.materials where shop_id=p_shop and id=(d->>'materialId')::uuid for update;
  if not found or m.archived then raise exception 'Choose an active material';end if;
  if m.version is distinct from (d->>'baseVersion')::integer then raise exception 'Material changed. Sync and reopen the waste entry.' using errcode='PT409';end if;
  requested=(d->>'quantity')::numeric;
  if requested is null or requested<=0 or requested>1000000000000 or requested<>round(requested,3) or coalesce(d->>'category','') not in ('Waste','Damage','Reprint') then raise exception 'Choose a waste type and a positive quantity with at most three decimals';end if;
  if nullif(d->>'jobId','') is not null and not exists(select 1 from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid) then raise exception 'Linked job not found';end if;
  if nullif(d->>'jobId','') is not null and not exists(select 1 from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid and metadata->>'materialId'=m.id::text) then raise exception 'Linked job must use the selected material';end if;
  next_stock=round(m.available-requested,3);
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
  update public.materials set available=next_stock,version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=e where shop_id=p_shop and id=m.id;
  rec=jsonb_build_object('id',e,'materialId',m.id,'materialName',m.name,'measurementUnit',m.measurement_unit,'quantity',requested,'category',d->>'category','jobId',nullif(d->>'jobId','')::uuid,'reason',reason,'changedBy',u,'changedByLabel',label,'changedAt',at_time,'beforeAvailable',m.available,'afterAvailable',next_stock,'event',p_event);
  insert into public.material_waste(shop_id,id,material_id,job_id,actor_id,created_at,data) values(p_shop,e,m.id,nullif(d->>'jobId','')::uuid,u,at_time,rec);
  return public.get_ledger(p_shop);
 end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid for update;
 if not found then raise exception 'Job not found';end if;
 if j.version is distinct from (d->>'baseVersion')::integer or d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,j.customer_id) then raise exception 'The job or customer account changed. Sync and reopen the adjustment.' using errcode='PT409';end if;
 if j.production_status='Cancelled' and k<>'sale.refunded' then raise exception 'This sale is already cancelled';end if;
 before_job=private.adjustment_job(p_shop,j.id);new_amount=j.amount;
 if k='sale.corrected' then
  requested=(d->>'amount')::numeric;
  if requested is null or requested<0 or requested>100000000000 or requested<>trunc(requested) or jsonb_typeof(d->'description') is distinct from 'string' or length(btrim(d->>'description')) not between 1 and 500 then raise exception 'Enter a valid charge and description';end if;
  new_amount=requested::bigint;
  if new_amount=j.amount and btrim(d->>'description')=j.description then raise exception 'Nothing changed';end if;
 elsif k='sale.cancelled' then new_amount=0;
 end if;
 select coalesce(sum(amount),0) into paid from public.payment_allocations where shop_id=p_shop and job_id=j.id;
 remaining=greatest(0,paid-new_amount);released=remaining;
 for r in select p.id,a.amount from public.payment_allocations a join public.payments p on p.shop_id=a.shop_id and p.id=a.payment_id where a.shop_id=p_shop and a.job_id=j.id order by p.created_at desc,p.id desc loop
  exit when remaining=0;
  move=least(remaining,r.amount);before_pay=private.adjustment_payment(p_shop,r.id);
  if move=r.amount then delete from public.payment_allocations where shop_id=p_shop and payment_id=r.id and job_id=j.id;
  else update public.payment_allocations set amount=amount-move where shop_id=p_shop and payment_id=r.id and job_id=j.id;end if;
  update public.payments set wallet_added=wallet_added+move where shop_id=p_shop and id=r.id;
  changes=changes||jsonb_build_array(jsonb_build_object('before',before_pay,'after',private.adjustment_payment(p_shop,r.id)));remaining=remaining-move;
 end loop;
 if k='sale.refunded' then
  requested=(d->>'refundAmount')::numeric;
  select coalesce(sum(wallet_added-wallet_used),0) into wallet from public.payments where shop_id=p_shop and customer_id=j.customer_id;
  if requested is null or requested<=0 or requested>100000000000 or requested<>trunc(requested) or requested>wallet then raise exception 'Refund exceeds available customer credit. Reduce the sale or cancel it first if money is still allocated.';end if;
  if coalesce(d->>'method','') not in ('Cash','POS','Transfer') or jsonb_typeof(d->'methodLabel') is distinct from 'string' or length(btrim(d->>'methodLabel')) not between 1 and 80 then raise exception 'Choose a refund payment method';end if;
  day=(d->>'paidOn')::date;
  if day is null or day<>(at_time at time zone 'Africa/Lagos')::date then raise exception 'Refunds must be recorded on the day money is returned';end if;
  refund=requested::bigint;
  insert into public.payments(shop_id,id,customer_id,amount,method,paid_on,reference,created_at,wallet_used,wallet_added) values(p_shop,e,j.customer_id,0,d->>'method',day,'Refund '||upper(left(e::text,8)),at_time,refund,0);
 end if;
 if returned<0 or returned<>round(returned,3) or returned>1000000000000 or returned>0 and k<>'sale.cancelled' then raise exception 'Invalid returned stock quantity';end if;
 if returned>0 then
  select coalesce(sum(before_available-after_available),0) into usable from public.material_stock_changes where shop_id=p_shop and job_id=j.id and action in ('material.job_used','material.sale_returned');
  if returned>greatest(0,usable) then raise exception 'Returned stock cannot exceed recorded material usage';end if;
  select * into m from public.materials where shop_id=p_shop and id=(j.metadata->>'materialId')::uuid for update;
  if not found or m.archived or m.version is distinct from (d->>'materialVersion')::integer then raise exception 'Material changed. Sync and reopen the cancellation.' using errcode='PT409';end if;
  stock_id=(d->>'stockEventId')::uuid;if stock_id is null or stock_id=e then raise exception 'A separate stock event ID is required';end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,stock_id,u,jsonb_build_object('id',stock_id,'kind','material.sale_returned','data',jsonb_build_object('id',m.id,'jobId',j.id,'checkoutId',j.metadata->>'checkoutId','reason',reason)));
  update public.materials set available=round(available+returned,3),version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=stock_id where shop_id=p_shop and id=m.id;
 end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 update public.jobs set amount=new_amount,description=case when k='sale.corrected' then btrim(d->>'description') else description end,production_status=case when k='sale.cancelled' then 'Cancelled' else production_status end,version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=e where shop_id=p_shop and id=j.id;
 after_job=private.adjustment_job(p_shop,j.id);
 rec=jsonb_build_object('id',e,'jobId',j.id,'customerId',j.customer_id,'action',k,'reason',reason,'changedBy',u,'changedByLabel',label,'changedAt',at_time,'before',before_job,'after',after_job,'creditReleased',released,'refundAmount',refund,'method',d->>'method','methodLabel',d->>'methodLabel','paidOn',day,'returnQuantity',returned,'paymentChanges',changes,'event',p_event);
 insert into public.sale_adjustments(shop_id,id,job_id,actor_id,created_at,data) values(p_shop,e,j.id,u,at_time,rec);
 return public.get_ledger(p_shop);
end;$$;
