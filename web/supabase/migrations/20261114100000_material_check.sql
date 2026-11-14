-- Materials check in production. Every job that takes stock (its own material, a template's stock
-- lines, or a choice of materials) confirms at its confirmation stage what production really used:
-- each line starts at the calculated amount; staff may change it, swap to another material of the
-- same unit, or split it across several. Stock moves by the difference from what the job has taken.
-- * An Admin or higher (access level 2+) confirms at once (mode "confirm").
-- * Others send it for approval (mode "request"): nothing moves until an Admin confirms it.
-- * Moving a job past its confirmation stage needs the check (sent or confirmed).
-- The app applies the same rules (src/material-check.mjs); keep them in step.

-- 1. Which jobs check: set by the server at checkout (never trusted from the app).
do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  pat := 'else\s+line-''shelfItem''\s+end\|\|jsonb_build_object\(''customerId''';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_checkout_event metadata pattern not found'; end if;
  d := regexp_replace(d, pat, $r$else line-'shelfItem' end-'checkMaterials'||jsonb_build_object('customerId'$r$);
  pat := 'case\s+when\s+svc\.shelf_item\s+then\s+jsonb_build_object\(''shelfItem'',true\)\s+else\s+''\{\}''::jsonb\s+end,u,label,now\(\),e\);';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_checkout_event shelf pattern not found'; end if;
  d := regexp_replace(d, pat, $r$case when svc.shelf_item then jsonb_build_object('shelfItem',true) else '{}'::jsonb end||case when not coalesce(svc.shelf_item,false) and (svc.material_id is not null or jsonb_array_length(coalesce(line->'templateSnapshot'->'stock','[]'::jsonb))>0 or line ? 'materialChoice') then jsonb_build_object('checkMaterials',true) else '{}'::jsonb end,u,label,now(),e);$r$);
  execute d;
end $patch$;

-- 2. The lines a job confirms (key and unit), as material-check.mjs checkLines.
create or replace function private.job_check_lines(p_shop uuid, p_meta jsonb)
returns table(key text, unit text)
language sql stable set search_path to '' as $$
  select distinct on (x.key) x.key, x.unit from (
    select 'm:' || (p_meta->>'materialId') as key, p_meta->>'measurementUnit' as unit, 1 as o
      where nullif(p_meta->>'materialId', '') is not null and coalesce((p_meta->>'materialNeeded')::numeric, 0) > 0
    union all
    select 'm:' || (s->>'materialId'), s->>'unit', 2
      from jsonb_array_elements(coalesce(p_meta->'templateSnapshot'->'stock', '[]'::jsonb)) s
      where coalesce((s->>'quantity')::numeric, 0) > 0
    union all
    select 'g:' || (g.n - 1),
      coalesce(g.v->>'unit', (select m.measurement_unit from public.materials m where m.shop_id = p_shop and m.id = (g.v->'options'->>0)::uuid)), 3
      from jsonb_array_elements(coalesce(p_meta->'materialChoice'->'groups',
        case when p_meta ? 'materialChoice' then jsonb_build_array(jsonb_build_object('options', p_meta->'materialChoice'->'options')) else '[]'::jsonb end))
        with ordinality g(v, n)
  ) x order by x.key, x.o
$$;

-- 3. Moving on needs the check (a choice job's old confirmation still counts).
create or replace function private.material_confirm_due(p_meta jsonb, p_next text)
returns boolean language sql immutable set search_path to '' as $$
 with flow as (select value,position from jsonb_array_elements_text(coalesce(p_meta->'workflow','["Added","In Queue","Printing","Completed","Collected"]'::jsonb)) with ordinality s(value,position))
 select (p_meta ? 'materialChoice' or coalesce((p_meta->>'checkMaterials')::boolean, false))
  and not p_meta ? 'materialUsed' and not p_meta ? 'materialCheck'
  and coalesce((select position from flow where value=p_next),0) >
   coalesce((select position from flow where value=p_meta->'materialChoice'->>'confirmStage'),(select position-1 from flow where value='Completed'),0) $$;

-- 4. The check itself.
create or replace function public.apply_job_check_event(p_shop uuid, p_event jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; j public.jobs%rowtype; payload jsonb; actor uuid;
  label text; lvl integer; mode text := p_event->'data'->>'mode'; u jsonb; m public.materials%rowtype;
  qty numeric; line_unit text; seen text[] := '{}'; ids uuid[] := '{}'; mid uuid; total numeric; own numeric;
  delta numeric; sid uuid; prior jsonb; check_rec jsonb;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_event->>'kind' is distinct from 'job.materials_checked' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then
    raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select access_level, name into lvl, label from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived;
  if not found then raise exception 'Business access denied'; end if;
  if mode is null or mode not in ('confirm', 'request') or (mode = 'confirm') <> (lvl >= 2) then
    raise exception 'An Admin or higher confirms materials; others send them for approval. Sync and try again.' using errcode = 'PT409';
  end if;
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  if j.production_status = 'Cancelled' then raise exception 'This job is cancelled' using errcode = 'PT409'; end if;
  if not (j.metadata ? 'materialChoice' or coalesce((j.metadata->>'checkMaterials')::boolean, false)) then
    raise exception 'This job has no materials to confirm'; end if;
  if mode = 'request' and j.metadata->'materialCheck'->>'status' = 'confirmed' then
    raise exception 'The materials for this job are already confirmed. Ask an Admin to change them.' using errcode = 'PT409'; end if;
  if jsonb_typeof(d->'usages') is distinct from 'array' or jsonb_array_length(d->'usages') not between 1 and 60 then
    raise exception 'Enter the materials used'; end if;
  for u in select value from jsonb_array_elements(d->'usages') loop
    if jsonb_typeof(u) is distinct from 'object' or exists (select 1 from jsonb_object_keys(u) k where k not in ('id', 'line', 'materialId', 'quantity')) then
      raise exception 'Invalid material usage'; end if;
    if (u->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (u->>'id')::uuid = e or (u->>'id')::uuid = any(ids) then
      raise exception 'Invalid material usage ID'; end if;
    ids := array_append(ids, (u->>'id')::uuid);
    select l.unit into line_unit from private.job_check_lines(p_shop, j.metadata) l where l.key = u->>'line';
    if not found then raise exception 'Enter the materials used for this job'; end if;
    if (u->>'line') || '|' || (u->>'materialId') = any(seen) then
      raise exception 'Choose each material once per line. To use more of one, raise its amount.'; end if;
    seen := array_append(seen, (u->>'line') || '|' || (u->>'materialId'));
    qty := (u->>'quantity')::numeric;
    if jsonb_typeof(u->'quantity') is distinct from 'number' or qty < 0 or qty > 1000000000000 or qty <> round(qty, 3) then
      raise exception 'Enter how much of each material was used (up to three decimal places)'; end if;
    select * into m from public.materials where shop_id = p_shop and id = (u->>'materialId')::uuid;
    if not found or m.archived then raise exception 'Choose an active material for each line'; end if;
    if m.measurement_unit is distinct from line_unit then
      raise exception '% is measured in %; this line is in %', m.name, m.measurement_unit, line_unit; end if;
  end loop;
  if exists (select 1 from private.job_check_lines(p_shop, j.metadata) l
             where not exists (select 1 from jsonb_array_elements(d->'usages') x where x->>'line' = l.key)) then
    raise exception 'Enter what was used for each line'; end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  prior := j.metadata->'materialCheck';
  if mode = 'request' then
    check_rec := jsonb_build_object('status', 'pending', 'usages', d->'usages', 'requestedBy', auth.uid(),
      'requestedByLabel', label, 'requestedAt', d->>'modifiedAt');
  else
    if jsonb_typeof(coalesce(d->'stockIds', '{}'::jsonb)) is distinct from 'object' then raise exception 'Invalid stock change IDs'; end if;
    -- Every material named now or taken by the job before: move it by the difference.
    for mid in
      select distinct (x->>'materialId')::uuid from jsonb_array_elements(d->'usages') x
      union
      select distinct h.material_id from public.material_stock_changes h
        where h.shop_id = p_shop and h.job_id = j.id and h.action in ('material.job_used', 'material.job_corrected', 'material.sale_returned')
    loop
      select coalesce(sum((x->>'quantity')::numeric), 0) into total from jsonb_array_elements(d->'usages') x where (x->>'materialId')::uuid = mid;
      select coalesce(sum(coalesce(h.before_available, h.after_available) - h.after_available), 0) into own
        from public.material_stock_changes h
        where h.shop_id = p_shop and h.job_id = j.id and h.material_id = mid
          and h.action in ('material.job_used', 'material.job_corrected', 'material.sale_returned');
      own := own - coalesce((select (x->>'quantity')::numeric from jsonb_array_elements(coalesce(j.metadata->'extraMaterials'->'usages', '[]'::jsonb)) x
                             where (x->>'materialId')::uuid = mid limit 1), 0);
      delta := round(total - greatest(0, round(own, 3)), 3);
      continue when delta = 0;
      sid := (d->'stockIds'->>mid::text)::uuid;
      if sid is null or sid = e or sid = any(ids) or exists (select 1 from public.ledger_events where shop_id = p_shop and id = sid) then
        raise exception 'Invalid stock change ID'; end if;
      ids := array_append(ids, sid);
      perform 1 from public.materials where shop_id = p_shop and id = mid for update;
      insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, sid, auth.uid(),
        jsonb_build_object('id', sid, 'kind', case when delta > 0 then 'material.job_used' else 'material.job_corrected' end,
          'data', jsonb_build_object('id', mid, 'jobId', j.id, 'checkoutId', j.metadata->>'checkoutId',
            'reason', 'Job ' || j.id || ' · materials confirmed in production')));
      update public.materials set available = round(private.stock_at(p_shop, mid) - delta, 3), version = version + 1,
        modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = sid
        where shop_id = p_shop and id = mid;
    end loop;
    check_rec := jsonb_build_object('status', 'confirmed', 'usages', d->'usages')
      || case when prior->>'status' = 'pending' then jsonb_build_object('requestedBy', prior->'requestedBy',
           'requestedByLabel', prior->'requestedByLabel', 'requestedAt', prior->'requestedAt') else '{}'::jsonb end
      || jsonb_build_object('confirmedBy', auth.uid(), 'confirmedByLabel', label, 'confirmedAt', d->>'modifiedAt');
  end if;
  update public.jobs set metadata = metadata || jsonb_build_object('materialCheck', check_rec)
      || case when mode = 'confirm' and metadata ? 'materialChoice' and not metadata ? 'materialUsed' then
           jsonb_build_object('materialUsed', jsonb_build_object(
             'usages', (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'materialId', x->'materialId', 'quantity', x->'quantity')), '[]'::jsonb)
                        from jsonb_array_elements(d->'usages') x),
             'confirmedBy', auth.uid(), 'confirmedByLabel', label, 'confirmedAt', d->>'modifiedAt'))
         else '{}'::jsonb end,
    version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = e
    where shop_id = p_shop and id = j.id;
end $$;

revoke all on function public.apply_job_check_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_job_check_event(uuid, jsonb) to authenticated;
revoke all on function private.job_check_lines(uuid, jsonb) from public, anon;
grant execute on function private.job_check_lines(uuid, jsonb) to authenticated;
