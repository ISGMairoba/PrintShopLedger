-- Correcting confirmed materials (plans/job-assignment.md, "Confirmed materials"; owner's rule of 23 Nov).
-- Once a job's materials are confirmed, a change is a correction with a reason:
--   * saved at once by someone cleared to correct (teamWork.correctRank, default Admin);
--   * sent for approval otherwise; an entry recorded by a higher rank needs that rank or above;
--   * a Manager correcting a higher rank's entry goes through, and whoever recorded it is told;
--   * if a material was stock-counted since, it always needs an approver (someone else), because the
--     count already absorbed the difference;
--   * up to teamWork.correctionDays (default 7) after the job is collected.
-- Stock history is never rewritten: the difference is a new stock change dated today, linked to the job.
-- The pending request lives on the job (metadata.materialCorrection); every correction, approved or
-- declined, is kept in metadata.materialCheck.corrections with who, when, why, before and after.
-- The app applies the same rules (src/material-corrections.mjs); keep them in step.

-- 1. A confirmed check is no longer re-confirmed: it is corrected (with a reason) instead.
do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_job_check_event_core(uuid,jsonb)'::regprocedure);
  if position('Correct them with a reason' in d) > 0 then return; end if;
  pat := 'if\s+jsonb_typeof\(d->''usages''\)\s+is\s+distinct\s+from\s+''array''';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_job_check_event_core usages pattern not found'; end if;
  d := regexp_replace(d, pat, $r$if mode = 'confirm' and j.metadata->'materialCheck'->>'status' = 'confirmed' then
    raise exception 'These materials are confirmed. Correct them with a reason (Job details → Materials used).' using errcode = 'PT409'; end if;
  if jsonb_typeof(d->'usages') is distinct from 'array'$r$);
  execute d;
end $patch$;

-- 2. Checks corrected usages against the job's lines (as apply_job_check_event_core does).
create or replace function private.material_usages_check(p_shop uuid, p_meta jsonb, p_usages jsonb, p_event uuid)
returns void language plpgsql stable security definer set search_path to '' as $f$
declare u jsonb; m public.materials%rowtype; qty numeric; line_unit text; seen text[] := '{}'; ids uuid[] := '{}';
begin
  if jsonb_typeof(p_usages) is distinct from 'array' or jsonb_array_length(p_usages) not between 1 and 60 then
    raise exception 'Enter the materials used'; end if;
  for u in select value from jsonb_array_elements(p_usages) loop
    if jsonb_typeof(u) is distinct from 'object' or exists (select 1 from jsonb_object_keys(u) k where k not in ('id', 'line', 'materialId', 'quantity')) then
      raise exception 'Invalid material usage'; end if;
    if coalesce(u->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or (u->>'id')::uuid = p_event or (u->>'id')::uuid = any(ids) then
      raise exception 'Invalid material usage ID'; end if;
    ids := array_append(ids, (u->>'id')::uuid);
    select l.unit into line_unit from private.job_check_lines(p_shop, p_meta) l where l.key = u->>'line';
    if not found then raise exception 'Enter the materials used for this job'; end if;
    if (u->>'line') || '|' || (u->>'materialId') = any(seen) then
      raise exception 'Choose each material once per line. To use more of one, raise its amount.'; end if;
    seen := array_append(seen, (u->>'line') || '|' || (u->>'materialId'));
    qty := (u->>'quantity')::numeric;
    if jsonb_typeof(u->'quantity') is distinct from 'number' or qty < 0 or qty > 1000000000000 or qty <> round(qty, 3) then
      raise exception 'Enter how much of each material was used (up to three decimal places)'; end if;
    begin select * into m from public.materials where shop_id = p_shop and id = (u->>'materialId')::uuid;
    exception when others then raise exception 'Choose an active material for each line'; end;
    if not found or m.archived then raise exception 'Choose an active material for each line'; end if;
    if m.measurement_unit is distinct from line_unit then
      raise exception '% is measured in %; this line is in %', m.name, m.measurement_unit, line_unit; end if;
  end loop;
  if exists (select 1 from private.job_check_lines(p_shop, p_meta) l
             where not exists (select 1 from jsonb_array_elements(p_usages) x where x->>'line' = l.key)) then
    raise exception 'Enter what was used for each line'; end if;
end $f$;
revoke all on function private.material_usages_check(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;

-- 3. The stock moves for new usages: per material, the difference from what the job has taken itself.
create or replace function private.material_correction_plan(p_shop uuid, p_job uuid, p_meta jsonb, p_usages jsonb)
returns table(material_id uuid, delta numeric) language sql stable security definer set search_path to '' as $f$
  with ids as (
    select distinct (x->>'materialId')::uuid as mid from jsonb_array_elements(p_usages) x
    union
    select distinct h.material_id from public.material_stock_changes h
      where h.shop_id = p_shop and h.job_id = p_job and h.action in ('material.job_used', 'material.job_corrected', 'material.sale_returned')
  ), calc as (
    select i.mid,
      (select coalesce(sum((x->>'quantity')::numeric), 0) from jsonb_array_elements(p_usages) x where (x->>'materialId')::uuid = i.mid) as total,
      (select coalesce(sum(coalesce(h.before_available, h.after_available) - h.after_available), 0) from public.material_stock_changes h
        where h.shop_id = p_shop and h.job_id = p_job and h.material_id = i.mid
          and h.action in ('material.job_used', 'material.job_corrected', 'material.sale_returned'))
      - coalesce((select (x->>'quantity')::numeric from jsonb_array_elements(coalesce(p_meta->'extraMaterials'->'usages', '[]'::jsonb)) x
                  where (x->>'materialId')::uuid = i.mid limit 1), 0) as own
    from ids i
  )
  select mid, round(total - greatest(0, round(own, 3)), 3) from calc where round(total - greatest(0, round(own, 3)), 3) <> 0
$f$;
revoke all on function private.material_correction_plan(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;

-- 4. Correcting, and deciding a request.
create or replace function private.apply_job_material_correction_core(p_shop uuid, p_event jsonb)
returns void language plpgsql security definer set search_path to '' as $f$
declare
  d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; k text := p_event->>'kind'; me uuid := auth.uid();
  j public.jobs%rowtype; payload jsonb; actor uuid; lvl int; label text; tw jsonb; mc jsonb; req jsonb;
  recorder uuid; recorder_rank int; since timestamptz; counted boolean := false; route text; reason text;
  usages jsonb; by_id uuid; by_label text; by_rank int; entry jsonb; p record; sid uuid; ids uuid[] := '{}';
  m public.materials%rowtype; rid uuid;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if k not in ('job.materials_corrected', 'job.material_correction_decided') or (d->>'modifiedBy')::uuid is distinct from me or e is null then
    raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> me then raise exception 'Operation ID already used'; end if; return; end if;
  select access_level, name into lvl, label from public.shop_members where shop_id = p_shop and user_id = me and not archived;
  if not found or lvl < 1 then raise exception 'Business access denied'; end if;
  tw := private.team_settings(p_shop);
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  if j.production_status = 'Cancelled' then raise exception 'This job is cancelled' using errcode = 'PT409'; end if;
  mc := j.metadata->'materialCheck';
  if mc->>'status' is distinct from 'confirmed' then raise exception 'Only confirmed materials are corrected' using errcode = 'PT409'; end if;
  begin rid := (d->>'requestId')::uuid; exception when others then raise exception 'Invalid correction'; end;
  if rid is null then raise exception 'Invalid correction'; end if;

  if k = 'job.materials_corrected' then
    if j.metadata ? 'materialCorrection' then
      raise exception 'A correction of these materials is waiting for approval' using errcode = 'PT409'; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(mc->'corrections', '[]'::jsonb)) c where c->>'id' = rid::text) then
      raise exception 'Invalid correction'; end if;
    reason := btrim(coalesce(d->>'reason', ''));
    if jsonb_typeof(d->'reason') is distinct from 'string' or length(reason) not between 3 and 300 then
      raise exception 'Give a reason for the correction'; end if;
    if j.production_status = 'Collected' and coalesce((j.metadata->>'stageAt')::timestamptz, j.modified_at, now())
        < now() - make_interval(days => (tw->>'correctionDays')::int) then
      raise exception 'Materials can be corrected up to % days after the job is collected', tw->>'correctionDays';
    end if;
    usages := d->'usages';
    perform private.material_usages_check(p_shop, j.metadata, usages, e);
    if (select jsonb_agg(x - 'id' order by n) from jsonb_array_elements(usages) with ordinality u(x, n))
       = (select jsonb_agg(x - 'id' order by n) from jsonb_array_elements(mc->'usages') with ordinality u(x, n)) then raise exception 'Change at least one amount or material'; end if;
    -- Whose entry it is: who last recorded the usages (not who confirmed someone else's entry).
    recorder := coalesce(mc->>'recordedBy', mc->>'requestedBy', mc->>'confirmedBy')::uuid;
    recorder_rank := coalesce((mc->>'recordedByRank')::int,
      (select access_level from public.shop_members where shop_id = p_shop and user_id = recorder), 0);
    since := coalesce((mc->>'correctedAt')::timestamptz, (mc->>'confirmedAt')::timestamptz, j.modified_at);
    select exists (select 1 from private.material_correction_plan(p_shop, j.id, j.metadata, usages) pl
      join public.material_stock_changes h on h.shop_id = p_shop and h.material_id = pl.material_id
      where h.action = 'material.stock_set' and h.created_at > since) into counted;
    route := case
      when counted then 'request'
      when recorder_rank > lvl and lvl = 3 and lvl >= (tw->>'correctRank')::int then 'alert'
      when recorder_rank > lvl then 'request'
      when lvl >= (tw->>'correctRank')::int then 'direct'
      else 'request' end;
    if d->>'route' is distinct from route then
      raise exception 'This correction now goes another way (%). Sync and try again.', route using errcode = 'PT409'; end if;
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event);
    if route = 'request' then
      update public.jobs set metadata = metadata || jsonb_build_object('materialCorrection', jsonb_build_object(
          'id', rid, 'usages', usages, 'before', mc->'usages', 'reason', reason, 'requestedBy', me, 'requestedByLabel', label,
          'requestedByRank', lvl, 'requestedAt', d->>'modifiedAt',
          'approverRank', greatest((tw->>'correctRank')::int, recorder_rank), 'counted', counted)),
        version = version + 1, modified_by = me, modified_by_label = label, modified_at = now(), last_event_id = e
        where shop_id = p_shop and id = j.id;
      return;
    end if;
    by_id := me; by_label := label; by_rank := lvl;
    entry := jsonb_build_object('id', rid, 'status', 'applied', 'at', d->>'modifiedAt', 'by', me, 'byLabel', label, 'byRank', lvl,
      'reason', reason, 'before', mc->'usages', 'after', usages, 'alert', route = 'alert')
      || case when route = 'alert' then jsonb_build_object('alertFor', recorder) else '{}'::jsonb end;
  else
    req := j.metadata->'materialCorrection';
    if req is null or req->>'id' is distinct from rid::text then raise exception 'This request is not waiting for a decision' using errcode = 'PT409'; end if;
    if lvl < (req->>'approverRank')::int then raise exception 'This correction needs someone of a higher rank'; end if;
    if (req->>'requestedBy')::uuid = me then raise exception 'Someone else decides your own correction'; end if;
    if jsonb_typeof(d->'approve') is distinct from 'boolean' then raise exception 'Approve or decline the correction'; end if;
    if (d->>'approve')::boolean and req->'before' is distinct from mc->'usages' then
      raise exception 'The materials changed after this request. Decline it and ask again.' using errcode = 'PT409'; end if;
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event);
    if not (d->>'approve')::boolean then
      update public.jobs set metadata = (metadata - 'materialCorrection') || jsonb_build_object('materialCheck', mc || jsonb_build_object(
          'corrections', coalesce(mc->'corrections', '[]'::jsonb) || jsonb_build_array((req - 'approverRank' - 'usages' - 'before'
            - 'requestedBy' - 'requestedByLabel' - 'requestedByRank' - 'requestedAt') || jsonb_build_object('status', 'declined',
            'at', req->>'requestedAt', 'by', req->'requestedBy', 'byLabel', req->'requestedByLabel', 'byRank', req->'requestedByRank',
            'before', req->'before', 'after', req->'usages', 'decidedBy', me, 'decidedByLabel', label, 'decidedAt', d->>'modifiedAt',
            'note', left(btrim(coalesce(d->>'note', '')), 300))))),
        version = version + 1, modified_by = me, modified_by_label = label, modified_at = now(), last_event_id = e
        where shop_id = p_shop and id = j.id;
      return;
    end if;
    usages := req->'usages'; reason := req->>'reason';
    by_id := (req->>'requestedBy')::uuid; by_label := req->>'requestedByLabel'; by_rank := (req->>'requestedByRank')::int;
    entry := jsonb_build_object('id', rid, 'status', 'applied', 'at', req->>'requestedAt', 'by', by_id, 'byLabel', by_label,
      'byRank', by_rank, 'reason', reason, 'before', req->'before', 'after', usages, 'counted', req->'counted',
      'approvedBy', me, 'approvedByLabel', label, 'approvedAt', d->>'modifiedAt', 'alert', false);
  end if;

  -- Apply: a new stock change dated today for each difference, linked to the job.
  if jsonb_typeof(coalesce(d->'stockIds', '{}'::jsonb)) is distinct from 'object' then raise exception 'Invalid stock change IDs'; end if;
  for p in select * from private.material_correction_plan(p_shop, j.id, j.metadata, usages) order by material_id loop
    begin sid := (d->'stockIds'->>p.material_id::text)::uuid; exception when others then sid := null; end;
    if sid is null or sid = e or sid = rid or sid = any(ids) or exists (select 1 from public.ledger_events where shop_id = p_shop and id = sid) then
      raise exception 'Invalid stock change ID'; end if;
    ids := array_append(ids, sid);
    select * into m from public.materials where shop_id = p_shop and id = p.material_id for update;
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, sid, me,
      jsonb_build_object('id', sid, 'kind', case when p.delta > 0 then 'material.job_used' else 'material.job_corrected' end,
        'data', jsonb_build_object('id', p.material_id, 'jobId', j.id, 'checkoutId', j.metadata->>'checkoutId',
          'reason', format('Correction: %s %s %s used on job #%s · %s', trim_scale(abs(p.delta)), m.measurement_unit,
            case when p.delta > 0 then 'more' else 'fewer' end, upper(left(j.id::text, 8)), reason))));
    update public.materials set available = round(private.stock_at(p_shop, p.material_id) - p.delta, 3), version = version + 1,
      modified_by = me, modified_by_label = label, modified_at = now(), last_event_id = sid
      where shop_id = p_shop and id = p.material_id;
  end loop;
  update public.jobs set metadata = (metadata - 'materialCorrection') || jsonb_build_object('materialCheck', mc || jsonb_build_object(
        'usages', usages, 'recordedBy', by_id, 'recordedByLabel', by_label, 'recordedByRank', by_rank,
        'correctedAt', now(), 'corrections', coalesce(mc->'corrections', '[]'::jsonb) || jsonb_build_array(entry)))
      || case when metadata ? 'materialChoice' and metadata ? 'materialUsed' then jsonb_build_object('materialUsed', metadata->'materialUsed'
           || jsonb_build_object('usages', (select coalesce(jsonb_agg(jsonb_build_object('id', x->'id', 'materialId', x->'materialId', 'quantity', x->'quantity')), '[]'::jsonb)
                from jsonb_array_elements(usages) x)))
         else '{}'::jsonb end,
    version = version + 1, modified_by = me, modified_by_label = label, modified_at = now(), last_event_id = e
    where shop_id = p_shop and id = j.id;
end $f$;
revoke all on function private.apply_job_material_correction_core(uuid, jsonb) from public, anon, authenticated;

create or replace function public.apply_job_material_correction_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.assert_job_branch(p_shop, p_event->'data'->>'id');
  perform private.apply_job_material_correction_core(p_shop, p_event);
end $f$;
revoke all on function public.apply_job_material_correction_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_job_material_correction_event(uuid, jsonb) to authenticated;
