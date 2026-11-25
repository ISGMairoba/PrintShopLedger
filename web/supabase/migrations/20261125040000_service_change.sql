-- Changing a sold job's service when a pricing template is involved (owner, 25 Nov): a normal service
-- to a template, a template to a normal service, or one template to another (or new inputs).
-- Kind sale.service_changed, through apply_supervised_event (Admin and above, Sale Adjustments).
--   * Only while its materials are not confirmed.
--   * A template is priced again here (private.price_template_snapshot), as at checkout.
--   * Stock, when put right: per material, what the job took less what the new one needs, as
--     material.job_corrected changes dated now. Refused when a later stock count already
--     reconciled the usage, so nothing is given back twice. Or the stock is kept as used.
--   * Money paid beyond the new amount becomes the customer's credit, as for details corrections.
-- The app does the same (web/src/service-change.mjs). Normal to normal stays sale.details_corrected.

create or replace function private.change_job_service(p_shop uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare d jsonb:=p_event->'data';k text:=p_event->>'kind';e uuid:=(p_event->>'id')::uuid;u uuid:=auth.uid();label text;at_time timestamptz:=clock_timestamp();reason text:=btrim(d->>'reason');
 existing jsonb;existing_actor uuid;j public.jobs%rowtype;s public.services%rowtype;m public.materials%rowtype;r record;
 before_job jsonb;after_job jsonb;before_pay jsonb;job_meta jsonb;snap jsonb;saved_payments jsonb;changes jsonb:='[]';stocks jsonb:='[]';rec jsonb;
 qty numeric;w numeric;h numeric;raw numeric;needed numeric:=0;price numeric;new_amount numeric;mid uuid;new_service text;used numeric;target numeric;delta numeric;sid uuid;remaining bigint;move bigint;released bigint:=0;
begin
 if k is distinct from 'sale.service_changed' then raise exception 'Invalid correction';end if;
 select name into label from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action';end if;
 if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or reason is null or length(reason) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Invalid correction identity or reason';end if;
 select payload,actor_id into existing,existing_actor from public.ledger_events where shop_id=p_shop and id=e;
 if existing is not null then if existing<>p_event or existing_actor is distinct from u then raise exception 'Adjustment ID is already used';end if;return public.get_ledger(p_shop);end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid for update;
 if not found then raise exception 'Job not found';end if;
 if j.production_status='Cancelled' then raise exception 'This sale is already cancelled';end if;
 if j.metadata ? 'materialUsed' or j.metadata->'materialCheck'->>'status'='confirmed' then raise exception 'Its materials are confirmed. Cancel the job and add the right one.';end if;
 if j.version is distinct from (d->>'baseVersion')::integer or not private.account_token_ok(d->>'expectedAccount',p_shop,j.customer_id) then raise exception 'The job or customer account changed. Sync and reopen the correction.' using errcode='PT409';end if;
 if jsonb_typeof(d->'description') is distinct from 'string' or length(btrim(d->>'description')) not between 1 and 500 then raise exception 'Enter a job description (up to 500 characters)';end if;
 qty:=(d->>'quantity')::numeric;
 if qty is null or qty<=0 or qty>1000000 or qty<>round(qty,3) then raise exception 'Enter a valid quantity';end if;
 before_job:=private.adjustment_job(p_shop,j.id);
 select coalesce(jsonb_agg(private.adjustment_payment(p_shop,id) order by id),'[]') into saved_payments from public.payments where shop_id=p_shop and customer_id=j.customer_id;
 job_meta:=j.metadata-'templateSnapshot'-'templateInputs'-'materialChoice'-'materialCheck'-'materialCorrection'-'discount'-'lineDiscount'-'grossAmount'-'stockCountEventId';

 if d->>'target'='template' then
  snap:=private.price_template_snapshot(p_shop,d->'templateSnapshot',qty);
  if d->'templateInputs' is distinct from snap->'inputs' then raise exception 'Template input snapshot changed';end if;
  if d->>'serviceId' is distinct from snap->'template'->>'id' or (d->>'serviceVersion')::integer is distinct from (snap->'template'->>'version')::integer then raise exception 'Invalid template job';end if;
  new_amount:=(snap->'price'->>'amount')::numeric;
  if round(new_amount/qty) is distinct from (d->>'unitPrice')::numeric or new_amount>100000000000 then raise exception 'Invalid template job calculation';end if;
  if snap ? 'choices' then
   if d->'materialChoice' is distinct from private.template_material_choice(snap->'choices',d->'materialChoice') then raise exception 'The materials for this template changed. Reopen the correction.' using errcode='PT409';end if;
   job_meta:=job_meta||jsonb_build_object('materialChoice',d->'materialChoice');
  elsif d ? 'materialChoice' then raise exception 'Invalid material choice';end if;
  new_service:=snap->'template'->>'name';
  job_meta:=job_meta||jsonb_build_object('serviceId',snap->'template'->>'id','serviceVersion',(snap->'template'->>'version')::integer,'quantity',qty,
    'unitPrice',round(new_amount/qty)::bigint,'materialId',null,'materialNeeded',0,'measurementUnit','item','requireSize',false,'width',null,'height',null,
    'templateInputs',snap->'inputs','templateSnapshot',snap);
 elsif d->>'target'='service' then
  if not (j.metadata ? 'templateSnapshot') then raise exception 'Correct a normal job with "Correct quantity / size / service / material"';end if;
  select * into s from public.services where shop_id=p_shop and id=(d->>'serviceId')::uuid and not archived for share;s:=private.branch_service(p_shop,s);perform private.assert_sold_here(p_shop,s);
  if s.id is null or s.version is distinct from (d->>'serviceVersion')::integer then raise exception 'Service changed. Sync and reopen the correction.' using errcode='PT409';end if;
  if s.private then raise exception '% is used in templates only and cannot be sold',s.description;end if;
  if cardinality(s.material_options)>0 then raise exception 'A service with a choice of materials can''t be switched to. Cancel the job and add it again.';end if;
  mid:=nullif(d->>'materialId','')::uuid;
  if mid is not null then select * into m from public.materials where shop_id=p_shop and id=mid and not archived for update;m:=private.at_location(p_shop,m);if m.id is null then raise exception 'Choose an active material';end if;end if;
  price:=(d->>'unitPrice')::numeric;
  if price is null or price<0 or price>100000000000 or price<>trunc(price) then raise exception 'Enter a valid unit price';end if;
  raw:=qty;
  if mid is not null and m.require_size then w:=(d->>'width')::numeric;h:=(d->>'height')::numeric;if w is null or h is null or w<=0 or h<=0 or w>1000000 or h>1000000 or w<>round(w,3) or h<>round(h,3) then raise exception 'Enter valid dimensions with at most three decimals';end if;raw:=qty*w*h;end if;
  needed:=case when mid is null then 0 else round(raw*private.per_item(s.production),3) end;new_amount:=round(raw*price);
  if raw<=0 or round(raw,3)<=0 or round(raw,3)>1000000000000 or new_amount>100000000000 then raise exception 'Job price or material usage is outside the supported range';end if;
  new_service:=s.description;
  job_meta:=job_meta||jsonb_build_object('serviceId',s.id,'serviceVersion',s.version,'materialId',mid,'quantity',qty,'width',w,'height',h,'unitPrice',price::bigint,
    'materialNeeded',needed,'measurementUnit',case when mid is null then 'item' else m.measurement_unit end,'requireSize',mid is not null and m.require_size,
    'stockCountEventId',(select x.id::text from public.material_stock_changes x where x.shop_id=p_shop and x.material_id=mid and x.action='material.stock_set' order by x.created_at desc,x.id desc limit 1));
 else raise exception 'Choose the new service';
 end if;

 if coalesce(d->>'stockMode','') not in ('keep','reconcile') then raise exception 'Choose whether to correct the stock deduction or keep actual usage';end if;
 if d->>'stockMode'='reconcile' then
  for r in select distinct t.id from (
     select x.material_id id from public.material_stock_changes x where x.shop_id=p_shop and x.job_id=j.id and x.action in ('material.job_used','material.sale_returned','material.job_corrected')
     union select (y->>'materialId')::uuid from jsonb_array_elements(coalesce(job_meta->'templateSnapshot'->'stock','[]')) y
     union select nullif(job_meta->>'materialId','')::uuid) t where t.id is not null order by t.id loop
   select greatest(0,coalesce(sum(coalesce(x.before_available,x.after_available)-x.after_available),0)) into used from public.material_stock_changes x where x.shop_id=p_shop and x.job_id=j.id and x.material_id=r.id and x.action in ('material.job_used','material.sale_returned','material.job_corrected');
   target:=coalesce((select sum((y->>'quantity')::numeric) from jsonb_array_elements(coalesce(job_meta->'templateSnapshot'->'stock','[]')) y where y->>'materialId'=r.id::text),0)
     +case when job_meta->>'materialId'=r.id::text then coalesce((job_meta->>'materialNeeded')::numeric,0) else 0 end;
   delta:=round(round(used,3)-target,3);if delta=0 then continue;end if;
   if delta>0 and exists(select 1 from public.material_stock_changes counted where counted.shop_id=p_shop and counted.material_id=r.id and counted.action='material.stock_set' and counted.id is distinct from nullif(j.metadata->>'stockCountEventId','')::uuid and counted.created_at>=(select min(x.created_at) from public.material_stock_changes x where x.shop_id=p_shop and x.job_id=j.id and x.material_id=r.id and x.action in ('material.job_used','material.job_corrected'))) then raise exception 'A later stock count already reconciled this usage. Keep actual usage and current stock.';end if;
   select * into m from public.materials where shop_id=p_shop and id=r.id and not archived for update;m:=private.at_location(p_shop,m);
   sid:=(d->'stockIds'->>r.id::text)::uuid;
   if m.id is null or m.version is distinct from (d->'materialVersions'->>r.id::text)::integer or sid is null or sid=e or exists(select 1 from public.ledger_events where shop_id=p_shop and id=sid) then raise exception 'Material changed. Sync and reopen the correction.' using errcode='PT409';end if;
   insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,u,jsonb_build_object('id',sid,'kind','material.job_corrected','data',jsonb_build_object('id',m.id,'jobId',j.id,'checkoutId',j.metadata->>'checkoutId','reason',reason)));
   update public.materials set available=round(m.available+delta,3),version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=sid where shop_id=p_shop and id=m.id;
   stocks:=stocks||jsonb_build_array(jsonb_build_object('materialId',m.id,'delta',delta));
  end loop;
 end if;
 if new_amount=j.amount and btrim(d->>'description')=j.description and job_meta=j.metadata and stocks='[]'::jsonb then raise exception 'Nothing changed';end if;

 -- Money paid beyond the new amount becomes the customer's credit (newest payments first).
 select greatest(0,coalesce(sum(amount),0)-new_amount) into remaining from public.payment_allocations where shop_id=p_shop and job_id=j.id;released:=remaining;
 for r in select pay.id,a.amount from public.payment_allocations a join public.payments pay on pay.shop_id=a.shop_id and pay.id=a.payment_id where a.shop_id=p_shop and a.job_id=j.id order by pay.created_at desc,pay.id desc loop
  exit when remaining=0;move:=least(remaining,r.amount);
  if move=r.amount then delete from public.payment_allocations where shop_id=p_shop and payment_id=r.id and job_id=j.id;else update public.payment_allocations set amount=amount-move where shop_id=p_shop and payment_id=r.id and job_id=j.id;end if;
  update public.payments set wallet_added=wallet_added+move where shop_id=p_shop and id=r.id;remaining:=remaining-move;
 end loop;
 update public.jobs set service=new_service,description=btrim(d->>'description'),amount=new_amount::bigint,metadata=job_meta where shop_id=p_shop and id=j.id;

 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 update public.jobs set version=version+1,modified_by=u,modified_by_label=label,modified_at=at_time,last_event_id=e where shop_id=p_shop and id=j.id;
 after_job:=private.adjustment_job(p_shop,j.id);
 for r in select value as prior from jsonb_array_elements(saved_payments) loop
  before_pay:=private.adjustment_payment(p_shop,(r.prior->>'id')::uuid);if before_pay<>r.prior then changes:=changes||jsonb_build_array(jsonb_build_object('before',r.prior,'after',before_pay));end if;
 end loop;
 rec:=jsonb_build_object('id',e,'jobId',j.id,'customerId',j.customer_id,'action',k,'reason',reason,'changedBy',u,'changedByLabel',label,'changedAt',at_time,'before',before_job,'after',after_job,
   'creditReleased',released,'refundAmount',0,'returnQuantity',0,'paymentChanges',changes,'stockChanges',stocks,'stockMode',d->>'stockMode','cashDelta',0,'methodDeltas','{}'::jsonb,
   'drawerActor',null,'historicalClosingId',null,'paymentId',null,'event',p_event);
 insert into public.sale_adjustments(shop_id,id,job_id,actor_id,created_at,data) values(p_shop,e,j.id,u,at_time,rec);
 return public.get_ledger(p_shop);
end $f$;
revoke all on function private.change_job_service(uuid,jsonb) from public, anon, authenticated;

-- Route it from the supervised corrections (after their Admin and page checks).
do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure);
  if position('change_job_service' in d) = 0 then
    pat := '(if k=''sale\.refunded'' and coalesce\(d->>''jobId'',''''\)='''' then return private\.refund_credit\(p_shop,p_event\);end if;)';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_supervised_event_v2 pattern not found'; end if;
    d := regexp_replace(d, pat, $r$if k='sale.service_changed' then return private.change_job_service(p_shop,p_event);end if;
 \1$r$);
    execute d;
  end if;
end $patch$;
