set local lock_timeout='5s';
create or replace function private.valid_job_workflow(stages jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(stages) is distinct from 'array' then return false;end if;
 if jsonb_array_length(stages) not between 3 and 20 or stages->>0 is distinct from 'Added' or stages->>(jsonb_array_length(stages)-2) is distinct from 'Completed' or stages->>(jsonb_array_length(stages)-1) is distinct from 'Collected' then return false;end if;
 if exists(select 1 from jsonb_array_elements(stages) v where jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}')) not between 1 and 80 or v#>>'{}' ~ '[\x00-\x1f\x7f]') then return false;end if;
 return (select count(distinct lower(btrim(v)))=count(*) from jsonb_array_elements_text(stages) v);
end $$;
create or replace function private.check_business_options() returns trigger language plpgsql security invoker set search_path='' as $$
declare options jsonb:=new.settings->'options';key text;items jsonb;limit_length integer;
begin
 if options is null then return new;end if; -- Older clients and saved profiles remain compatible.
 if jsonb_typeof(options) is distinct from 'object' then raise exception 'Invalid business dropdown settings';end if;
 for key,limit_length in select * from(values('expenseCategories',80),('jobSources',80),('stockReasons',200),('materialUnits',40)) x(key,max_length) loop
  items:=options->key;
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid % options',key;end if;
  if jsonb_array_length(items) not between 1 and 30 then raise exception '% needs 1–30 options',key;end if;
  if exists(select 1 from jsonb_array_elements(items) v where jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}')) not between 1 and limit_length or v#>>'{}' ~ '[\x00-\x1f\x7f]') or (select count(distinct lower(btrim(v)))<>count(*) from jsonb_array_elements_text(items) v) then raise exception 'Invalid or duplicate % names',key;end if;
 end loop;
 if not private.valid_job_workflow(options->'jobStages') then raise exception 'Stages must start with Added and end with Completed then Collected';end if;
 items:=options->'paymentMethods';
 if jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid payment methods';end if;
 if jsonb_array_length(items) not between 1 and 30 then raise exception 'Enter 1–30 payment methods';end if;
 if exists(select 1 from jsonb_array_elements(items) v where jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'label') is distinct from 'string' or length(btrim(v->>'label')) not between 1 and 80 or v->>'label' ~ '[\x00-\x1f\x7f]' or coalesce(v->>'kind','') not in ('Cash','POS','Transfer') or jsonb_typeof(v->'enabled') is distinct from 'boolean') then raise exception 'Invalid payment method name or accounting type';end if;
 if (select count(distinct lower(btrim(v->>'label')))<>count(*) from jsonb_array_elements(items) v) or not exists(select 1 from jsonb_array_elements(items) v where v->'enabled'='true') then raise exception 'Use unique payment names and keep at least one enabled';end if;
 return new;
end $$;
create trigger check_business_options before insert or update on public.business_settings for each row execute function private.check_business_options();
alter table public.jobs drop constraint jobs_production_status_check;
alter table public.jobs add constraint jobs_production_status_check check (
 case when metadata ? 'workflow' then private.valid_job_workflow(metadata->'workflow') and (metadata->'workflow') ? production_status
 else production_status in ('Added','In Queue','Printing','Completed','Collected') end
);

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
select stages.value into next_status from jsonb_array_elements_text(coalesce(j.metadata->'workflow','["Added","In Queue","Printing","Completed","Collected"]'::jsonb)) with ordinality stages(value,position)
 where stages.position=(select current_stage.position+1 from jsonb_array_elements_text(coalesce(j.metadata->'workflow','["Added","In Queue","Printing","Completed","Collected"]'::jsonb)) with ordinality current_stage(value,position) where current_stage.value=j.production_status);
if j.version is distinct from (d->>'baseVersion')::integer or next_status is null or next_status is distinct from d->>'status' then raise exception 'Job status changed. Review the latest version.' using errcode='PT409';end if;
select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();
insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,auth.uid(),p_event);
update public.jobs set production_status=next_status,version=version+1,modified_by=auth.uid(),modified_by_label=label,modified_at=now(),last_event_id=e where shop_id=p_shop and id=j.id;
end;$function$
;

CREATE OR REPLACE FUNCTION private.check_business_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s jsonb:=new.settings;field text;max_length integer;
begin
 if jsonb_typeof(s)<>'object' or octet_length(s::text)>400000 then raise exception 'Invalid business settings';end if;
 for field,max_length in select * from(values('businessName',160),('address',500),('phones',200),('email',200),('website',300),('socials',500)) as fields(name,size) loop
  if jsonb_typeof(s->field) is distinct from 'string' or length(s->>field)>max_length or (s->>field)~'[\x00-\x08\x0b\x0c\x0e-\x1f]' then raise exception 'Invalid %',field;end if;
 end loop;
 if length(btrim(s->>'businessName'))=0 then raise exception 'Enter the business name';end if;
 if s->>'email'<>'' and s->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
 if s->>'website'<>'' and s->>'website'!~*'^https?://[^[:space:]]+$' then raise exception 'Invalid website';end if;
 if jsonb_typeof(s->'logo') is distinct from 'string' or length(s->>'logo')>350000 or (s->>'logo'<>'' and s->>'logo'!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$') then raise exception 'Invalid logo';end if;
 if coalesce(s->>'primary','')!~*'^#[0-9a-f]{6}$' or coalesce(s->>'accent','')!~*'^#[0-9a-f]{6}$' or coalesce(s->>'theme','') not in('light','dark','system') then raise exception 'Invalid appearance';end if;
 if jsonb_typeof(s->'receipt') is distinct from 'object' then raise exception 'Invalid receipt settings';end if;
 foreach field in array array['showLogo','showAddress','showContacts'] loop if jsonb_typeof(s->'receipt'->field) is distinct from 'boolean' then raise exception 'Invalid receipt option';end if;end loop;
 if jsonb_typeof(s->'receipt'->'footer') is distinct from 'string' or length(s->'receipt'->>'footer')>500 then raise exception 'Invalid receipt footer';end if;
 if tg_op='UPDATE' and new.shop_id<>old.shop_id then raise exception 'Cannot move business settings';end if;
 new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;new.modified_at:=now();new.modified_by:=auth.uid();return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.get_ledger(p_shop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare base jsonb;
begin
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
 base:=public.get_ledger_before_expenses(p_shop);
 return base||jsonb_build_object(
 'payments',(select coalesce(jsonb_agg(p||case when cr.data ? 'methodLabel' then jsonb_build_object('methodLabel',cr.data->'methodLabel') else '{}'::jsonb end order by p->>'createdAt',p->>'id'),'[]'::jsonb) from jsonb_array_elements(base->'payments') p left join public.checkout_records cr on cr.shop_id=p_shop and cr.id=(p->>'id')::uuid),
 'expenses',(select coalesce(jsonb_agg(data order by data->>'incurredOn',id),'[]'::jsonb) from public.expenses where shop_id=p_shop),
 'expenseHistory',(select coalesce(jsonb_agg(data order by data->>'changedAt',id),'[]'::jsonb) from public.expense_changes where shop_id=p_shop),
 'materialHistory',(select coalesce(jsonb_agg(v||jsonb_build_object('expenseId',h.expense_id) order by v->>'changedAt',v->>'id'),'[]'::jsonb) from jsonb_array_elements(base->'materialHistory') v left join public.material_stock_changes h on h.shop_id=p_shop and h.id=(v->>'id')::uuid)
 );
end;$function$
;

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
  if p ? 'methodLabel' and (jsonb_typeof(p->'methodLabel') is distinct from 'string' or length(btrim(p->>'methodLabel')) not between 1 and 80 or p->>'methodLabel' ~ '[\x00-\x1f\x7f]') then raise exception 'Invalid payment method name';end if;
  p:=jsonb_build_object('methodLabel',coalesce(p->>'methodLabel',p->>'method'),'id',(p->>'id')::uuid,'amount',paid::bigint,'paidOn',day,'method',p->>'method','source',p->>'source','reference',btrim(p->>'reference'),'createdBy',u,'createdByLabel',label,'createdAt',now());
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
