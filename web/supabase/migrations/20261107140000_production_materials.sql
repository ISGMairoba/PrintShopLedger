-- Materials in production (services and pricing templates):
-- * services.production {perItem}: how much of the service's material one item uses (A2 lamination
--   = 4 units of film counted in A4 units). Checkout and sale corrections multiply by it.
-- * production {extraMaterials, costCovered} on services (and on templates, inside the template in
--   Business Settings): staff may add any material from stock to a job in production.
-- * job.extra_materials_set (apply_job_extra_materials_event): the totals of the added materials;
--   stock moves by the difference. Who may do it: Business Settings → Jobs & payments →
--   production.extraMaterialsRank (default Cashiers and above).

alter table public.services add column if not exists production jsonb not null default '{}'::jsonb;

-- The stored form: only what differs from the defaults (the app stores the same).
create or replace function private.service_production(p jsonb) returns jsonb
language plpgsql immutable set search_path to '' as $f$
declare per numeric;
begin
  if p is null or p = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('extraMaterials', 'costCovered', 'perItem'))
     or (p ? 'extraMaterials' and jsonb_typeof(p->'extraMaterials') <> 'boolean') or (p ? 'costCovered' and jsonb_typeof(p->'costCovered') <> 'boolean')
     or (p ? 'perItem' and jsonb_typeof(p->'perItem') <> 'number') then
    raise exception 'Invalid production settings';
  end if;
  per := coalesce((p->>'perItem')::numeric, 1);
  if per <= 0 or per > 10000 or per <> round(per, 3) then raise exception 'Enter how much material one item uses: more than 0, up to three decimal places'; end if;
  return case when (p->>'extraMaterials')::boolean then jsonb_build_object('extraMaterials', true) else '{}'::jsonb end
    || case when (p->>'extraMaterials')::boolean and (p->>'costCovered')::boolean then jsonb_build_object('costCovered', true) else '{}'::jsonb end
    || case when per <> 1 then jsonb_build_object('perItem', per) else '{}'::jsonb end;
end $f$;
create or replace function private.per_item(p jsonb) returns numeric
language sql immutable set search_path to '' as $f$ select coalesce((p->>'perItem')::numeric, 1) $f$;

do $patch$
declare d text; f text; pats text[][]; i int;
begin
  -- Services: validate and store production.
  d := pg_get_functiondef('public.apply_service_event(uuid,jsonb)'::regprocedure);
  pats := array[
    array[$$then raise exception 'Enter a valid template cost and formula name'; end if;$$,
          $$then raise exception 'Enter a valid template cost and formula name'; end if;
    perform private.service_production(v_data->'production');$$],
    array[$$material_options,confirm_stage,created_by,$$, $$material_options,confirm_stage,production,created_by,$$],
    array[$$v_options,v_stage,v_user,v_label,v_user,v_label,v_event);$$, $$v_options,v_stage,private.service_production(v_data->'production'),v_user,v_label,v_user,v_label,v_event);$$],
    array[$$material_options=v_options,confirm_stage=v_stage,$$, $$material_options=v_options,confirm_stage=v_stage,production=case when v_data ? 'production' then private.service_production(v_data->'production') else production end,$$]];
  for i in 1..array_length(pats, 1) loop
    if (length(d) - length(replace(d, pats[i][1], ''))) / length(pats[i][1]) <> 1 then raise exception 'apply_service_event pattern % not found', i; end if;
    d := replace(d, pats[i][1], pats[i][2]);
  end loop;
  execute d;
  -- Checkout: material used = size × material per item (the price stays per item).
  d := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  pats := array[
    array[$$needed:=case when svc.material_id is null then 0 else round(q*w*h,3) end;$$, $$needed:=case when svc.material_id is null then 0 else round(q*w*h*private.per_item(svc.production),3) end;$$],
    array[$$private.material_choice(svc.material_options,svc.confirm_stage,round(q*w*h,3),$$, $$private.material_choice(svc.material_options,svc.confirm_stage,round(q*w*h*private.per_item(svc.production),3),$$]];
  for i in 1..array_length(pats, 1) loop
    if (length(d) - length(replace(d, pats[i][1], ''))) / length(pats[i][1]) <> 1 then raise exception 'apply_checkout_event pattern % not found', i; end if;
    d := replace(d, pats[i][1], pats[i][2]);
  end loop;
  execute d;
  -- Sale corrections: the same.
  d := pg_get_functiondef('private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure);
  pats := array[
    array[$$needed=case when mid is null then 0 else round(raw,3) end;$$, $$needed=case when mid is null then 0 else round(raw*private.per_item(s.production),3) end;$$],
    array[$$'{materialChoice,work}',to_jsonb(trim_scale(round(raw,3))))$$, $$'{materialChoice,work}',to_jsonb(trim_scale(round(raw*private.per_item(s.production),3))))$$]];
  for i in 1..array_length(pats, 1) loop
    if (length(d) - length(replace(d, pats[i][1], ''))) / length(pats[i][1]) <> 1 then raise exception 'apply_supervised_event_v2 pattern % not found', i; end if;
    d := replace(d, pats[i][1], pats[i][2]);
  end loop;
  execute d;
  -- Devices download it.
  d := pg_get_functiondef('public.get_ledger_before_checkout(uuid)'::regprocedure);
  f := $$'confirmStage',confirm_stage,$$;
  if (length(d) - length(replace(d, f, ''))) / length(f) <> 1 then raise exception 'get_ledger_before_checkout pattern not found'; end if;
  execute replace(d, f, f || $$'production',production,$$);
  -- The rank setting lives on the Jobs & payments tab.
  d := pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
  f := $$('Jobs & payments','drawers'),$$;
  if (length(d) - length(replace(d, f, ''))) / length(f) <> 1 then raise exception 'settings_tab_keys pattern not found'; end if;
  execute replace(d, f, f || $$('Jobs & payments','production'),$$);
end $patch$;

create or replace function public.apply_job_extra_materials_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; j public.jobs%rowtype; payload jsonb; actor uuid; label text; lvl int;
  usage jsonb; m public.materials%rowtype; sid uuid; qty numeric; cur numeric; delta numeric; prod jsonb; own text[]; seen text[] := '{}'; ids uuid[] := '{}';
  totals jsonb; at int;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_event->>'kind' is distinct from 'job.extra_materials_set' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select access_level, name into lvl, label from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived;
  if lvl is null or lvl < coalesce((select (settings->'production'->>'extraMaterialsRank')::int from public.business_settings where shop_id = p_shop), 1) then
    raise exception 'Your role may not add materials to jobs. Ask an Admin.' using errcode = '42501';
  end if;
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  prod := case when j.metadata ? 'templateSnapshot' then j.metadata->'templateSnapshot'->'template'->'production'
               else (select s.production from public.services s where s.shop_id = p_shop and s.id::text = j.metadata->>'serviceId') end;
  if not coalesce((prod->>'extraMaterials')::boolean, false) or coalesce((j.metadata->>'shelfItem')::boolean, false) then raise exception 'This job does not take added materials'; end if;
  if jsonb_typeof(d->'usages') is distinct from 'array' or jsonb_array_length(d->'usages') not between 1 and 30 then raise exception 'Add the materials used'; end if;
  own := array_remove(array[j.metadata->>'materialId'], null)
    || coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(j.metadata->'materialChoice'->'options', '[]')) x), '{}')
    || coalesce((select array_agg(o) from jsonb_array_elements(coalesce(j.metadata->'materialChoice'->'groups', '[]')) g, jsonb_array_elements_text(g->'options') o), '{}')
    || coalesce((select array_agg(s->>'materialId') from jsonb_array_elements(coalesce(j.metadata->'templateSnapshot'->'stock', '[]')) s), '{}');
  totals := coalesce(j.metadata->'extraMaterials'->'usages', '[]');
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  for usage in select value from jsonb_array_elements(d->'usages') loop
    if jsonb_typeof(usage) is distinct from 'object' or exists (select 1 from jsonb_object_keys(usage) k where k not in ('id', 'materialId', 'quantity')) then raise exception 'Invalid material usage'; end if;
    sid := (usage->>'id')::uuid;
    if sid is null or sid = e or sid = any(ids) or exists (select 1 from public.ledger_events where shop_id = p_shop and id = sid) then raise exception 'Invalid material usage ID'; end if;
    if usage->>'materialId' = any(seen) then raise exception 'Add each material once'; end if;
    seen := array_append(seen, usage->>'materialId');
    if usage->>'materialId' = any(own) then raise exception 'This job''s own material is recorded with the sale or its material confirmation'; end if;
    qty := (usage->>'quantity')::numeric;
    if jsonb_typeof(usage->'quantity') is distinct from 'number' or qty < 0 or qty > 1000000000000 or qty <> round(qty, 3) then raise exception 'Enter how much of each material was used (up to three decimal places)'; end if;
    select * into m from public.materials where shop_id = p_shop and id = (usage->>'materialId')::uuid for update; m := private.at_location(p_shop, m);
    if m.id is null then raise exception 'Choose materials from this business'; end if;
    select (x.v->>'quantity')::numeric, x.n::int into cur, at from jsonb_array_elements(totals) with ordinality x(v, n) where x.v->>'materialId' = m.id::text;
    delta := round(qty - coalesce(cur, 0), 3);
    if delta = 0 then continue; end if;
    if delta > 0 and j.production_status = 'Cancelled' then raise exception 'This job is cancelled: materials can only be returned' using errcode = 'PT409'; end if;
    if delta > 0 and m.archived then raise exception '% is archived', m.name; end if;
    ids := array_append(ids, sid);
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, sid, auth.uid(), jsonb_build_object('id', sid,
      'kind', case when delta > 0 then 'material.job_used' else 'material.job_corrected' end,
      'data', jsonb_build_object('id', m.id, 'jobId', j.id, 'checkoutId', j.metadata->>'checkoutId',
        'reason', 'Job ' || j.id || ' · material ' || case when delta > 0 then 'added' else 'returned' end || ' in production')));
    update public.materials set available = round(m.available - delta, 3), version = version + 1, modified_by = auth.uid(), modified_by_label = label,
      modified_at = now(), last_event_id = sid where shop_id = p_shop and id = m.id;
    totals := case when at is null then totals || jsonb_build_array(jsonb_build_object('materialId', m.id, 'quantity', qty))
                   else jsonb_set(totals, array[(at - 1)::text], jsonb_build_object('materialId', m.id, 'quantity', qty)) end;
    at := null; cur := null;
  end loop;
  totals := coalesce((select jsonb_agg(x.v order by x.n) from jsonb_array_elements(totals) with ordinality x(v, n) where (x.v->>'quantity')::numeric > 0), '[]');
  if jsonb_array_length(totals) > 30 then raise exception 'Add at most 30 materials to a job'; end if;
  update public.jobs set metadata = metadata || jsonb_build_object('extraMaterials', jsonb_build_object('usages', totals, 'updatedBy', auth.uid(), 'updatedByLabel', label, 'updatedAt', d->>'modifiedAt')
      || case when coalesce((prod->>'costCovered')::boolean, false) then jsonb_build_object('costCovered', true) else '{}'::jsonb end),
    version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = e
  where shop_id = p_shop and id = j.id;
end $f$;
revoke all on function public.apply_job_extra_materials_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_job_extra_materials_event(uuid, jsonb) to authenticated;
revoke all on function private.service_production(jsonb), private.per_item(jsonb) from public, anon;
grant execute on function private.service_production(jsonb), private.per_item(jsonb) to authenticated;
