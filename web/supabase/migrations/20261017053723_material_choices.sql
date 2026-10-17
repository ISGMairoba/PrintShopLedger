-- Material choices: a service can link several compatible materials (e.g. 2 ft, 5 ft and 10 ft
-- banner rolls) at one selling price. No stock is taken at sale; when the job moves past the
-- service's confirmation stage, staff confirm the material(s) actually used and how much, and only
-- then is the stock deducted (a job.material_used event). Services with one fixed material or no
-- material work as before.

alter table public.services add column if not exists material_options uuid[] not null default '{}';
alter table public.services add column if not exists confirm_stage text;

-- The checked list of linked materials (2–10, active or already linked, same size rule and unit).
create or replace function private.check_material_options(p_shop uuid, p_options jsonb, p_existing uuid[])
returns uuid[] language plpgsql stable set search_path='' as $$
declare result uuid[]:='{}';item jsonb;m public.materials%rowtype;size_rule boolean;unit text;
begin
 if p_options is null or p_options='null'::jsonb or p_options='[]'::jsonb then return '{}';end if;
 if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options) not between 2 and 10 then raise exception 'Link 2 to 10 materials for a choice of materials';end if;
 for item in select value from jsonb_array_elements(p_options) loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose materials from this workspace';end if;
  select * into m from public.materials where shop_id=p_shop and id=(item#>>'{}')::uuid;
  if not found then raise exception 'Choose materials from this workspace' using errcode='P0002';end if;
  if m.id=any(result) then raise exception 'A material is linked twice';end if;
  if m.archived and not m.id=any(coalesce(p_existing,'{}')) then raise exception 'Choose active materials' using errcode='P0002';end if;
  if size_rule is null then size_rule:=m.require_size;unit:=m.measurement_unit;
  elsif m.require_size is distinct from size_rule or m.measurement_unit is distinct from unit then raise exception 'Linked materials must use the same unit and size rule (all by size, or all by count)';end if;
  result:=array_append(result,m.id);
 end loop;
 return result;
end $$;

-- What a choice job stores at checkout: the linked materials, the confirmation stage, the job's
-- size in material units (for the suggested usage) and the material planned, if any.
create or replace function private.material_choice(p_options uuid[], p_stage text, p_work numeric, p_given jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('options',to_jsonb(p_options),'confirmStage',p_stage,'work',p_work)
  ||case when p_given->>'plannedMaterialId' is not null and (p_given->>'plannedMaterialId')=any(p_options::text[])
     then jsonb_build_object('plannedMaterialId',p_given->>'plannedMaterialId') else '{}'::jsonb end $$;

-- Whether moving a choice job to p_next needs its material confirmed first: when p_next lies
-- beyond the confirmation stage (or beyond the stage before Completed if that stage is gone).
create or replace function private.material_confirm_due(p_meta jsonb, p_next text)
returns boolean language sql immutable set search_path='' as $$
 with flow as (select value,position from jsonb_array_elements_text(coalesce(p_meta->'workflow','["Added","In Queue","Printing","Completed","Collected"]'::jsonb)) with ordinality s(value,position))
 select p_meta ? 'materialChoice' and not p_meta ? 'materialUsed'
  and coalesce((select position from flow where value=p_next),0) >
   coalesce((select position from flow where value=p_meta->'materialChoice'->>'confirmStage'),(select position-1 from flow where value='Completed'),0) $$;

-- Confirm the material(s) a choice job used, and take them from stock.
create or replace function public.apply_job_material_event(p_shop uuid, p_event jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare d jsonb:=p_event->'data';e uuid:=(p_event->>'id')::uuid;j public.jobs%rowtype;payload jsonb;actor uuid;label text;
 usage jsonb;m public.materials%rowtype;sid uuid;qty numeric;ids uuid[]:='{}';mats uuid[]:='{}';opts jsonb;
begin
 perform private.assert_sync_dependencies(p_shop,p_event);
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
 if p_event->>'kind' is distinct from 'job.material_used' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity';end if;
 perform 1 from public.shops where id=p_shop for update;
 select le.payload,le.actor_id into payload,actor from public.ledger_events le where shop_id=p_shop and id=e;
 if found then if payload<>p_event or actor<>auth.uid() then raise exception 'Operation ID already used';end if;return;end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'id')::uuid for update;
 if not found then raise exception 'Job not found';end if;
 if not j.metadata ? 'materialChoice' then raise exception 'This job does not need its material confirmed';end if;
 if j.metadata ? 'materialUsed' then raise exception 'The material for this job is already confirmed. Review the latest version.' using errcode='PT409';end if;
 if j.production_status='Cancelled' then raise exception 'This job is cancelled' using errcode='PT409';end if;
 if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode='PT409';end if;
 opts:=j.metadata->'materialChoice'->'options';
 if jsonb_typeof(d->'usages') is distinct from 'array' or jsonb_array_length(d->'usages') not between 1 and jsonb_array_length(opts) then raise exception 'Choose the material or materials used';end if;
 select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,e,auth.uid(),p_event);
 for usage in select value from jsonb_array_elements(d->'usages') loop
  if jsonb_typeof(usage) is distinct from 'object' or exists(select 1 from jsonb_object_keys(usage) k where k not in ('id','materialId','quantity')) then raise exception 'Invalid material usage';end if;
  sid:=(usage->>'id')::uuid;qty:=(usage->>'quantity')::numeric;
  if sid is null or sid=e or sid=any(ids) or exists(select 1 from public.ledger_events where shop_id=p_shop and id=sid) then raise exception 'Invalid material usage ID';end if;
  if not opts ? (usage->>'materialId') or (usage->>'materialId')::uuid=any(mats) then raise exception 'Choose each material linked to this service at most once';end if;
  if jsonb_typeof(usage->'quantity') is distinct from 'number' or qty<=0 or qty>1000000000000 or qty<>round(qty,3) then raise exception 'Enter how much of each material was used (up to three decimal places)';end if;
  select * into m from public.materials where shop_id=p_shop and id=(usage->>'materialId')::uuid for update;
  if not found then raise exception 'Material not found';end if;
  ids:=array_append(ids,sid);mats:=array_append(mats,m.id);
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,auth.uid(),jsonb_build_object('id',sid,'kind','material.job_used','data',jsonb_build_object('id',m.id,'jobId',j.id,'checkoutId',j.metadata->>'checkoutId','reason','Job '||j.id||' · material used, confirmed in production')));
  update public.materials set available=round(available-qty,3),version=version+1,modified_by=auth.uid(),modified_by_label=label,modified_at=now(),last_event_id=sid where shop_id=p_shop and id=m.id;
 end loop;
 update public.jobs set metadata=metadata||jsonb_build_object('materialUsed',jsonb_build_object('usages',d->'usages','confirmedBy',auth.uid(),'confirmedByLabel',label,'confirmedAt',d->>'modifiedAt')),
  version=version+1,modified_by=auth.uid(),modified_by_label=label,modified_at=now(),last_event_id=e where shop_id=p_shop and id=j.id;
end $function$;
revoke all on function public.apply_job_material_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_job_material_event(uuid,jsonb) to authenticated;

do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.apply_service_event(uuid,jsonb)'::regprocedure,array[
   $a$  v_service_exists boolean;$a$,
   $b$  v_service_exists boolean;
  v_options uuid[];
  v_stage text;$b$,
   $a$    v_material := null;$a$,
   $b$    v_options := private.check_material_options(p_shop,coalesce(v_data->'materialOptions',case when v_service_exists then to_jsonb(v_service.material_options) else '[]'::jsonb end),case when v_service_exists then v_service.material_options else '{}'::uuid[] end);
    if cardinality(v_options)>0 then
      if v_data->'materialId'<>'null'::jsonb then raise exception 'Choose one fixed material or a choice of materials, not both'; end if;
      if coalesce((v_data->>'shelfItem')::boolean,false) then raise exception 'Items with a choice of materials go through production, so they cannot be sold off the shelf'; end if;
      if (select bool_or(m.require_size) from public.materials m where m.shop_id=p_shop and m.id=any(v_options)) and jsonb_array_length(coalesce(v_data->'packPrices','[]'::jsonb))>0 then raise exception 'Pack prices are for items sold by count, not by size'; end if;
      v_stage := coalesce(nullif(btrim(v_data->>'confirmStage'),''),case when v_service_exists then v_service.confirm_stage end,'Printing');
      if length(v_stage)>80 or v_stage ~ '[\x00-\x1f\x7f]' or v_stage in ('Collected','Cancelled') then raise exception 'Choose the stage after which the material is confirmed'; end if;
    else
      v_stage := null;
    end if;
    v_material := null;$b$,
   $a$pack_prices,variant_group,variant_name,created_by$a$,
   $b$pack_prices,variant_group,variant_name,material_options,confirm_stage,created_by$b$,
   $a$nullif(btrim(coalesce(v_data->>'variantName','')),''),v_user,v_label,v_user,v_label,v_event);$a$,
   $b$nullif(btrim(coalesce(v_data->>'variantName','')),''),v_options,v_stage,v_user,v_label,v_user,v_label,v_event);$b$,
   $a$variant_name=case when v_data ? 'variantName' then nullif(btrim(coalesce(v_data->>'variantName','')),'') else variant_name end,$a$,
   $b$variant_name=case when v_data ? 'variantName' then nullif(btrim(coalesce(v_data->>'variantName','')),'') else variant_name end,material_options=v_options,confirm_stage=v_stage,$b$
  ]),
  ('public.get_ledger_before_checkout(uuid)'::regprocedure,array[
   $a$'packPrices',pack_prices,$a$,
   $b$'packPrices',pack_prices,'materialOptions',to_jsonb(material_options),'confirmStage',confirm_stage,$b$
  ]),
  ('public.apply_checkout_event(uuid,jsonb)'::regprocedure,array[
   $a$  if svc.material_id is null then
    if line->'materialId' is distinct from 'null'::jsonb$a$,
   $b$  if svc.material_id is null and cardinality(svc.material_options)>0 then
    select * into mat from public.materials where shop_id=p_shop and id=svc.material_options[1];
    if not found or line->'materialId' is distinct from 'null'::jsonb or line->'requireSize' is distinct from to_jsonb(mat.require_size) then raise exception 'The materials for this service changed. Review checkout.' using errcode='PT409';end if;
  elsif svc.material_id is null then
    if line->'materialId' is distinct from 'null'::jsonb$b$,
   $a$or needed is distinct from (line->>'materialNeeded')::numeric then raise exception 'Invalid job calculation';end if;$a$,
   $b$or needed is distinct from (line->>'materialNeeded')::numeric then raise exception 'Invalid job calculation';end if;
  if cardinality(svc.material_options)>0 then
   if svc.shelf_item or line->'materialChoice' is distinct from private.material_choice(svc.material_options,svc.confirm_stage,round(q*w*h,3),line->'materialChoice') then raise exception 'The materials for this service changed. Review checkout.' using errcode='PT409';end if;
  elsif line ? 'materialChoice' then raise exception 'Invalid material choice';end if;$b$
  ]),
  ('public.apply_job_status_event(uuid,jsonb)'::regprocedure,array[
   $a$select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();$a$,
   $b$if private.material_confirm_due(j.metadata,next_status) then raise exception 'Confirm the material used for this job before moving it on.' using errcode='PT409';end if;
select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid();$b$
  ]),
  ('private.sync_resource_keys(uuid,jsonb,boolean,text)'::regprocedure,array[
   $a$keys:=array_append(keys,'material:'||(job.metadata->>'materialId'));end if;$a$,
   $b$keys:=array_append(keys,'material:'||(job.metadata->>'materialId'));
   for j in select value from jsonb_array_elements(coalesce(d->'usages','[]')) loop keys:=array_append(keys,'material:'||(j->>'materialId'));end loop;
  end if;$b$
  ]),
  ('private.apply_reviewed_operation(uuid,jsonb,uuid)'::regprocedure,array[
   $a$ when p_event->>'kind'='job.status_changed' then perform public.apply_job_status_event(p_shop,p_event);$a$,
   $b$ when p_event->>'kind'='job.status_changed' then perform public.apply_job_status_event(p_shop,p_event);
 when p_event->>'kind'='job.material_used' then perform public.apply_job_material_event(p_shop,p_event);$b$
  ])
 ) as x(f,s) loop
  def:=pg_get_functiondef(fn);next:=def;
  for i in 1..array_length(swap,1)/2 loop
   if position(swap[2*i-1] in next)=0 then raise exception 'Expected text not found in %: %',fn,left(swap[2*i-1],90);end if;
   next:=replace(next,swap[2*i-1],swap[2*i]);
  end loop;
  execute next;
 end loop;
end $migration$;
