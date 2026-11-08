-- Workflow steps: items (services and templates) can keep their own steps between Added and
-- Completed, each with a time from 1 minute to 90 days. Saved workflows live in the business
-- options (checked by the app); the server checks what reaches it: a service's steps and a job's
-- hours per stage.

-- A service's own steps: up to 20, unique names up to 40 characters (not the fixed stages), each
-- with an optional time in whole minutes and the unit it was typed in.
create or replace function private.valid_steps(p jsonb) returns boolean
language sql immutable set search_path to '' as $f$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20
    and not exists (
      select 1 from jsonb_array_elements(p) s
      where jsonb_typeof(s) <> 'object'
        or exists (select 1 from jsonb_object_keys(s) k where k not in ('name', 'minutes', 'unit'))
        or jsonb_typeof(s->'name') is distinct from 'string'
        or length(btrim(s->>'name')) not between 1 and 40 or s->>'name' ~ '[\x00-\x1f\x7f]'
        or lower(btrim(s->>'name')) in ('added', 'completed', 'collected')
        or (s ? 'minutes' and (jsonb_typeof(s->'minutes') <> 'number' or (s->>'minutes')::numeric not between 1 and 129600 or (s->>'minutes')::numeric <> trunc((s->>'minutes')::numeric)))
        or (s ? 'unit' and coalesce(s->>'unit', '') not in ('m', 'h', 'd')))
    and (select count(distinct lower(btrim(s->>'name'))) = count(*) from jsonb_array_elements(p) s)
$f$;

create or replace function private.service_production(p jsonb) returns jsonb
language plpgsql immutable set search_path to '' as $f$
declare per numeric;
begin
  if p is null or p = 'null'::jsonb then return '{}'::jsonb; end if;
  if jsonb_typeof(p) <> 'object' or exists (select 1 from jsonb_object_keys(p) k where k not in ('extraMaterials', 'costCovered', 'perItem', 'workflowId', 'steps'))
     or (p ? 'extraMaterials' and jsonb_typeof(p->'extraMaterials') <> 'boolean') or (p ? 'costCovered' and jsonb_typeof(p->'costCovered') <> 'boolean')
     or (p ? 'perItem' and jsonb_typeof(p->'perItem') <> 'number')
     or (p ? 'workflowId' and p->'workflowId' <> 'null'::jsonb and (jsonb_typeof(p->'workflowId') <> 'string' or p->>'workflowId' !~* '^[0-9a-z-]{8,40}$'))
     or (p ? 'steps' and p->'steps' <> 'null'::jsonb and not private.valid_steps(p->'steps')) then
    raise exception 'Invalid production settings';
  end if;
  per := coalesce((p->>'perItem')::numeric, 1);
  if per <= 0 or per > 10000 or per <> round(per, 3) then raise exception 'Enter how much material one item uses: more than 0, up to three decimal places'; end if;
  return case when (p->>'extraMaterials')::boolean then jsonb_build_object('extraMaterials', true) else '{}'::jsonb end
    || case when (p->>'extraMaterials')::boolean and (p->>'costCovered')::boolean then jsonb_build_object('costCovered', true) else '{}'::jsonb end
    || case when per <> 1 then jsonb_build_object('perItem', per) else '{}'::jsonb end
    || case when nullif(p->>'workflowId', '') is not null then jsonb_build_object('workflowId', p->>'workflowId') else '{}'::jsonb end
    || case when jsonb_typeof(p->'steps') = 'array' then jsonb_build_object('steps', p->'steps') else '{}'::jsonb end;
end $f$;

-- A job's hours per stage: from 1 minute (0.0167 hours) to 90 days.
create or replace function private.valid_stage_hours(p jsonb) returns boolean
language sql immutable set search_path to '' as $f$
  select p is null or (jsonb_typeof(p) = 'object' and (select count(*) from jsonb_object_keys(p)) <= 20
    and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) <> 'number' or (e.value#>>'{}')::numeric not between 0.0166 and 2160 or length(e.key) > 80))
$f$;

revoke all on function private.valid_steps(jsonb) from public, anon;
grant execute on function private.valid_steps(jsonb) to authenticated;
