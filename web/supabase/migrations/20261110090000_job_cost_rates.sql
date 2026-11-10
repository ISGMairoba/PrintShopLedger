-- Reports → Profit: keep each job's costs as they were when it was sold. The server stamps the
-- cost per unit of the job's item and of its materials on the job (metadata.costRates) when the job
-- is created, so later changes to costs (Pricing Templates → Costs) don't change old profit.
-- Template jobs already keep their cost in templateSnapshot. The app reads costRates in profit.mjs
-- and falls back to today's costs for older jobs that don't have them.

create or replace function private.cost_rates_for(p_shop uuid, p_meta jsonb) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare cost jsonb; rates jsonb := '{}'; m text; r numeric;
begin
  if coalesce(p_meta->>'serviceId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select s.costing into cost from public.services s where s.shop_id = p_shop and s.id = (p_meta->>'serviceId')::uuid;
  end if;
  for m in
    select distinct x from unnest(
      array[p_meta->>'materialId']
      || coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p_meta->'materialChoice'->'options') = 'array' then p_meta->'materialChoice'->'options' else '[]'::jsonb end)), '{}')
    ) x
    where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  loop
    r := null;
    select (s.costing->>'amount')::numeric / coalesce(nullif((s.costing->>'per')::numeric, 0), 1) into r
    from public.services s
    where s.shop_id = p_shop and s.material_id = m::uuid and not s.archived and s.costing->>'amount' is not null
    order by s.created_at, s.id limit 1;
    rates := rates || jsonb_build_object(m, r);
  end loop;
  return jsonb_build_object(
    'service', case when cost->>'amount' is not null
      then (cost->>'amount')::numeric / coalesce(nullif((cost->>'per')::numeric, 0), 1) end,
    'materials', rates,
    'at', now());
end $f$;

create or replace function private.stamp_job_cost_rates() returns trigger
language plpgsql set search_path to '' as $f$
begin
  if new.metadata ? 'templateSnapshot' then
    new.metadata := new.metadata - 'costRates';
  elsif tg_op = 'INSERT' or (new.metadata->>'serviceId') is distinct from (old.metadata->>'serviceId') then
    -- A new job, or a correction that changed the item: costs as they are now.
    new.metadata := new.metadata || jsonb_build_object('costRates', private.cost_rates_for(new.shop_id, new.metadata));
  elsif old.metadata ? 'costRates' then
    -- Any other change keeps the costs from the sale (the app cannot set or change them).
    new.metadata := new.metadata || jsonb_build_object('costRates', old.metadata->'costRates');
  else
    new.metadata := new.metadata - 'costRates';
  end if;
  return new;
end $f$;

drop trigger if exists jobs_cost_rates on public.jobs;
create trigger jobs_cost_rates before insert or update of metadata on public.jobs
  for each row execute function private.stamp_job_cost_rates();

revoke all on function private.cost_rates_for(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.stamp_job_cost_rates() from public, anon, authenticated;
