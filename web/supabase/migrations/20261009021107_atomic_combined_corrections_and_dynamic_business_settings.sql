-- Preserve the audited single-action handler; the wrapper composes it inside one transaction.
alter function private.apply_supervised_event(uuid,jsonb) rename to apply_supervised_event_v2;
revoke all on function private.apply_supervised_event_v2(uuid,jsonb) from public,anon,authenticated;
create function private.apply_supervised_event(p_shop uuid,p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_event->'data';e uuid:=(p_event->>'id')::uuid;u uuid:=auth.uid();k text:=p_event->>'kind';j public.jobs%rowtype;old_job jsonb;new_job jsonb;label text;prior jsonb;prior_actor uuid;edits jsonb;edit jsonb;pay jsonb;original_pay jsonb;token jsonb;child jsonb;child_id uuid;details_id uuid;child_ids jsonb:='[]';saved_payments jsonb;changes jsonb:='[]';stocks jsonb:='[]';released bigint:=0;rec jsonb;current_version integer;job_changed boolean;requires_size boolean;role_access integer;configured jsonb;ids uuid[];payment_ids uuid[];entry record;now_at timestamptz:=clock_timestamp();
begin
 perform 1 from public.shops where id=p_shop for update;
 select access_level,name into role_access,label from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action';end if;
 select settings->'pageAccess'->role_access::text into configured from public.business_settings where shop_id=p_shop;
 if role_access=2 and configured is not null and not configured ? (case when k='material.wasted' then 'Material Waste' else 'Sale Adjustments' end) then raise exception 'Page access denied';end if;
 if k<>'sale.combined_corrected' then return private.apply_supervised_event_v2(p_shop,p_event);end if;
 if e is null or jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason')) not between 1 and 500 or (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Invalid correction identity or reason';end if;
 select payload,actor_id into prior,prior_actor from public.ledger_events where shop_id=p_shop and id=e;
 if prior is not null then if prior<>p_event or prior_actor is distinct from u then raise exception 'Adjustment ID is already used';end if;return public.get_ledger(p_shop);end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid for update;
 if not found or j.version is distinct from (d->>'baseVersion')::integer or d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,j.customer_id) then raise exception 'The job or customer account changed. Sync and reopen the correction.' using errcode='PT409';end if;
 if j.production_status='Cancelled' then raise exception 'This sale is already cancelled';end if;
 old_job=private.adjustment_job(p_shop,j.id);details_id=(d->>'detailsId')::uuid;edits=d->'paymentEdits';
 if details_id is null or jsonb_typeof(edits) is distinct from 'array' or jsonb_array_length(edits)>100 then raise exception 'Invalid payment corrections';end if;
 ids=array[e,details_id];payment_ids='{}'::uuid[];
 select coalesce(jsonb_agg(private.adjustment_payment(p_shop,id) order by id),'[]') into saved_payments from public.payments where shop_id=p_shop and customer_id=j.customer_id;
 for edit in select value from jsonb_array_elements(edits) loop
  child_id=(edit->>'eventId')::uuid;if child_id is null or child_id=any(ids) or (edit->>'paymentId')::uuid=any(payment_ids) then raise exception 'Invalid or reused correction IDs';end if;
  ids=array_append(ids,child_id);payment_ids=array_append(payment_ids,(edit->>'paymentId')::uuid);
  select value into pay from jsonb_array_elements(saved_payments) where value->>'id'=edit->>'paymentId';
  if pay is null or exists(select 1 from public.sale_adjustments where shop_id=p_shop and id=(edit->>'paymentId')::uuid and data->>'action'='sale.refunded') then raise exception 'Choose a payment for this customer';end if;
  token=pay-'id'-'customerId'-'createdAt'-'checkoutId';
  if edit->'expectedPayment' is distinct from token then raise exception 'Payment changed. Sync and reopen the correction.' using errcode='PT409';end if;
 end loop;
 if e=details_id or exists(select 1 from public.ledger_events where shop_id=p_shop and id=any(ids[2:])) then raise exception 'Invalid or reused correction IDs';end if;
 select require_size into requires_size from public.materials where shop_id=p_shop and id=nullif(d->>'materialId','')::uuid;
 job_changed=btrim(d->>'description') is distinct from j.description or d->>'serviceId' is distinct from j.metadata->>'serviceId' or nullif(d->>'materialId','') is distinct from nullif(j.metadata->>'materialId','') or (d->>'quantity')::numeric is distinct from (j.metadata->>'quantity')::numeric or (d->>'unitPrice')::bigint is distinct from (j.metadata->>'unitPrice')::bigint or (case when requires_size then (d->>'width')::numeric end) is distinct from (j.metadata->>'width')::numeric or (case when requires_size then (d->>'height')::numeric end) is distinct from (j.metadata->>'height')::numeric;
 if job_changed then
  child=jsonb_build_object('id',details_id,'kind','sale.details_corrected','data',d||jsonb_build_object('groupId',e));
  perform private.apply_supervised_event_v2(p_shop,child);child_ids=child_ids||to_jsonb(details_id);
  update public.sale_adjustments set data=data||jsonb_build_object('groupId',e) where shop_id=p_shop and id=details_id;
 end if;
 -- Larger recorded receipts first allow a correction that moves money between payment methods.
 for edit in select a.value from jsonb_array_elements(edits) a order by (a.value->>'paymentAmount')::bigint-coalesce((select (p.value->>'amount')::bigint from jsonb_array_elements(saved_payments) p where p.value->>'id'=a.value->>'paymentId'),0) desc loop
  select value into original_pay from jsonb_array_elements(saved_payments) where value->>'id'=edit->>'paymentId';
  if (edit->>'paymentAmount')::bigint=(original_pay->>'amount')::bigint and edit->>'method'=original_pay->>'method' and edit->>'methodLabel'=original_pay->>'methodLabel' and btrim(edit->>'reference')=original_pay->>'reference' then continue;end if;
  pay=private.adjustment_payment(p_shop,(edit->>'paymentId')::uuid);select version into current_version from public.jobs where shop_id=p_shop and id=j.id;
  child_id=(edit->>'eventId')::uuid;child=jsonb_build_object('id',child_id,'kind','payment.corrected','data',d||edit||jsonb_build_object('groupId',e,'baseVersion',current_version,'expectedAccount',public.checkout_account_token(p_shop,j.customer_id),'expectedPayment',pay-'id'-'customerId'-'createdAt'-'checkoutId'));
  perform private.apply_supervised_event_v2(p_shop,child);child_ids=child_ids||to_jsonb(child_id);
  update public.sale_adjustments set data=data||jsonb_build_object('groupId',e) where shop_id=p_shop and id=child_id;
 end loop;
 if jsonb_array_length(child_ids)=0 then raise exception 'Nothing changed';end if;
 new_job=private.adjustment_job(p_shop,j.id);
 for entry in select value as before from jsonb_array_elements(saved_payments) loop pay=private.adjustment_payment(p_shop,(entry.before->>'id')::uuid);if pay<>entry.before then changes=changes||jsonb_build_array(jsonb_build_object('before',entry.before,'after',pay));end if;end loop;
 for entry in select data from public.sale_adjustments where shop_id=p_shop and data->>'groupId'=e::text loop stocks=stocks||coalesce(entry.data->'stockChanges','[]');released=released+coalesce((entry.data->>'creditReleased')::bigint,0);end loop;
 rec=jsonb_build_object('id',e,'action',k,'jobId',j.id,'customerId',j.customer_id,'reason',btrim(d->>'reason'),'changedBy',u,'changedByLabel',label,'changedAt',now_at,'before',old_job,'after',new_job,'creditReleased',released,'refundAmount',0,'returnQuantity',0,'stockMode',d->>'stockMode','stockChanges',stocks,'paymentChanges',changes,'childIds',child_ids,'event',p_event);
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 insert into public.sale_adjustments(shop_id,id,job_id,actor_id,created_at,data) values(p_shop,e,j.id,u,now_at,rec);
 return public.get_ledger(p_shop);
end;$$;
revoke all on function private.apply_supervised_event(uuid,jsonb) from public,anon;
grant execute on function private.apply_supervised_event(uuid,jsonb) to authenticated;
-- Validate configurable settings on every write, including direct table writes.
create function private.check_dynamic_business_settings() returns trigger language plpgsql security invoker set search_path='' as $$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;known text[]:=array['Point of Service','My Sales','Jobs','Customers','Payments','Expenses','Materials','Services','Stock History','Print Settings','Users','My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
begin
 if config ? 'corrections' and (jsonb_typeof(config->'corrections') is distinct from 'object' or jsonb_typeof(config->'corrections'->'recentDays') is distinct from 'number' or (config->'corrections'->>'recentDays')::numeric<>trunc((config->'corrections'->>'recentDays')::numeric) or (config->'corrections'->>'recentDays')::numeric not between 1 and 365) then raise exception 'Choose a correction history window from 1 to 365 days';end if;
 if config ? 'pageAccess' then
  if jsonb_typeof(config->'pageAccess') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'pageAccess') key where key not in ('1','2')) then raise exception 'Invalid page access settings';end if;
  foreach rank_key in array array['1','2'] loop
   allowed=config->'pageAccess'->rank_key;
   if jsonb_typeof(allowed) is distinct from 'array' or not allowed ? 'My Account' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed)) then raise exception 'Invalid page access settings';end if;
   for page in select value from jsonb_array_elements(allowed) loop
    if jsonb_typeof(page) is distinct from 'string' or not (page#>>'{}')=any(known) or page#>>'{}'='Business Settings' or rank_key='1' and page#>>'{}' in ('Users','Conflict Inbox','Sale Adjustments','Material Waste') then raise exception 'Restricted page access';end if;
   end loop;
  end loop;
 end if;
 return new;
end;$$;
create trigger check_dynamic_business_settings before insert or update on public.business_settings for each row execute function private.check_dynamic_business_settings();
revoke all on function private.check_dynamic_business_settings() from public,anon,authenticated;
