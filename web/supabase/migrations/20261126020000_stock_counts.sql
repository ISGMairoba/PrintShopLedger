-- Stock counts, shelves and when materials leave stock (owner, 26 Nov; plans/stock-count-and-stage-ratio.md).
--
-- 1. Stock counts (Stock → Count): a count is saved as it is typed (count.saved, anyone in the business),
--    then finished by an Admin or higher (count.finished), or cancelled (count.cancelled). Finishing
--    sets each counted material to what was counted plus what moved since that row was counted, so
--    selling during a count does not make a false shortage. Each difference is a normal stock count
--    (material.stock_set, "Stock count: <name>"), and the count keeps expected, counted, difference
--    and value per line. Big differences (production.stockCount: flagPercent, flagValue) need the
--    rank in production.stockCount.approveRank to finish.
-- 2. Shelves: where each material is kept (count.shelf_set, Admin and higher), to count shelf by shelf.
-- 3. When materials leave stock: production.materialsAt 'checkout' (as before) or 'production', and a
--    service may choose its own (services.production.materialsAt). In production, a sale takes
--    nothing: the job is marked materialsAt 'production', its materials are reserved, and its
--    materials check takes what was really used (the check already moves stock by the difference
--    from what the job took). Shelf items always leave at the sale. With "Stock below zero: block",
--    a sale is refused when stock less what is reserved would not cover it.
-- 4. The Stock Count page joins page access (version 4: everyone who opens Materials gets it).
-- Records live in stock_records and come down with the ledger (private.stock_for).

create table if not exists public.stock_records (
  shop_id uuid not null references public.shops(id) on delete cascade,
  collection text not null check (collection in ('stockCounts', 'materialShelves')),
  id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  branch_id text,
  sync_xid xid8 not null default pg_current_xact_id(),
  primary key (shop_id, collection, id)
);
create index if not exists stock_records_xid on public.stock_records (shop_id, sync_xid);
alter table public.stock_records enable row level security;
drop policy if exists member_read on public.stock_records;
create policy member_read on public.stock_records for select to authenticated
  using (shop_id in (select private.my_shops()) and current_setting('psl.ledger', true) = 'on');
revoke all on public.stock_records from public, anon, authenticated;
grant select on public.stock_records to authenticated;
drop trigger if exists touch_sync_xid on public.stock_records;
create trigger touch_sync_xid before insert or update on public.stock_records
  for each row execute function private.touch_sync_xid();

-- The stock-count settings, with their defaults.
create or replace function private.stock_count_settings(p_shop uuid) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('flagPercent', 5, 'flagValue', 500000, 'approveRank', 2)
    || coalesce(private.branch_settings(p_shop, private.request_branch(p_shop))->'production'->'stockCount', '{}'::jsonb)
$f$;
revoke all on function private.stock_count_settings(uuid) from public, anon;
grant execute on function private.stock_count_settings(uuid) to authenticated;

-- When a service's materials leave stock: 'checkout' or 'production'.
create or replace function private.materials_at(p_shop uuid, p_service public.services) returns text
language sql stable security definer set search_path to '' as $f$
  select case
    when coalesce(p_service.shelf_item, false) then 'checkout'
    when p_service.production->>'materialsAt' in ('checkout', 'production') then p_service.production->>'materialsAt'
    when private.branch_settings(p_shop, private.request_branch(p_shop))->'production'->>'materialsAt' = 'production' then 'production'
    else 'checkout' end
$f$;
revoke all on function private.materials_at(uuid, public.services) from public, anon;
grant execute on function private.materials_at(uuid, public.services) to authenticated;

-- What open jobs that take their materials in production have reserved of a material (except one job).
create or replace function private.material_reserved(p_shop uuid, p_material uuid, p_except uuid default null) returns numeric
language sql stable security definer set search_path to '' as $f$
  select coalesce(sum(
      case when j.metadata->>'materialId' = p_material::text then coalesce((j.metadata->>'materialNeeded')::numeric, 0) else 0 end
      + coalesce((select sum((s->>'quantity')::numeric) from jsonb_array_elements(coalesce(j.metadata->'templateSnapshot'->'stock', '[]'::jsonb)) s
                  where s->>'materialId' = p_material::text), 0)), 0)
  from public.jobs j
  where j.shop_id = p_shop and j.metadata->>'materialsAt' = 'production' and j.production_status <> 'Cancelled'
    and coalesce(j.metadata->'materialCheck'->>'status', '') <> 'confirmed'
    and (p_except is null or j.id <> p_except)
$f$;
revoke all on function private.material_reserved(uuid, uuid, uuid) from public, anon;
grant execute on function private.material_reserved(uuid, uuid, uuid) to authenticated;

-- A sale that takes in production: with "Stock below zero: block", stock less what is reserved must cover it.
create or replace function private.check_reserve(p_shop uuid, p_material uuid, p_needed numeric, p_job uuid) returns void
language plpgsql stable security definer set search_path to '' as $f$
declare m public.materials; free numeric;
begin
  if p_needed <= 0 or coalesce(private.branch_settings(p_shop, private.request_branch(p_shop))->'jobs'->>'stockBelowZero', '') <> 'block' then return; end if;
  select * into m from public.materials where shop_id = p_shop and id = p_material;
  if not found then return; end if;
  free := private.stock_at(p_shop, p_material) - private.material_reserved(p_shop, p_material, p_job);
  if free - p_needed < 0 then
    raise exception 'Not enough %: % % free (the rest is reserved for jobs), this needs %. Ask an admin to update the stock first.',
      m.name, trim_scale(greatest(free, 0)), m.measurement_unit, trim_scale(p_needed) using errcode = 'PT409';
  end if;
end $f$;
revoke all on function private.check_reserve(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function private.check_reserve(uuid, uuid, numeric, uuid) to authenticated;

-- Stock as it was at a time, at this device's location: now, less every change since.
create or replace function private.stock_as_of(p_shop uuid, p_material uuid, p_at timestamptz) returns numeric
language sql stable security definer set search_path to '' as $f$
  select private.stock_at(p_shop, p_material) - coalesce((select sum(h.after_available - coalesce(h.before_available, 0))
    from public.material_stock_changes h
    where h.shop_id = p_shop and h.material_id = p_material and h.created_at > p_at
      and h.branch_id is not distinct from private.stock_location(p_shop)), 0)
$f$;
revoke all on function private.stock_as_of(uuid, uuid, timestamptz) from public, anon;
grant execute on function private.stock_as_of(uuid, uuid, timestamptz) to authenticated;

create or replace function public.apply_stock_count_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare
  d jsonb := p_event->'data'; k text := p_event->>'kind'; e uuid; me uuid := auth.uid(); lvl int; label text;
  existing public.stock_records; payload jsonb; actor uuid; l jsonb; m public.materials; lines jsonb := '[]'; settings jsonb;
  counted numeric; expected numeric; now_qty numeric; target numeric; diff numeric; unit_cost numeric; val numeric;
  flagged boolean := false; sid uuid; ids uuid[] := '{}'; seen uuid[] := '{}'; at timestamptz; loc text;
begin
  if jsonb_typeof(d) is distinct from 'object' or (p_event->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid stock count change'; end if;
  e := (p_event->>'id')::uuid;
  if (d->>'modifiedBy')::uuid is distinct from me then raise exception 'Invalid audit identity'; end if;
  select n.lvl, n.label into lvl, label from private.notice_member(p_shop) n;
  if lvl is null then raise exception 'Business access denied'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where le.shop_id = p_shop and le.id = e;
  if found then if payload <> p_event or actor <> me then raise exception 'Operation ID already used'; end if; return; end if;
  loc := private.stock_location(p_shop);

  if k = 'count.shelf_set' then
    if lvl < 2 then raise exception 'Only an Admin or higher can set where materials are kept'; end if;
    if not exists (select 1 from public.materials where shop_id = p_shop and id = (d->>'id')::uuid) then raise exception 'Material not found'; end if;
    if jsonb_typeof(d->'shelf') is distinct from 'string' or length(btrim(d->>'shelf')) > 80 or d->>'shelf' ~ '[\x00-\x1f\x7f]' then
      raise exception 'Enter the shelf or area in up to 80 characters'; end if;
    insert into public.stock_records (shop_id, collection, id, data, branch_id)
    values (p_shop, 'materialShelves', (d->>'id')::uuid, jsonb_build_object('id', d->>'id', 'shelf', btrim(d->>'shelf'),
      'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now()), null)
    on conflict (shop_id, collection, id) do update set data = excluded.data;
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event);
    return;
  end if;

  if (d->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid stock count'; end if;
  select * into existing from public.stock_records where shop_id = p_shop and collection = 'stockCounts' and id = (d->>'id')::uuid for update;
  if found and coalesce((d->>'baseVersion')::int, -1) <> (existing.data->>'version')::int then
    raise exception 'This count changed on another device. Reopen it to see the latest.' using errcode = 'PT409'; end if;
  if found and existing.data->>'status' <> 'open' then raise exception 'This count is already %', existing.data->>'status' using errcode = 'PT409'; end if;

  if k = 'count.saved' then
    if not found and coalesce((d->>'baseVersion')::int, 0) <> 0 then raise exception 'This count was not found' using errcode = 'PT409'; end if;
    if jsonb_typeof(d->'name') is distinct from 'string' or length(btrim(d->>'name')) not between 1 and 80 or d->>'name' ~ '[\x00-\x1f\x7f]' then
      raise exception 'Give the count a name up to 80 characters'; end if;
    if jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_array_length(d->'lines') not between 1 and 2000 then
      raise exception 'Choose 1 to 2,000 materials to count'; end if;
    if jsonb_typeof(coalesce(d->'scope', '{}'::jsonb)) <> 'object' or length((coalesce(d->'scope', '{}'::jsonb))::text) > 4000 then
      raise exception 'Invalid count scope'; end if;
    for l in select x.value from jsonb_array_elements(d->'lines') x loop
      if jsonb_typeof(l) <> 'object' or exists (select 1 from jsonb_object_keys(l) kk where kk not in ('materialId', 'counted', 'countedAt', 'countedBy', 'countedByLabel', 'note'))
         or not exists (select 1 from public.materials where shop_id = p_shop and id = (l->>'materialId')::uuid) or (l->>'materialId')::uuid = any(seen) then
        raise exception 'Invalid count line'; end if;
      seen := array_append(seen, (l->>'materialId')::uuid);
      if l ? 'counted' and l->'counted' <> 'null'::jsonb and (jsonb_typeof(l->'counted') <> 'number' or (l->>'counted')::numeric < 0
         or (l->>'counted')::numeric > 1000000000000 or (l->>'counted')::numeric <> round((l->>'counted')::numeric, 3)
         or (l->>'countedAt') is null or (l->>'countedAt')::timestamptz > now() + interval '10 minutes') then
        raise exception 'Enter each count from 0, with up to three decimal places'; end if;
      if length(coalesce(l->>'note', '')) > 200 then raise exception 'Keep each note to 200 characters'; end if;
    end loop;
    insert into public.stock_records (shop_id, collection, id, data, branch_id)
    values (p_shop, 'stockCounts', (d->>'id')::uuid, jsonb_build_object('id', d->>'id', 'name', btrim(d->>'name'),
        'scope', coalesce(d->'scope', '{}'::jsonb), 'lines', d->'lines', 'status', 'open', 'version', 1, 'branch', coalesce(loc, 'main'),
        'createdBy', me, 'createdByLabel', label, 'createdAt', now(), 'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now()), loc)
    on conflict (shop_id, collection, id) do update set data = public.stock_records.data || jsonb_build_object('name', btrim(d->>'name'),
        'scope', coalesce(d->'scope', '{}'::jsonb), 'lines', d->'lines', 'version', (public.stock_records.data->>'version')::int + 1,
        'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now());

  elsif k = 'count.cancelled' then
    if not found then raise exception 'This count was not found' using errcode = 'PT409'; end if;
    if lvl < 2 and (existing.data->>'createdBy')::uuid is distinct from me then raise exception 'Only an Admin or who started it can cancel this count'; end if;
    update public.stock_records set data = data || jsonb_build_object('status', 'cancelled', 'version', (data->>'version')::int + 1,
        'cancelledBy', me, 'cancelledByLabel', label, 'cancelledAt', now())
      where shop_id = p_shop and collection = 'stockCounts' and id = existing.id;

  elsif k = 'count.finished' then
    if not found then raise exception 'This count was not found' using errcode = 'PT409'; end if;
    if lvl < 2 then raise exception 'Only an Admin or higher can finish a count'; end if;
    if jsonb_typeof(coalesce(d->'stockIds', '{}'::jsonb)) <> 'object' then raise exception 'Invalid stock change IDs'; end if;
    settings := private.stock_count_settings(p_shop);
    for l in select x.value from jsonb_array_elements(existing.data->'lines') x loop
      if l->'counted' is null or l->'counted' = 'null'::jsonb then lines := lines || jsonb_build_array(l); continue; end if;
      select * into m from public.materials where shop_id = p_shop and id = (l->>'materialId')::uuid for update;
      if not found or m.archived then lines := lines || jsonb_build_array(l || '{"skipped":"archived"}'); continue; end if;
      counted := (l->>'counted')::numeric; at := (l->>'countedAt')::timestamptz;
      expected := round(private.stock_as_of(p_shop, m.id, at), 3);
      now_qty := round(private.stock_at(p_shop, m.id), 3);
      -- What moved since the row was counted still counts: target = counted + (now - then).
      target := round(counted + (now_qty - expected), 3);
      diff := round(counted - expected, 3);
      unit_cost := m.cost_price;
      val := case when unit_cost is null then null else round(diff * unit_cost) end;
      if diff <> 0 and (expected = 0 or abs(diff) * 100 > abs(expected) * (settings->>'flagPercent')::numeric
          or (val is not null and abs(val) > (settings->>'flagValue')::numeric)) then flagged := true; end if;
      if target <> now_qty then
        sid := (d->'stockIds'->>m.id::text)::uuid;
        if sid is null or sid = e or sid = any(ids) or exists (select 1 from public.ledger_events where shop_id = p_shop and id = sid) then
          raise exception 'Invalid stock change ID'; end if;
        ids := array_append(ids, sid);
        insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, sid, me,
          jsonb_build_object('id', sid, 'kind', 'material.stock_set', 'data', jsonb_build_object('id', m.id, 'quantity', target,
            'reason', 'Stock count: ' || (existing.data->>'name'), 'countId', existing.id)));
        update public.materials set available = target, version = version + 1, modified_by = me, modified_by_label = label,
          modified_at = now(), last_event_id = sid where shop_id = p_shop and id = m.id;
      end if;
      lines := lines || jsonb_build_array(l || jsonb_build_object('expected', expected, 'difference', diff, 'setTo', target,
        'stockEventId', case when target <> now_qty then sid end)
        || case when val is null then '{}'::jsonb else jsonb_build_object('unitCost', unit_cost, 'value', val) end);
    end loop;
    if flagged and lvl < (settings->>'approveRank')::int then
      raise exception 'This count has big differences: someone of a higher rank must finish it (Business Settings → Jobs & payments).' using errcode = 'PT409';
    end if;
    update public.stock_records set data = data || jsonb_build_object('status', 'finished', 'lines', lines, 'version', (data->>'version')::int + 1,
        'finishedBy', me, 'finishedByLabel', label, 'finishedAt', now(), 'flagged', flagged)
      where shop_id = p_shop and collection = 'stockCounts' and id = existing.id;
  else
    raise exception 'Unknown stock count change';
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event);
end $f$;
revoke all on function public.apply_stock_count_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_stock_count_event(uuid, jsonb) to authenticated;

-- For the download: counts (a branch sees its own) and shelves, all or changed since p_since.
create or replace function private.stock_for(p_shop uuid, p_keep text, p_since xid8 default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  if not public.is_shop_member(p_shop) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'stockCounts', (select coalesce(jsonb_agg(r.data order by r.data->>'createdAt', r.id), '[]'::jsonb) from public.stock_records r
      where r.shop_id = p_shop and r.collection = 'stockCounts' and (p_since is null or r.sync_xid >= p_since)
        and (p_keep is null or coalesce(r.branch_id, 'main') = p_keep)),
    'materialShelves', (select coalesce(jsonb_agg(r.data order by r.id), '[]'::jsonb) from public.stock_records r
      where r.shop_id = p_shop and r.collection = 'materialShelves' and (p_since is null or r.sync_xid >= p_since)));
end $f$;
revoke all on function private.stock_for(uuid, text, xid8) from public, anon;
grant execute on function private.stock_for(uuid, text, xid8) to authenticated;

-- Patches in place (patterns allow the CR LF the SQL editor sends).
do $patch$
declare d text; n text;
begin
  -- The Stock Count page (page access version 4).
  d := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  n := regexp_replace(d, '''Sale Adjustments'',\s*''Material Waste''\];', '''Sale Adjustments'',''Material Waste'',''Stock Count''];');
  if n = d then raise exception 'check_dynamic_business_settings pages pattern not found'; end if;
  d := n;
  n := regexp_replace(d, '\(''2''::jsonb,\s*''3''::jsonb\)', '(''2''::jsonb,''3''::jsonb,''4''::jsonb)');
  if n = d then raise exception 'check_dynamic_business_settings version pattern not found'; end if;
  execute n;

  -- The download, full and changed.
  d := pg_get_functiondef('public.get_ledger(uuid)'::regprocedure);
  n := regexp_replace(d, 'result\s*:=\s*result\s*\|\|\s*private\.team_for\(p_shop,\s*keep\);',
    'result := result || private.team_for(p_shop, keep) || private.stock_for(p_shop, keep);');
  if n = d then raise exception 'get_ledger pattern not found'; end if;
  execute n;
  d := pg_get_functiondef('public.get_ledger_changes(uuid,text,boolean)'::regprocedure);
  n := regexp_replace(d, 'private\.team_for\(p_shop,\s*keep,\s*p_since::xid8\)\)',
    'private.team_for(p_shop, keep, p_since::xid8) || private.stock_for(p_shop, keep, p_since::xid8))');
  if n = d then raise exception 'get_ledger_changes pattern not found'; end if;
  execute n;

  -- A service may choose when its materials leave stock.
  d := pg_get_functiondef('private.service_production(jsonb)'::regprocedure);
  n := regexp_replace(d, '''workflowId'',\s*''steps''\)\)', '''workflowId'', ''steps'', ''materialsAt''))');
  if n = d then raise exception 'service_production keys pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'or\s*\(p\s*\?\s*''steps''\s*and', 'or (p ? ''materialsAt'' and coalesce(p->>''materialsAt'', '''') not in ('''', ''checkout'', ''production''))
     or (p ? ''steps'' and');
  if n = d then raise exception 'service_production check pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'jsonb_build_object\(''steps'',\s*p->''steps''\)\s*else\s*''\{\}''::jsonb\s*end;',
    'jsonb_build_object(''steps'', p->''steps'') else ''{}''::jsonb end
    || case when p->>''materialsAt'' in (''checkout'', ''production'') then jsonb_build_object(''materialsAt'', p->>''materialsAt'') else ''{}''::jsonb end;');
  if n = d then raise exception 'service_production output pattern not found'; end if;
  execute n;

  -- The sale: in production, take nothing (reserve instead) and mark the job.
  d := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  n := regexp_replace(d, '''checkoutId'',e,''checkoutPosition''', '''checkoutId'',e,''materialsAt'',private.materials_at(p_shop,svc),''checkoutPosition''');
  if n = d then raise exception 'apply_checkout_event metadata pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'if svc\.material_id is not null then(\s*)insert into public\.ledger_events\(shop_id,id,actor_id,payload\) values\(p_shop,item_id,u,jsonb_build_object\(''id'',item_id,''kind'',''material\.job_used''',
    'if svc.material_id is not null and private.materials_at(p_shop,svc)=''production'' then perform private.check_reserve(p_shop,mat.id,needed,item_id);end if;
  if svc.material_id is not null and private.materials_at(p_shop,svc)=''checkout'' then\1insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,item_id,u,jsonb_build_object(''id'',item_id,''kind'',''material.job_used''');
  if n = d then raise exception 'apply_checkout_event stock pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'if line \? ''templateSnapshot'' then perform private\.deduct_template_stock\(',
    'if line ? ''templateSnapshot'' and private.materials_at(p_shop,svc)=''production'' then perform private.check_reserve(p_shop,(s.value->>''materialId'')::uuid,(s.value->>''quantity'')::numeric,item_id) from jsonb_array_elements(coalesce(line->''templateSnapshot''->''stock'',''[]''::jsonb)) s;end if;
  if line ? ''templateSnapshot'' and private.materials_at(p_shop,svc)=''checkout'' then perform private.deduct_template_stock(');
  if n = d then raise exception 'apply_checkout_event template pattern not found'; end if;
  execute n;
end $patch$;
