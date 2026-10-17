-- Corrections on choice-of-materials jobs. Before the material is confirmed, a size correction
-- only changes the job size to confirm. After it is confirmed, a correction gives the new amount
-- of each material really used (choiceUsages) and stock moves by the difference; cancelling returns
-- what was not really used. A choice job keeps its service.

-- Move stock to the new amounts used: p_usages [{materialId, quantity}] (new totals; materials
-- left out stay). Returns {stocks:[{materialId,delta}], usages:[{materialId,quantity}]}.
create or replace function private.choice_usage_apply(p_shop uuid, p_job uuid, p_usages jsonb, p_ids jsonb, p_versions jsonb, p_reason text, p_label text, p_at timestamptz, p_event uuid, p_kind text, p_returns_only boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();meta jsonb;opts jsonb;item jsonb;mid uuid;target numeric;used numeric;delta numeric;m public.materials%rowtype;sid uuid;seen uuid[]:='{}';stocks jsonb:='[]';usages jsonb;
begin
 select metadata into meta from public.jobs where shop_id=p_shop and id=p_job;
 opts:=meta->'materialChoice'->'options';
 if opts is null then return jsonb_build_object('stocks','[]'::jsonb,'usages','[]'::jsonb);end if;
 if not meta ? 'materialUsed' then raise exception 'The material for this job is not confirmed yet, so no stock was taken';end if;
 if jsonb_typeof(p_usages) is distinct from 'array' or jsonb_array_length(p_usages)>jsonb_array_length(opts) then raise exception 'Enter how much of each material was really used';end if;
 for item in select value from jsonb_array_elements(p_usages) loop
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'materialId') is distinct from 'string' or not opts ? (item->>'materialId') then raise exception 'Choose each material linked to this service at most once';end if;
  mid:=(item->>'materialId')::uuid;
  if mid=any(seen) then raise exception 'Choose each material linked to this service at most once';end if;
  seen:=array_append(seen,mid);
  if jsonb_typeof(item->'quantity') is distinct from 'number' then raise exception 'Enter how much of each material was really used (up to three decimal places)';end if;
  target:=(item->>'quantity')::numeric;
  if target<0 or target>1000000000000 or target<>round(target,3) then raise exception 'Enter how much of each material was really used (up to three decimal places)';end if;
  select round(greatest(0,coalesce(sum(before_available-after_available),0)),3) into used from public.material_stock_changes where shop_id=p_shop and job_id=p_job and material_id=mid and action in ('material.job_used','material.sale_returned','material.job_corrected');
  delta:=round(used-target,3);
  if p_returns_only and delta<0 then raise exception 'Returned stock cannot exceed recorded material usage';end if;
  if delta=0 then continue;end if;
  if exists(select 1 from public.material_stock_changes c where c.shop_id=p_shop and c.material_id=mid and c.action='material.stock_set' and c.created_at>=(select min(x.created_at) from public.material_stock_changes x where x.shop_id=p_shop and x.job_id=p_job and x.material_id=mid and x.action in ('material.job_used','material.job_corrected'))) then raise exception 'A later stock count already reconciled this usage. Keep actual usage and current stock.';end if;
  select * into m from public.materials where shop_id=p_shop and id=mid and not archived for update;
  if not found then raise exception 'Material changed. Sync and reopen the correction.' using errcode='PT409';end if;
  sid:=(p_ids->>mid::text)::uuid;
  if m.version is distinct from (p_versions->>mid::text)::integer or sid is null or sid=p_event or exists(select 1 from public.ledger_events where shop_id=p_shop and id=sid) then raise exception 'Material changed. Sync and reopen the correction.' using errcode='PT409';end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,u,jsonb_build_object('id',sid,'kind',p_kind,'data',jsonb_build_object('id',m.id,'jobId',p_job,'checkoutId',meta->>'checkoutId','reason',p_reason)));
  update public.materials set available=round(available+delta,3),version=version+1,modified_by=u,modified_by_label=p_label,modified_at=p_at,last_event_id=sid where shop_id=p_shop and id=m.id;
  stocks:=stocks||jsonb_build_array(jsonb_build_object('materialId',m.id,'delta',delta));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('materialId',o.value,'quantity',o.q) order by o.n),'[]'::jsonb) into usages
 from (select t.value,t.n,(select trim_scale(round(greatest(0,coalesce(sum(c.before_available-c.after_available),0)),3)) from public.material_stock_changes c where c.shop_id=p_shop and c.job_id=p_job and c.material_id::text=t.value and c.action in ('material.job_used','material.sale_returned','material.job_corrected')) q from jsonb_array_elements_text(opts) with ordinality t(value,n)) o where o.q>0;
 return jsonb_build_object('stocks',stocks,'usages',usages);
end $$;
revoke all on function private.choice_usage_apply(uuid,uuid,jsonb,jsonb,jsonb,text,text,timestamptz,uuid,text,boolean) from public, anon, authenticated;

do $mig$
declare src text;
  procedure_name text;
  pairs text[][];
  i int;
begin
 -- Details corrections (apply_supervised_event_v2).
 src:=pg_get_functiondef('private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$drawer_actor uuid;historical uuid;
begin$a$, $b$drawer_actor uuid;historical uuid;choice boolean:=false;cu jsonb;
begin$b$],
  array[$a$  if mid is not null then select * into m from public.materials where shop_id=p_shop and id=mid and not archived for update;if not found then raise exception 'Choose an active material';end if;end if;$a$,
        $b$  if mid is not null then select * into m from public.materials where shop_id=p_shop and id=mid and not archived for update;if not found then raise exception 'Choose an active material';end if;end if;
  if (j.metadata ? 'materialChoice' or cardinality(s.material_options)>0) and s.id::text is distinct from j.metadata->>'serviceId' then raise exception 'A job with a choice of materials keeps its service. Cancel it and add a new job for another service.';end if;
  if (j.metadata ? 'materialChoice') is distinct from (cardinality(s.material_options)>0) then raise exception 'This service changed how it uses materials since the sale. Cancel the job and add it again.';end if;
  if cardinality(s.material_options)>0 then
   if mid is not null then raise exception 'This service uses a choice of materials, confirmed in production';end if;
   select * into m from public.materials where shop_id=p_shop and id=s.material_options[1];choice=true;
  end if;$b$],
  array[$a$if mid is not null and m.require_size then w=$a$, $b$if (mid is not null or choice) and m.require_size then w=$b$],
  array[$a$'measurementUnit',case when mid is null then 'item' else m.measurement_unit end,'requireSize',mid is not null and m.require_size);$a$,
        $b$'measurementUnit',case when mid is null and not choice then 'item' else m.measurement_unit end,'requireSize',(mid is not null or choice) and m.require_size);
  if choice then job_meta=jsonb_set(job_meta,'{materialChoice,work}',to_jsonb(trim_scale(round(raw,3))));end if;$b$],
  array[$a$  if new_amount=j.amount and btrim(d->>'description')=j.description and job_meta=j.metadata and stocks='[]'::jsonb then raise exception 'Nothing changed';end if;$a$,
        $b$  if d->>'stockMode'='reconcile' and j.metadata ? 'materialUsed' then
   if jsonb_typeof(d->'choiceUsages') is distinct from 'array' then raise exception 'Enter how much of each material was really used';end if;
   cu=private.choice_usage_apply(p_shop,j.id,d->'choiceUsages',d->'stockIds',d->'materialVersions',reason,label,at_time,e,'material.job_corrected',false);
   stocks=stocks||(cu->'stocks');
   if jsonb_array_length(cu->'stocks')>0 then job_meta=jsonb_set(job_meta,'{materialUsed,usages}',cu->'usages');end if;
  end if;
  if new_amount=j.amount and btrim(d->>'description')=j.description and job_meta=j.metadata and stocks='[]'::jsonb then raise exception 'Nothing changed';end if;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_supervised_event_v2 changed (part %); review the choice corrections migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 -- Cancellations (apply_supervised_event_v1).
 src:=pg_get_functiondef('private.apply_supervised_event_v1(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$next_stock numeric;day date;
begin$a$, $b$next_stock numeric;day date;cu jsonb;choice_stocks jsonb:='[]';
begin$b$],
  array[$a$ insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 update public.jobs set amount=new_amount$a$,
        $b$ if jsonb_typeof(d->'choiceUsages')='array' and jsonb_array_length(d->'choiceUsages')>0 then
  if k<>'sale.cancelled' then raise exception 'Stock may only be returned when cancelling a sale';end if;
  cu=private.choice_usage_apply(p_shop,j.id,d->'choiceUsages',d->'stockIds',d->'materialVersions',reason,label,at_time,e,'material.sale_returned',true);
  choice_stocks=cu->'stocks';
  if jsonb_array_length(choice_stocks)>0 then update public.jobs set metadata=jsonb_set(metadata,'{materialUsed,usages}',cu->'usages') where shop_id=p_shop and id=j.id;end if;
 end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,u,p_event);
 update public.jobs set amount=new_amount$b$],
  array[$a$'returnQuantity',returned,$a$, $b$'returnQuantity',returned,'stockChanges',choice_stocks,$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_supervised_event_v1 changed (part %); review the choice corrections migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;
