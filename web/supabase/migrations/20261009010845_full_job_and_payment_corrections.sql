begin;
alter table public.payments add column if not exists method_label text;
alter table public.material_stock_changes drop constraint material_stock_changes_action_check;
alter table public.material_stock_changes add constraint material_stock_changes_action_check check(action in ('material.created','material.updated','material.stock_added','material.stock_set','material.archived','material.restored','material.job_used','material.expense_stock_changed','material.wasted','material.sale_returned','material.job_corrected'));
create or replace function private.adjustment_payment(p_shop uuid,p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'customerId',p.customer_id,'amount',p.amount,'method',p.method,'methodLabel',coalesce(p.method_label,cr.data->>'methodLabel',p.method),'paidOn',p.paid_on,'reference',p.reference,'createdAt',p.created_at,'walletUsed',p.wallet_used,'walletAdded',p.wallet_added,'checkoutId',p.checkout_id,'allocations',coalesce((select jsonb_agg(jsonb_build_object('jobId',a.job_id,'amount',a.amount) order by a.job_id) from public.payment_allocations a where a.shop_id=p_shop and a.payment_id=p.id),'[]'::jsonb)) from public.payments p left join public.checkout_records cr on cr.shop_id=p_shop and cr.id=p.id where p.shop_id=p_shop and p.id=p_id;
$$;
alter function public.get_ledger(uuid) rename to get_ledger_before_full_corrections;
revoke all on function public.get_ledger_before_full_corrections(uuid) from public,anon;
create function public.get_ledger(p_shop uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare base jsonb;
begin
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
 base=public.get_ledger_before_full_corrections(p_shop);
 return base||jsonb_build_object('payments',(select coalesce(jsonb_agg(item||case when p.method_label is not null then jsonb_build_object('methodLabel',p.method_label) else '{}'::jsonb end order by item->>'createdAt',item->>'id'),'[]') from jsonb_array_elements(base->'payments') item join public.payments p on p.shop_id=p_shop and p.id=(item->>'id')::uuid));
end;$$;
revoke all on function public.get_ledger(uuid) from public,anon;
grant execute on function public.get_ledger(uuid) to authenticated;
alter function private.apply_supervised_event(uuid,jsonb) rename to apply_supervised_event_v1;
create or replace function private.apply_supervised_event_v1(p_shop uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  select coalesce(sum(before_available-after_available),0) into usable from public.material_stock_changes where shop_id=p_shop and job_id=j.id and material_id=(j.metadata->>'materialId')::uuid and action in ('material.job_used','material.sale_returned','material.job_corrected');
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

create function private.apply_supervised_event(p_shop uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_event->'data';k text:=p_event->>'kind';e uuid:=(p_event->>'id')::uuid;u uuid:=auth.uid();label text;at_time timestamptz:=clock_timestamp();reason text:=btrim(d->>'reason');existing jsonb;existing_actor uuid;
 j public.jobs%rowtype;s public.services%rowtype;m public.materials%rowtype;p public.payments%rowtype;c public.checkout_records%rowtype;r record;before_job jsonb;after_job jsonb;before_pay jsonb;token jsonb;job_meta jsonb;rec jsonb;changes jsonb:='[]';stocks jsonb:='[]';saved_payments jsonb;
 qty numeric;w numeric;h numeric;raw numeric;needed numeric;price numeric;new_amount numeric;mid uuid;old_mid uuid;used numeric;target numeric;delta numeric;sid uuid;paid bigint;remaining bigint;move bigint;released bigint:=0;new_payment numeric;wallet bigint;difference bigint;cash_delta bigint:=0;methods jsonb:='{}';drawer_actor uuid;historical uuid;
begin
 if k not in ('sale.details_corrected','payment.corrected') then return private.apply_supervised_event_v1(p_shop,p_event);end if;
 perform 1 from public.shops where id=p_shop for update;
 select name into label from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action';end if;
 if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or reason is null or length(reason) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Invalid correction identity or reason';end if;
 select payload,actor_id into existing,existing_actor from public.ledger_events where shop_id=p_shop and id=e;
 if existing is not null then if existing<>p_event or existing_actor is distinct from u then raise exception 'Adjustment ID is already used';end if;return public.get_ledger(p_shop);end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid for update;
 if not found then raise exception 'Job not found';end if;
 if j.version is distinct from (d->>'baseVersion')::integer or d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,j.customer_id) then raise exception 'The job or customer account changed. Sync and reopen the correction.' using errcode='PT409';end if;
 before_job=private.adjustment_job(p_shop,j.id);job_meta=j.metadata;new_amount=j.amount;
 select coalesce(jsonb_agg(private.adjustment_payment(p_shop,id) order by id),'[]') into saved_payments from public.payments where shop_id=p_shop and customer_id=j.customer_id;
 if k='sale.details_corrected' then
  if j.production_status='Cancelled' then raise exception 'This sale is already cancelled';end if;
  select * into s from public.services where shop_id=p_shop and id=(d->>'serviceId')::uuid and not archived for share;
  if not found or s.version is distinct from (d->>'serviceVersion')::integer then raise exception 'Service changed. Sync and reopen the correction.' using errcode='PT409';end if;
  mid=nullif(d->>'materialId','')::uuid;old_mid=nullif(j.metadata->>'materialId','')::uuid;
  if mid is not null then select * into m from public.materials where shop_id=p_shop and id=mid and not archived for update;if not found then raise exception 'Choose an active material';end if;end if;
  qty=(d->>'quantity')::numeric;price=(d->>'unitPrice')::numeric;
  if qty is null or qty<=0 or qty>1000000 or qty<>round(qty,3) or price is null or price<0 or price>100000000000 or price<>trunc(price) or jsonb_typeof(d->'description') is distinct from 'string' or length(btrim(d->>'description')) not between 1 and 500 then raise exception 'Enter a valid quantity, price and description';end if;
  raw=qty;
  if mid is not null and m.require_size then w=(d->>'width')::numeric;h=(d->>'height')::numeric;if w is null or h is null or w<=0 or h<=0 or w>1000000 or h>1000000 or w<>round(w,3) or h<>round(h,3) then raise exception 'Enter valid dimensions with at most three decimals';end if;raw=qty*w*h;end if;
  needed=case when mid is null then 0 else round(raw,3) end;new_amount=round(raw*price);
  if raw<=0 or round(raw,3)<=0 or round(raw,3)>1000000000000 or new_amount>100000000000 then raise exception 'Job price or material usage is outside the supported range';end if;
  job_meta=job_meta||jsonb_build_object('serviceId',s.id,'serviceVersion',s.version,'materialId',mid,'quantity',qty,'width',w,'height',h,'unitPrice',price::bigint,'materialNeeded',needed,'measurementUnit',case when mid is null then 'item' else m.measurement_unit end,'requireSize',mid is not null and m.require_size);
  if coalesce(d->>'stockMode','') not in ('keep','reconcile') then raise exception 'Choose whether to correct the stock deduction or keep actual usage';end if;
  if d->>'stockMode'='reconcile' then
   for r in select distinct id from unnest(array[old_mid,mid]) id where id is not null order by id loop
    select greatest(0,coalesce(sum(before_available-after_available),0)) into used from public.material_stock_changes where shop_id=p_shop and job_id=j.id and material_id=r.id and action in ('material.job_used','material.sale_returned','material.job_corrected');
    target=0;if r.id=mid then target=case when mid=old_mid then used+needed-coalesce((j.metadata->>'materialNeeded')::numeric,0) else needed end;if target<0 then raise exception 'This stock was already covered by a stock count or was returned. Keep actual usage; do not restore unrecorded deductions.';end if;end if;
    delta=round(used-target,3);if delta=0 then continue;end if;
    select * into m from public.materials where shop_id=p_shop and id=r.id and not archived for update;
    sid=(d->'stockIds'->>r.id::text)::uuid;
    if not found or m.version is distinct from (d->'materialVersions'->>r.id::text)::integer or sid is null or sid=e then raise exception 'Material changed. Sync and reopen the correction.' using errcode='PT409';end if;
    insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,u,jsonb_build_object('id',sid,'kind','material.job_corrected','data',jsonb_build_object('id',m.id,'jobId',j.id,'checkoutId',j.metadata->>'checkoutId','reason',reason)));
    update public.materials set available=round(available+delta,3),version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=sid where shop_id=p_shop and id=m.id;
    stocks=stocks||jsonb_build_array(jsonb_build_object('materialId',m.id,'delta',delta));
   end loop;
  end if;
  if new_amount=j.amount and btrim(d->>'description')=j.description and job_meta=j.metadata and stocks='[]'::jsonb then raise exception 'Nothing changed';end if;
  select greatest(0,coalesce(sum(amount),0)-new_amount) into remaining from public.payment_allocations where shop_id=p_shop and job_id=j.id;released=remaining;
  for r in select p.id,a.amount from public.payment_allocations a join public.payments p on p.shop_id=a.shop_id and p.id=a.payment_id where a.shop_id=p_shop and a.job_id=j.id order by p.created_at desc,p.id desc loop
   exit when remaining=0;move=least(remaining,r.amount);
   if move=r.amount then delete from public.payment_allocations where shop_id=p_shop and payment_id=r.id and job_id=j.id;else update public.payment_allocations set amount=amount-move where shop_id=p_shop and payment_id=r.id and job_id=j.id;end if;
   update public.payments set wallet_added=wallet_added+move where shop_id=p_shop and id=r.id;remaining=remaining-move;
  end loop;
  update public.jobs set service=s.description,description=btrim(d->>'description'),amount=new_amount::bigint,metadata=job_meta where shop_id=p_shop and id=j.id;
 else
  select * into p from public.payments where shop_id=p_shop and id=(d->>'paymentId')::uuid and customer_id=j.customer_id for update;
  if not found or exists(select 1 from public.sale_adjustments where shop_id=p_shop and id=p.id and data->>'action'='sale.refunded') then raise exception 'Choose a payment for this customer';end if;
  before_pay=private.adjustment_payment(p_shop,p.id);token=before_pay-'id'-'customerId'-'createdAt'-'checkoutId';
  if d->'expectedPayment' is distinct from token then raise exception 'Payment changed. Sync and reopen the correction.' using errcode='PT409';end if;
  new_payment=(d->>'paymentAmount')::numeric;
  if new_payment is null or new_payment<0 or new_payment>100000000000 or new_payment<>trunc(new_payment) or coalesce(d->>'method','') not in ('Cash','POS','Transfer') or jsonb_typeof(d->'methodLabel') is distinct from 'string' or length(btrim(d->>'methodLabel')) not between 1 and 80 or jsonb_typeof(d->'reference') is distinct from 'string' or length(d->>'reference')>500 then raise exception 'Enter valid payment details';end if;
  if new_payment=p.amount and d->>'method'=p.method and d->>'methodLabel'=before_pay->>'methodLabel' and btrim(d->>'reference')=p.reference then raise exception 'Nothing changed';end if;
  difference=new_payment::bigint-p.amount;
  if difference>0 then
   remaining=difference;
   for r in select x.id,greatest(0,x.amount-coalesce((select sum(a.amount) from public.payment_allocations a where a.shop_id=p_shop and a.job_id=x.id),0)) as outstanding from public.jobs x where x.shop_id=p_shop and x.customer_id=j.customer_id and x.production_status<>'Cancelled' order by x.created_at,x.id loop
    move=least(remaining,r.outstanding);if move>0 then insert into public.payment_allocations(shop_id,payment_id,job_id,amount) values(p_shop,p.id,r.id,move) on conflict(shop_id,payment_id,job_id) do update set amount=public.payment_allocations.amount+excluded.amount;remaining=remaining-move;end if;exit when remaining=0;
   end loop;
   update public.payments set wallet_added=wallet_added+remaining where shop_id=p_shop and id=p.id;
  elsif difference<0 then
   remaining=-difference;select coalesce(sum(wallet_added-wallet_used),0) into wallet from public.payments where shop_id=p_shop and customer_id=j.customer_id;
   move=least(remaining,p.wallet_added,greatest(0,wallet));update public.payments set wallet_added=wallet_added-move where shop_id=p_shop and id=p.id;remaining=remaining-move;
   for r in select job_id,amount from public.payment_allocations where shop_id=p_shop and payment_id=p.id order by job_id desc loop
    move=least(remaining,r.amount);if move=r.amount then delete from public.payment_allocations where shop_id=p_shop and payment_id=p.id and job_id=r.job_id;elsif move>0 then update public.payment_allocations set amount=amount-move where shop_id=p_shop and payment_id=p.id and job_id=r.job_id;end if;remaining=remaining-move;exit when remaining=0;
   end loop;
   if remaining>0 then raise exception 'This payment credit has already been spent. Correct the dependent payments first.';end if;
  end if;
  update public.payments set amount=new_payment::bigint,method=d->>'method',method_label=d->>'methodLabel',reference=btrim(d->>'reference') where shop_id=p_shop and id=p.id;
  select * into c from public.checkout_records where shop_id=p_shop and id=coalesce(p.checkout_id,p.id);
  if found then historical=c.drawer_closing_id;if historical is null then drawer_actor=(c.data->>'createdBy')::uuid;end if;end if;
  cash_delta=(case when d->>'method'='Cash' then new_payment::bigint else 0 end)-(case when p.method='Cash' then p.amount else 0 end);
  methods=jsonb_build_object('Cash',cash_delta,'POS',(case when d->>'method'='POS' then new_payment::bigint else 0 end)-(case when p.method='POS' then p.amount else 0 end),'Transfer',(case when d->>'method'='Transfer' then new_payment::bigint else 0 end)-(case when p.method='Transfer' then p.amount else 0 end));
 end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 update public.jobs set version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=e where shop_id=p_shop and id=j.id;
 after_job=private.adjustment_job(p_shop,j.id);
 for r in select value as prior from jsonb_array_elements(saved_payments) loop
  before_pay=private.adjustment_payment(p_shop,(r.prior->>'id')::uuid);if before_pay<>r.prior then changes=changes||jsonb_build_array(jsonb_build_object('before',r.prior,'after',before_pay));end if;
 end loop;
 rec=jsonb_build_object('id',e,'jobId',j.id,'customerId',j.customer_id,'action',k,'reason',reason,'changedBy',u,'changedByLabel',label,'changedAt',at_time,'before',before_job,'after',after_job,'creditReleased',released,'refundAmount',0,'returnQuantity',0,'paymentChanges',changes,'stockChanges',stocks,'stockMode',d->>'stockMode','cashDelta',cash_delta,'methodDeltas',methods,'drawerActor',drawer_actor,'historicalClosingId',historical,'paymentId',case when k='payment.corrected' then p.id else null end,'event',p_event);
 insert into public.sale_adjustments(shop_id,id,job_id,actor_id,created_at,data) values(p_shop,e,j.id,u,at_time,rec);
 return public.get_ledger(p_shop);
end;$$;
revoke all on function private.apply_supervised_event(uuid,jsonb) from public,anon;
grant execute on function private.apply_supervised_event(uuid,jsonb) to authenticated;
create or replace function public.finish_drawer_handover(p_shop uuid,p_actor uuid,p_receiver uuid,p_id uuid,p_counted bigint,p_checkouts uuid[],p_opening uuid,p_note text,p_refunds uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.shop_members%rowtype;receiver public.shop_members%rowtype;existing public.drawer_closings%rowtype;
 ids uuid[];refund_ids uuid[];cash_refunded bigint;total_refunded bigint;opening public.drawer_closings%rowtype;last_closed timestamptz;at_time timestamptz;
 cash_correction bigint;cash bigint;collected bigint;pos bigint;transfer bigint;wallet bigint;sales bigint;opening_cash bigint;result jsonb;
begin
 if p_shop is null or p_actor is null or p_receiver is null or p_id is null or p_actor=p_receiver or p_counted is null or p_counted<0 or p_counted>100000000000 or p_checkouts is null or length(coalesce(p_note,''))>500 then raise exception 'Invalid drawer handover';end if;
 perform 1 from public.shops where id=p_shop for update;
 select * into actor from public.shop_members where shop_id=p_shop and user_id=p_actor and not archived and access_level>0 for share;
 if not found then raise exception 'Current user access is unavailable';end if;
 select * into receiver from public.shop_members where shop_id=p_shop and user_id=p_receiver and not archived and access_level>0 for share;
 if not found then raise exception 'Receiving user access is unavailable';end if;
 select * into existing from public.drawer_closings where shop_id=p_shop and id=p_id;
 if found then
  if existing.from_user<>p_actor or existing.to_user<>p_receiver or (existing.data->>'countedCash')::bigint<>p_counted or existing.data->>'note'<>coalesce(p_note,'') or coalesce((existing.data->>'openingId')::uuid,'00000000-0000-0000-0000-000000000000')<>coalesce(p_opening,'00000000-0000-0000-0000-000000000000') or (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(existing.data->'checkoutIds')) is distinct from (select array_agg(x order by x) from unnest(p_checkouts) x) then raise exception 'Handover ID is already used';end if;
  if coalesce((select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(existing.data->'refundIds')),'{}'::uuid[]) is distinct from coalesce((select array_agg(x order by x) from unnest(p_refunds) x),'{}'::uuid[]) then raise exception 'Handover ID is already used';end if;
  return existing.data;
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from public.checkout_records where shop_id=p_shop and (data->>'createdBy')::uuid=p_actor and drawer_closing_id is null;
 if ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_checkouts) x) then raise exception 'Your unclosed transactions changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 select max(closed_at) into last_closed from public.drawer_closings where shop_id=p_shop and from_user=p_actor;
 select * into opening from public.drawer_closings where shop_id=p_shop and to_user=p_actor and (last_closed is null or closed_at>last_closed) order by closed_at desc,id desc limit 1;
 if opening.id is distinct from p_opening then raise exception 'Opening cash changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 opening_cash=coalesce((opening.data->>'countedCash')::bigint,0);
 select coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Cash'),0),coalesce(sum((data->>'cashReceived')::bigint),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='POS'),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Transfer'),0),coalesce(sum((data->>'walletUsed')::bigint),0),coalesce(sum((data->>'total')::bigint),0)
 into cash,collected,pos,transfer,wallet,sales from public.checkout_records where shop_id=p_shop and id=any(ids);
 select coalesce(array_agg(id order by id),'{}'::uuid[]),coalesce(sum((data->>'refundAmount')::bigint) filter(where data->>'action'='sale.refunded' and data->>'method'='Cash'),0),coalesce(sum((data->>'refundAmount')::bigint),0) into refund_ids,cash_refunded,total_refunded from public.sale_adjustments where shop_id=p_shop and drawer_closing_id is null and ((actor_id=p_actor and data->>'action'='sale.refunded') or (data->>'action'='payment.corrected' and (data->>'drawerActor')::uuid=p_actor));
 if refund_ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_refunds) x) then raise exception 'Refunds changed. Review the refreshed drawer before retrying.' using errcode='40001';end if;
 select coalesce(sum((data->>'cashDelta')::bigint),0) into cash_correction from public.sale_adjustments where shop_id=p_shop and id=any(refund_ids) and data->>'action'='payment.corrected';
 select pos+coalesce(sum((data->'methodDeltas'->>'POS')::bigint),0),transfer+coalesce(sum((data->'methodDeltas'->>'Transfer')::bigint),0),collected+coalesce(sum((data->'methodDeltas'->>'Cash')::bigint+(data->'methodDeltas'->>'POS')::bigint+(data->'methodDeltas'->>'Transfer')::bigint),0) into pos,transfer,collected from public.sale_adjustments where shop_id=p_shop and id=any(refund_ids) and data->>'action'='payment.corrected';
 at_time=clock_timestamp();
 result=jsonb_build_object('id',p_id,'fromUserId',p_actor,'fromUserLabel',actor.name,'toUserId',p_receiver,'toUserLabel',receiver.name,'closedAt',at_time,'checkoutIds',to_jsonb(ids),'openingId',opening.id,'openingCash',opening_cash,'cashCollected',cash,'totalCollected',collected,'posCollected',pos,'transferCollected',transfer,'walletUsed',wallet,'jobSales',sales,'refundIds',to_jsonb(refund_ids),'cashCorrection',cash_correction,'cashRefunded',cash_refunded,'totalRefunded',total_refunded,'expectedCash',opening_cash+cash+cash_correction-cash_refunded,'countedCash',p_counted,'difference',p_counted-opening_cash-cash-cash_correction+cash_refunded,'note',coalesce(p_note,''));
 insert into public.drawer_closings(shop_id,id,from_user,to_user,closed_at,data) values(p_shop,p_id,p_actor,p_receiver,at_time,result);
 update public.checkout_records set drawer_closing_id=p_id where shop_id=p_shop and id=any(ids);
 update public.sale_adjustments set drawer_closing_id=p_id where shop_id=p_shop and id=any(refund_ids);
 return result;
end;$$;

commit;
