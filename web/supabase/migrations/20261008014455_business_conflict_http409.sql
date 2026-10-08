-- Business conflicts must return HTTP 409, never retryable serialization failures.

CREATE OR REPLACE FUNCTION private.apply_expense_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d jsonb:=p_event->'data';k text:=p_event->>'kind';eid uuid:=(p_event->>'id')::uuid;xid uuid:=(d->>'id')::uuid;u uuid:=auth.uid();
 old jsonb;nxt jsonb;prior jsonb;prior_actor uuid;label text;audit jsonb;
 lines jsonb:='[]';old_lines jsonb:='[]';line jsonb;old_line jsonb;m public.materials%rowtype;
 total numeric;paid numeric;qty numeric;delta numeric;v_available numeric;mid uuid;stockid uuid;reason text;child jsonb;
 payments jsonb:='[]';p jsonb;day date;delta_count integer:=0;stock_ids jsonb:=d->'stockIds';
begin
 if u is null or not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2) then raise exception 'Business administrator access required';end if;
 if eid is null or xid is null then raise exception 'Missing expense identifier';end if;
 if (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Audit identity must match signed-in staff';end if;
 perform 1 from public.shops where id=p_shop for update;
 select payload,actor_id into prior,prior_actor from public.ledger_events where shop_id=p_shop and id=eid;
 if found then if prior<>p_event or prior_actor<>u then raise exception 'Operation ID already used';end if;return;end if;
 select data into old from public.expenses where shop_id=p_shop and id=xid for update;
 if k='expense.created' then if old is not null then raise exception 'Expense ID already exists';end if;
 else
  if old is null then raise exception 'Expense not found' using errcode='P0002';end if;
  if (d->>'baseVersion')::integer is distinct from (old->>'version')::integer then raise exception 'Expense changed elsewhere. Review the business version.' using errcode='PT409';end if;
  if (old->>'voided')::boolean then raise exception 'Voided expense cannot be changed' using errcode='PT409';end if;
 end if;
 select coalesce(nullif(btrim(mb.name),''),au.email,u::text) into label from public.shop_members mb join auth.users au on au.id=mb.user_id where mb.shop_id=p_shop and mb.user_id=u;
 audit:=jsonb_build_object('modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now(),'lastEventId',eid);
 old_lines:=coalesce(old->'materials','[]'::jsonb);
 payments:=coalesce(old->'payments','[]'::jsonb);
 if k in ('expense.created','expense.updated') then
  if jsonb_typeof(d->'description') is distinct from 'string' or length(btrim(d->>'description')) not between 1 and 500 then raise exception 'Enter a description up to 500 characters';end if;
  if jsonb_typeof(d->'category') is distinct from 'string' or length(btrim(d->>'category')) not between 1 and 80 then raise exception 'Enter a category up to 80 characters';end if;
  if jsonb_typeof(d->'payee') is distinct from 'string' or length(d->>'payee')>160 or jsonb_typeof(d->'note') is distinct from 'string' or length(d->>'note')>1000 or jsonb_typeof(d->'receiptReference') is distinct from 'string' or length(d->>'receiptReference')>160 then raise exception 'Supplier, note or receipt reference is invalid';end if;
  if jsonb_typeof(d->'amount') is distinct from 'number' then raise exception 'Expense amount must be numeric';end if;
  total:=(d->>'amount')::numeric;
  if total<=0 or total>100000000000 or total<>trunc(total) then raise exception 'Expense amount must be positive integer kobo';end if;
  if coalesce(d->>'incurredOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid incurred date';end if;
  day:=(d->>'incurredOn')::date;
  if jsonb_typeof(d->'materials') is distinct from 'array' or jsonb_array_length(d->'materials')>50 then raise exception 'Choose at most 50 materials';end if;
  if (select count(*) from jsonb_array_elements(d->'materials'))<>(select count(distinct v->>'materialId') from jsonb_array_elements(d->'materials') v) then raise exception 'Choose each material once';end if;
  for line in select value from jsonb_array_elements(d->'materials') loop
   select * into m from public.materials where shop_id=p_shop and id=(line->>'materialId')::uuid;
   if not found then raise exception 'Choose a material from this business' using errcode='P0002';end if;
   if jsonb_typeof(line->'quantity') is distinct from 'number' then raise exception 'Purchased quantity must be numeric';end if;
   qty:=(line->>'quantity')::numeric;
   if qty<=0 or qty>1000000000000 or qty<>round(qty,3) then raise exception 'Purchased quantity must be positive with at most three decimal places';end if;
   select v into old_line from jsonb_array_elements(old_lines) v where v->>'materialId'=m.id::text;
   if m.archived and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Restore material before changing purchased quantity' using errcode='PT409';end if;
   if line->>'measurementUnit' is distinct from m.measurement_unit and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Material unit changed. Review purchased quantity.' using errcode='PT409';end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('materialId',m.id,'name',coalesce(old_line->>'name',m.name),'measurementUnit',line->>'measurementUnit','quantity',qty));
  end loop;
  if k='expense.updated' and d ? 'payment' then raise exception 'Use Record payment for additional payments';end if;
  nxt:=coalesce(old,'{}'::jsonb)||jsonb_build_object('id',xid,'description',btrim(d->>'description'),'category',btrim(d->>'category'),'incurredOn',day,'amount',total::bigint,'payee',btrim(d->>'payee'),'note',btrim(d->>'note'),'receiptReference',btrim(d->>'receiptReference'),'materials',lines,'payments',payments,'voided',false,'voidReason','','version',coalesce((old->>'version')::integer,0)+1,'createdBy',coalesce(old->'createdBy',to_jsonb(u)),'createdByLabel',coalesce(old->'createdByLabel',to_jsonb(label)),'createdAt',coalesce(old->'createdAt',to_jsonb(now())))||audit;
 elsif k='expense.payment_recorded' then
  nxt:=old||audit||jsonb_build_object('version',(old->>'version')::integer+1);lines:=old_lines;
  if not d ? 'payment' then raise exception 'Payment is required';end if;
 elsif k='expense.voided' then
  if jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason')) not between 1 and 500 then raise exception 'Enter a void reason up to 500 characters';end if;
  nxt:=old||audit||jsonb_build_object('voided',true,'voidReason',btrim(d->>'reason'),'version',(old->>'version')::integer+1);
 else raise exception 'Unknown expense operation';end if;
 if k in ('expense.created','expense.payment_recorded') and d ? 'payment' then
  p:=d->'payment';
  if (p->>'id')::uuid is null or jsonb_typeof(p->'amount') is distinct from 'number' then raise exception 'Payment identity and amount required';end if;
  paid:=(p->>'amount')::numeric;
  if paid<=0 or paid>100000000000 or paid<>trunc(paid) then raise exception 'Payment must be positive integer kobo';end if;
  if coalesce(p->>'paidOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid payment date';end if;
  day:=(p->>'paidOn')::date;
  if coalesce(p->>'method','') not in ('Cash','POS','Transfer') or coalesce(p->>'source','') not in ('Business cash','Business bank account','Personal funds','Other') then raise exception 'Choose payment method and source';end if;
  if jsonb_typeof(p->'reference') is distinct from 'string' or length(p->>'reference')>160 then raise exception 'Invalid payment reference';end if;
  if exists(select 1 from jsonb_array_elements(payments) v where v->>'id'=p->>'id') then raise exception 'Payment ID already used';end if;
  p:=jsonb_build_object('id',(p->>'id')::uuid,'amount',paid::bigint,'paidOn',day,'method',p->>'method','source',p->>'source','reference',btrim(p->>'reference'),'createdBy',u,'createdByLabel',label,'createdAt',now());
  payments:=payments||jsonb_build_array(p);nxt:=nxt||jsonb_build_object('payments',payments);
 end if;
 select coalesce(sum((v->>'amount')::bigint),0) into paid from jsonb_array_elements(payments) v;
 if paid>(nxt->>'amount')::bigint then raise exception 'Recorded payments exceed the expense amount';end if;
 if jsonb_typeof(stock_ids) is distinct from 'object' then raise exception 'Stock update identifiers required';end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,eid,u,p_event);
 if old is null then insert into public.expenses(id,shop_id,data) values(xid,p_shop,nxt);
 else update public.expenses set data=nxt where shop_id=p_shop and id=xid;end if;
 if k<>'expense.payment_recorded' then
  for mid in select distinct (v->>'materialId')::uuid from jsonb_array_elements(old_lines||lines) v order by 1 loop
   select coalesce(sum((v->>'quantity')::numeric),0) into qty from jsonb_array_elements(old_lines) v where (v->>'materialId')::uuid=mid;
   select coalesce(sum((v->>'quantity')::numeric),0)-qty into delta from jsonb_array_elements(lines) v where (v->>'materialId')::uuid=mid;
   if delta=0 then continue;end if;
   delta_count:=delta_count+1;stockid:=(stock_ids->>mid::text)::uuid;
   if stockid is null or stockid=eid then raise exception 'Stock identifier invalid';end if;
   select * into m from public.materials where shop_id=p_shop and id=mid for update;
   if not found then raise exception 'Material not found' using errcode='P0002';end if;
   select v into old_line from jsonb_array_elements(old_lines) v where (v->>'materialId')::uuid=mid;
   if old_line is not null and old_line->>'measurementUnit' is distinct from m.measurement_unit then raise exception 'Material unit changed. Restore original unit before adjusting purchase.' using errcode='PT409';end if;
   v_available:=m.available+delta;
   if abs(v_available)>1000000000000 then raise exception 'Available quantity exceeds supported limit';end if;
   reason:=left((case when k='expense.voided' then 'Voided purchase' when old is null then 'Purchase restocking' else 'Purchase correction' end)||' · EXP-'||upper(left(replace(xid::text,'-',''),8))||case when k='expense.voided' then ' · '||(nxt->>'voidReason') else '' end,500);
   child:=jsonb_build_object('id',stockid,'kind','material.expense_stock_changed','data',jsonb_build_object('id',mid,'expenseId',xid,'expenseEventId',eid,'quantity',delta,'reason',reason,'modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now()));
   insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,stockid,u,child);
   update public.materials set available=v_available,version=version+1,modified_by=u,modified_by_label=label,modified_at=now(),last_event_id=stockid where shop_id=p_shop and id=mid;
  end loop;
 end if;
 if (select count(*) from jsonb_object_keys(stock_ids))<>delta_count or (select count(distinct value) from jsonb_each_text(stock_ids))<>delta_count then raise exception 'Stock identifiers do not match quantity changes';end if;
 insert into public.expense_changes(id,shop_id,expense_id,data) values(eid,p_shop,xid,jsonb_build_object('id',eid,'expenseId',xid,'action',k,'before',old,'after',nxt,'changedBy',u,'changedByLabel',label,'changedAt',now(),'event',p_event));
end;$function$
;

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

CREATE OR REPLACE FUNCTION public.apply_customer_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_data jsonb:=p_event->'data';
  v_kind text:=p_event->>'kind';
  v_event uuid:=(p_event->>'id')::uuid;
  v_id uuid:=(v_data->>'id')::uuid;
  v_user uuid:=auth.uid();
  v_label text;
  v_existing jsonb;
  v_actor uuid;
  v_customer public.customers%rowtype;
  v_limit numeric;
  v_legacy boolean:=v_kind='customer.created' and v_data->>'modifiedBy' is null;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing customer identifier'; end if;
  if not v_legacy and (v_data->>'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id=p_shop for update;
if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  select payload,actor_id into v_existing,v_actor from public.ledger_events where shop_id=p_shop and id=v_event;
  if found then
    if v_existing<>p_event or v_actor<>v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),email,id::text) into v_label from auth.users where id=v_user;
  select * into v_customer from public.customers where shop_id=p_shop and id=v_id for update;
  if v_kind='customer.created' then
    if found then raise exception 'Customer ID already exists'; end if;
  else
    if not found then raise exception 'Customer not found'; end if;
    if (v_data->>'baseVersion')::integer is distinct from v_customer.version then raise exception 'Customer changed elsewhere. Review the latest version.' using errcode='PT409'; end if;
  end if;
  if v_kind in ('customer.created','customer.updated') then
    if jsonb_typeof(v_data->'name') is distinct from 'string' or length(btrim(v_data->>'name')) not between 1 and 160 then raise exception 'Enter a full name (up to 160 characters)'; end if;
    if jsonb_typeof(coalesce(v_data->'phone','""'::jsonb)) is distinct from 'string' or length(btrim(coalesce(v_data->>'phone',''))) > 40 or
      (not v_legacy and length(btrim(coalesce(v_data->>'phone','')))=0) then raise exception 'Enter a phone number (up to 40 characters)'; end if;
    if jsonb_typeof(coalesce(v_data->'address','""'::jsonb)) is distinct from 'string' or length(btrim(coalesce(v_data->>'address','')))>500 then raise exception 'Address must be up to 500 characters'; end if;
    if jsonb_typeof(coalesce(v_data->'creditLimit','0'::jsonb)) is distinct from 'number' then raise exception 'Credit limit must be a number'; end if;
    v_limit:=coalesce((v_data->>'creditLimit')::numeric,0);
    if v_limit<0 or v_limit>100000000000 or v_limit<>trunc(v_limit) then raise exception 'Credit limit must be non-negative integer kobo'; end if;
    if v_kind='customer.created' then
      insert into public.customers(shop_id,id,name,phone,address,credit_limit,created_at,created_by,created_by_label,modified_by,modified_by_label,modified_at,last_event_id)
      values(p_shop,v_id,btrim(v_data->>'name'),btrim(coalesce(v_data->>'phone','')),btrim(coalesce(v_data->>'address','')),v_limit::bigint,
        now(),v_user,v_label,v_user,v_label,now(),v_event);
    else
      if v_customer.archived then raise exception 'Restore this customer before editing'; end if;
      update public.customers set name=btrim(v_data->>'name'),phone=btrim(v_data->>'phone'),address=btrim(coalesce(v_data->>'address','')),credit_limit=v_limit::bigint,
        modified_by=v_user,modified_by_label=v_label,modified_at=now(),version=version+1,last_event_id=v_event where shop_id=p_shop and id=v_id;
    end if;
  elsif v_kind in ('customer.archived','customer.restored') then
    if v_customer.archived=(v_kind='customer.archived') then raise exception 'Customer is already in that state'; end if;
    update public.customers set archived=(v_kind='customer.archived'),modified_by=v_user,modified_by_label=v_label,
      modified_at=now(),version=version+1,last_event_id=v_event where shop_id=p_shop and id=v_id;
  else raise exception 'Unknown customer operation'; end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,v_event,v_user,p_event);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_job_status_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
if j.version is distinct from (d->>'baseVersion')::integer or next_status is null or next_status is distinct from d->>'status' then raise exception 'Job status changed. Review the latest version.' using errcode='PT409';end if;
select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();
insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,auth.uid(),p_event);
update public.jobs set production_status=next_status,version=version+1,modified_by=auth.uid(),modified_by_label=label,modified_at=now(),last_event_id=e where shop_id=p_shop and id=j.id;
end;$function$
;

CREATE OR REPLACE FUNCTION public.apply_material_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = 'PT409';
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
$function$
;

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
    if (v_data->>'baseVersion')::integer is distinct from v_service.version then raise exception 'Service changed elsewhere. Review the latest version.' using errcode='PT409'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.finish_drawer_handover(p_shop uuid, p_actor uuid, p_receiver uuid, p_id uuid, p_counted bigint, p_checkouts uuid[], p_opening uuid, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare actor public.shop_members%rowtype;receiver public.shop_members%rowtype;existing public.drawer_closings%rowtype;
 ids uuid[];opening public.drawer_closings%rowtype;last_closed timestamptz;at_time timestamptz;
 cash bigint;collected bigint;pos bigint;transfer bigint;wallet bigint;sales bigint;opening_cash bigint;result jsonb;
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
  return existing.data;
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from public.checkout_records where shop_id=p_shop and (data->>'createdBy')::uuid=p_actor and drawer_closing_id is null;
 if ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_checkouts) x) then raise exception 'Your unclosed transactions changed. Review the refreshed drawer totals before retrying.' using errcode='PT409';end if;
 select max(closed_at) into last_closed from public.drawer_closings where shop_id=p_shop and from_user=p_actor;
 select * into opening from public.drawer_closings where shop_id=p_shop and to_user=p_actor and (last_closed is null or closed_at>last_closed) order by closed_at desc,id desc limit 1;
 if opening.id is distinct from p_opening then raise exception 'Opening cash changed. Review the refreshed drawer totals before retrying.' using errcode='PT409';end if;
 opening_cash=coalesce((opening.data->>'countedCash')::bigint,0);
 select coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Cash'),0),coalesce(sum((data->>'cashReceived')::bigint),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='POS'),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Transfer'),0),coalesce(sum((data->>'walletUsed')::bigint),0),coalesce(sum((data->>'total')::bigint),0)
 into cash,collected,pos,transfer,wallet,sales from public.checkout_records where shop_id=p_shop and id=any(ids);
 at_time=clock_timestamp();
 result=jsonb_build_object('id',p_id,'fromUserId',p_actor,'fromUserLabel',actor.name,'toUserId',p_receiver,'toUserLabel',receiver.name,'closedAt',at_time,'checkoutIds',to_jsonb(ids),'openingId',opening.id,'openingCash',opening_cash,'cashCollected',cash,'totalCollected',collected,'posCollected',pos,'transferCollected',transfer,'walletUsed',wallet,'jobSales',sales,'expectedCash',opening_cash+cash,'countedCash',p_counted,'difference',p_counted-opening_cash-cash,'note',coalesce(p_note,''));
 insert into public.drawer_closings(shop_id,id,from_user,to_user,closed_at,data) values(p_shop,p_id,p_actor,p_receiver,at_time,result);
 update public.checkout_records set drawer_closing_id=p_id where shop_id=p_shop and id=any(ids);
 return result;
end;$function$
;

CREATE OR REPLACE FUNCTION public.save_business_settings(p_shop uuid, p_version integer, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result public.business_settings%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid() and not m.archived and m.access_level>=3) then raise exception 'Manager or Developer access required';end if;
 perform 1 from public.shops where id=p_shop for update;
 if p_version=0 then
  insert into public.business_settings(shop_id,settings,modified_by)values(p_shop,p_settings,auth.uid())on conflict do nothing returning * into result;
 else
  update public.business_settings set settings=p_settings where shop_id=p_shop and version=p_version returning * into result;
 end if;
 if result.shop_id is null then raise exception 'Business settings changed. Reload the saved version before editing.' using errcode='PT409';end if;
 return to_jsonb(result);
end $function$
;

CREATE OR REPLACE FUNCTION public.save_shop_user_internal(p_shop uuid, p_action text, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.shop_members%rowtype; v_actor public.shop_members%rowtype; v_user uuid; v_name text; v_username text; v_role text; v_rank integer; v_access integer;
begin
 perform 1 from public.shops where id=p_shop for update;
 select * into v_actor from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2;
 if not found then raise exception 'User management access denied'; end if;
 if p_action is null or p_action not in ('create','edit','archive','restore','grant','revoke') then raise exception 'Unknown user action'; end if;
 if p_action in ('create','edit') then
  v_name=btrim(p_data->>'name');v_username=lower(btrim(p_data->>'username'));v_role=p_data->>'role';
  v_rank=case v_role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 when 'developer' then 4 end;
  if v_name is null or length(v_name) not between 1 and 160 or v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' or v_rank is null then raise exception 'Invalid user details'; end if;
  if v_rank>v_actor.rank then raise exception 'Cannot assign a rank above your own'; end if;
 end if;
 if p_action='create' then
  v_user=(p_data->>'userId')::uuid;
  if not exists(select 1 from auth.users where id=v_user and created_at>now()-interval '10 minutes')
   or exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'Account is not eligible for creation'; end if;
  insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
  values(p_shop,v_user,v_role,v_name,v_username,v_rank,v_rank,auth.uid(),auth.uid());
 else
  select * into v_row from public.shop_members where shop_id=p_shop and id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'User not found'; end if;
  if v_row.version is distinct from (p_data->>'version')::integer then raise exception 'User changed on another device. Refresh and try again' using errcode='PT409'; end if;
  if not (v_actor.rank=4 or v_actor.user_id=v_row.user_id or v_actor.rank>v_row.rank) then raise exception 'You cannot modify this user rank'; end if;
  if v_row.rank=4 and v_actor.rank<>4 then raise exception 'Only a Developer can modify a Developer'; end if;
  if p_action='edit' and v_row.archived then raise exception 'Restore this user before editing'; end if;
  if p_action='grant' and v_row.archived then raise exception 'Restore this user before granting access'; end if;
  v_rank=case when p_action='edit' then v_rank else v_row.rank end;
  v_access=case when p_action='revoke' then 0 when p_action='grant' then v_row.rank when p_action='edit' and v_row.access_level>0 then v_rank else v_row.access_level end;
  if not v_row.archived and v_row.access_level>0 and v_row.rank>=3 and (p_action in ('archive','revoke') or v_rank<3)
   and not exists(select 1 from public.shop_members where shop_id=p_shop and user_id<>v_row.user_id and not archived and access_level>=3)
   then raise exception 'Keep at least one active Manager or Developer'; end if;
  update public.shop_members set name=case when p_action='edit' then v_name else name end,
   username=case when p_action='edit' then v_username else username end,role=case when p_action='edit' then v_role else role end,
   rank=v_rank,access_level=v_access,archived=case when p_action='archive' then true when p_action='restore' then false else archived end,
   modified_at=now(),modified_by=auth.uid(),version=version+1 where shop_id=p_shop and id=v_row.id;
 end if;
end; $function$
;
