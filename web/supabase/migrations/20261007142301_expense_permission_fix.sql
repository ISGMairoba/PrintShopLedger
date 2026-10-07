begin;
create or replace function public.apply_expense_event(p_shop uuid,p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
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
  if (d->>'baseVersion')::integer is distinct from (old->>'version')::integer then raise exception 'Expense changed elsewhere. Review the business version.' using errcode='40001';end if;
  if (old->>'voided')::boolean then raise exception 'Voided expense cannot be changed' using errcode='40001';end if;
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
   if m.archived and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Restore material before changing purchased quantity' using errcode='40001';end if;
   if line->>'measurementUnit' is distinct from m.measurement_unit and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Material unit changed. Review purchased quantity.' using errcode='40001';end if;
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
   if old_line is not null and old_line->>'measurementUnit' is distinct from m.measurement_unit then raise exception 'Material unit changed. Restore original unit before adjusting purchase.' using errcode='40001';end if;
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
end;$$;
commit;
