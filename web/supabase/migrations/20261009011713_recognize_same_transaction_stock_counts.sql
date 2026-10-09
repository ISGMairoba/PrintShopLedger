create or replace function private.apply_supervised_event(p_shop uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
    if exists(select 1 from public.material_stock_changes counted where counted.shop_id=p_shop and counted.material_id=r.id and counted.action='material.stock_set' and counted.id is distinct from nullif(j.metadata->>'stockCountEventId','')::uuid and counted.created_at>=(select min(usage_event.created_at) from public.material_stock_changes usage_event where usage_event.shop_id=p_shop and usage_event.job_id=j.id and usage_event.material_id=r.id and usage_event.action in ('material.job_used','material.job_corrected'))) then raise exception 'A later stock count already reconciled this usage. Keep actual usage and current stock.';end if;
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
  for r in select pay.id,a.amount from public.payment_allocations a join public.payments pay on pay.shop_id=a.shop_id and pay.id=a.payment_id where a.shop_id=p_shop and a.job_id=j.id order by pay.created_at desc,pay.id desc loop
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

