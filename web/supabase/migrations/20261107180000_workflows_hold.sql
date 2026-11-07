-- Workflows per job and On hold.
-- * Items name a workflow (services.production.workflowId; templates keep it in Business Settings).
--   A job copies its workflow's stages (already allowed) and hours (stageHours) and name at the sale.
-- * job.held / job.resumed (apply_job_hold_event): anyone who can move jobs puts a job on hold with
--   a reason, or resumes it. A held job cannot move to another stage; its stage clock stops.

-- Services may name a workflow.
create or replace function private.service_production(p jsonb) returns jsonb
language plpgsql immutable set search_path to '' as $f$
declare per numeric;
begin
  if p is null or p = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('extraMaterials', 'costCovered', 'perItem', 'workflowId'))
     or (p ? 'extraMaterials' and jsonb_typeof(p->'extraMaterials') <> 'boolean') or (p ? 'costCovered' and jsonb_typeof(p->'costCovered') <> 'boolean')
     or (p ? 'perItem' and jsonb_typeof(p->'perItem') <> 'number')
     or (p ? 'workflowId' and p->'workflowId' <> 'null'::jsonb and (jsonb_typeof(p->'workflowId') <> 'string' or p->>'workflowId' !~* '^[0-9a-z-]{8,40}$')) then
    raise exception 'Invalid production settings';
  end if;
  per := coalesce((p->>'perItem')::numeric, 1);
  if per <= 0 or per > 10000 or per <> round(per, 3) then raise exception 'Enter how much material one item uses: more than 0, up to three decimal places'; end if;
  return case when (p->>'extraMaterials')::boolean then jsonb_build_object('extraMaterials', true) else '{}'::jsonb end
    || case when (p->>'extraMaterials')::boolean and (p->>'costCovered')::boolean then jsonb_build_object('costCovered', true) else '{}'::jsonb end
    || case when per <> 1 then jsonb_build_object('perItem', per) else '{}'::jsonb end
    || case when nullif(p->>'workflowId', '') is not null then jsonb_build_object('workflowId', p->>'workflowId') else '{}'::jsonb end;
end $f$;

-- A job's hours per stage and workflow name, checked at the sale.
create or replace function private.valid_stage_hours(p jsonb) returns boolean
language sql immutable set search_path to '' as $f$
  select p is null or (jsonb_typeof(p) = 'object' and (select count(*) from jsonb_object_keys(p)) <= 20
    and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'number' or (e.value#>>'{}')::numeric not between 0.25 and 2160 or length(e.key) > 80))
$f$;

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  pat := $$if line ? 'workflow' and not private.valid_job_workflow(line->'workflow') then raise exception 'Invalid job workflow';end if;$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_checkout_event pattern not found'; end if;
  execute replace(d, pat, pat || $$
  if not private.valid_stage_hours(line->'stageHours') or (line ? 'workflowName' and (jsonb_typeof(line->'workflowName') <> 'string' or length(line->>'workflowName') > 60)) then raise exception 'Invalid job workflow';end if;$$);

  d := pg_get_functiondef('public.apply_job_status_event(uuid,jsonb)'::regprocedure);
  pat := $$jsonb_build_object('stageAt',now())$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_job_status_event stage pattern not found'; end if;
  d := replace(d, pat, $$jsonb_build_object('stageAt',now(),'stageHeldMs',0)$$);
  pat := $$if private.material_confirm_due(j.metadata,next_status) then$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_job_status_event hold pattern not found'; end if;
  execute replace(d, pat, $$if j.metadata ? 'hold' then raise exception 'This job is on hold. Resume it before moving it on.' using errcode='PT409';end if;
$$ || pat);
end $patch$;

create or replace function public.apply_job_hold_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; k text := p_event->>'kind'; j public.jobs%rowtype; payload jsonb; actor uuid; label text;
  note text; hold jsonb; held_ms bigint; meta jsonb;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if k not in ('job.held', 'job.resumed') or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  meta := j.metadata;
  if k = 'job.held' then
    if meta ? 'hold' then raise exception 'This job is already on hold' using errcode = 'PT409'; end if;
    if j.production_status in ('Completed', 'Collected', 'Cancelled') then raise exception 'Only jobs still in production can be put on hold' using errcode = 'PT409'; end if;
    if coalesce(d->>'reason', '') not in ('Waiting for design approval', 'Waiting for balance payment', 'Waiting for materials', 'Customer not reachable', 'Other') then raise exception 'Choose why the job is on hold'; end if;
    note := btrim(coalesce(d->>'note', ''));
    if length(note) > 300 then raise exception 'Keep the note to 300 characters'; end if;
    if d->>'reason' = 'Other' and note = '' then raise exception 'Say what the job is waiting for'; end if;
    meta := meta || jsonb_build_object('hold', jsonb_build_object('reason', d->>'reason', 'note', note, 'heldBy', auth.uid(), 'heldByLabel', label, 'heldAt', now(), 'stage', j.production_status));
  else
    if not meta ? 'hold' then raise exception 'This job is not on hold' using errcode = 'PT409'; end if;
    hold := meta->'hold';
    held_ms := greatest(0, (extract(epoch from now() - (hold->>'heldAt')::timestamptz) * 1000)::bigint);
    meta := (meta - 'hold') || jsonb_build_object(
      'stageHeldMs', coalesce((meta->>'stageHeldMs')::bigint, 0) + case when hold->>'stage' = j.production_status then held_ms else 0 end,
      'holdHistory', (select coalesce(jsonb_agg(x.v order by x.n), '[]') from (
          select v, n from jsonb_array_elements(coalesce(meta->'holdHistory', '[]') || jsonb_build_array(hold || jsonb_build_object('resumedBy', auth.uid(), 'resumedByLabel', label, 'resumedAt', now()))) with ordinality h(v, n)
          order by n desc limit 50) x));
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.jobs set metadata = meta, version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = j.id;
end $f$;
revoke all on function public.apply_job_hold_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_job_hold_event(uuid, jsonb) to authenticated;
revoke all on function private.valid_stage_hours(jsonb) from public, anon;
grant execute on function private.valid_stage_hours(jsonb) to authenticated;
