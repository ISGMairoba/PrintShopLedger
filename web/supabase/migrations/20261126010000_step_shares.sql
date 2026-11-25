-- Steps timed by ratio (owner, 26 Nov): a step may carry its share (%) of the job's time, next to
-- its minutes (the share of the usual turnaround). An item's own steps (services.production.steps)
-- are checked here; saved workflows live in Business Settings. Jobs keep stageShares as sent.
create or replace function private.valid_steps(p jsonb) returns boolean
language sql immutable set search_path to '' as $f$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20
    and not exists (
      select 1 from jsonb_array_elements(p) s
      where jsonb_typeof(s) <> 'object'
        or exists (select 1 from jsonb_object_keys(s) k where k not in ('name', 'minutes', 'unit', 'share'))
        or jsonb_typeof(s->'name') is distinct from 'string'
        or length(btrim(s->>'name')) not between 1 and 40 or s->>'name' ~ '[\x00-\x1f\x7f]'
        or lower(btrim(s->>'name')) in ('added', 'completed', 'collected')
        or (s ? 'minutes' and (jsonb_typeof(s->'minutes') <> 'number' or (s->>'minutes')::numeric not between 1 and 129600 or (s->>'minutes')::numeric <> trunc((s->>'minutes')::numeric)))
        or (s ? 'unit' and coalesce(s->>'unit', '') not in ('m', 'h', 'd'))
        or (s ? 'share' and (jsonb_typeof(s->'share') <> 'number' or (s->>'share')::numeric <= 0 or (s->>'share')::numeric > 100
            or (s->>'share')::numeric <> round((s->>'share')::numeric, 2))))
    and (select count(distinct lower(btrim(s->>'name'))) = count(*) from jsonb_array_elements(p) s)
    -- Shares: every step or none, adding up to 100%.
    and (not exists (select 1 from jsonb_array_elements(p) s where s ? 'share')
      or ((select count(*) from jsonb_array_elements(p) s where s ? 'share') = jsonb_array_length(p)
        and abs((select sum((s->>'share')::numeric) from jsonb_array_elements(p) s) - 100) <= 0.05))
$f$;
revoke all on function private.valid_steps(jsonb) from public, anon;
grant execute on function private.valid_steps(jsonb) to authenticated;
