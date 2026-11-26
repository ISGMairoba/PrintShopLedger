-- Partners (plans/partners.md, decided 26 Nov): stock kept for regular clients. Off by default
-- (Business Settings → Features → Partners).
-- * A partner item is a service made for one partner customer (services.production.partnerOf), with
--   its fixed price (the service's flat price), its own steps (stages it skips are simply left out)
--   and materials taken in production. Its agreement and the finished stock on hand are kept in
--   stock_records ('partnerItems', id = the service's id).
-- * Prepare stock (partner.build_started): a job for the partner at no charge, made like any job;
--   when it is Completed, partner.stock_built adds what was made to the stock on hand.
-- * A sale (checkout as usual): the job carries partner {itemId, fromStock, toMake, made}. After the
--   sale, partner.stock_taken takes fromStock from the stock on hand; when the job is Completed,
--   partner.stock_built adds what was made beyond the order (made - toMake) to the stock.
-- * Counts and adjustments (partner.stock_adjusted, Admin and higher, with a reason); the agreement
--   and price (partner.item_saved, partner.ended: Manager and higher).
-- Each stock move is kept on the item (moves, the latest 300), like a material's history.

alter table public.stock_records drop constraint if exists stock_records_collection_check;
alter table public.stock_records add constraint stock_records_collection_check
  check (collection in ('stockCounts', 'materialShelves', 'partnerItems'));

-- The download: counts, shelves and partner items.
create or replace function private.stock_for(p_shop uuid, p_keep text, p_since xid8 default null) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  if not public.is_shop_member(p_shop) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'stockCounts', (select coalesce(jsonb_agg(r.data order by r.data->>'createdAt', r.id), '[]'::jsonb) from public.stock_records r
      where r.shop_id = p_shop and r.collection = 'stockCounts' and (p_since is null or r.sync_xid >= p_since)
        and (p_keep is null or coalesce(r.branch_id, 'main') = p_keep)),
    'materialShelves', (select coalesce(jsonb_agg(r.data order by r.id), '[]'::jsonb) from public.stock_records r
      where r.shop_id = p_shop and r.collection = 'materialShelves' and (p_since is null or r.sync_xid >= p_since)),
    'partnerItems', (select coalesce(jsonb_agg(r.data order by r.data->>'createdAt', r.id), '[]'::jsonb) from public.stock_records r
      where r.shop_id = p_shop and r.collection = 'partnerItems' and (p_since is null or r.sync_xid >= p_since)));
end $f$;
revoke all on function private.stock_for(uuid, text, xid8) from public, anon;
grant execute on function private.stock_for(uuid, text, xid8) to authenticated;

create or replace function public.apply_partner_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare
  d jsonb := p_event->'data'; k text := p_event->>'kind'; e uuid; me uuid := auth.uid(); lvl int; label text; payload jsonb; actor uuid;
  item public.stock_records; svc public.services; j public.jobs; qty numeric; on_hand numeric; move jsonb; rec jsonb; mat public.materials;
  flow jsonb; hours jsonb := '{}'; s jsonb; had boolean;
begin
  if jsonb_typeof(d) is distinct from 'object' or (p_event->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (d->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid partner change'; end if;
  e := (p_event->>'id')::uuid;
  if (d->>'modifiedBy')::uuid is distinct from me then raise exception 'Invalid audit identity'; end if;
  select n.lvl, n.label into lvl, label from private.notice_member(p_shop) n;
  if lvl is null then raise exception 'Business access denied'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where le.shop_id = p_shop and le.id = e;
  if found then if payload <> p_event or actor <> me then raise exception 'Operation ID already used'; end if; return; end if;
  select * into item from public.stock_records where shop_id = p_shop and collection = 'partnerItems' and id = (d->>'id')::uuid for update;
  had := found;
  if had and k <> 'partner.item_saved' and item.data->>'status' = 'ended' then raise exception 'This partner agreement has ended' using errcode = 'PT409'; end if;
  on_hand := coalesce((item.data->>'onHand')::numeric, 0);

  if k = 'partner.item_saved' then
    if lvl < 3 then raise exception 'Only a Manager or higher can set a partner agreement'; end if;
    if had and coalesce((d->>'baseVersion')::int, -1) <> (item.data->>'version')::int then
      raise exception 'This agreement changed on another device. Reopen it to see the latest.' using errcode = 'PT409'; end if;
    select * into svc from public.services where shop_id = p_shop and id = (d->>'id')::uuid;
    if not found or svc.archived then raise exception 'Choose an active service for the partner item'; end if;
    if svc.production->>'partnerOf' is distinct from d->>'customerId' then raise exception 'Mark the service as made for this partner first'; end if;
    if not exists (select 1 from public.customers where shop_id = p_shop and id = (d->>'customerId')::uuid) then raise exception 'Choose the partner'; end if;
    for qty in select x from unnest(array[(d->>'agreedStock')::numeric, (d->>'refillAt')::numeric, (d->>'batchSize')::numeric]) x loop
      if qty is null or qty < 0 or qty > 100000000 or qty <> trunc(qty) then raise exception 'Enter whole numbers for agreed stock, refill point and batch size'; end if;
    end loop;
    if (d->>'batchSize')::numeric < 1 then raise exception 'The best batch size is at least 1'; end if;
    if coalesce(d->>'endRule', '') not in ('partnerPays', 'writeOff', 'sellToOthers') or coalesce(d->>'collectRule', '') not in ('together', 'parts')
       or coalesce(d->>'refillPrompt', '') not in ('ask', 'auto', 'never') or coalesce(d->>'costTiming', 'used') not in ('used', 'sold') then
      raise exception 'Invalid agreement choices'; end if;
    if d ? 'reviewOn' and d->>'reviewOn' is not null and (d->>'reviewOn') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the price review date'; end if;
    if length(coalesce(d->>'notes', '')) > 1000 then raise exception 'Keep the notes to 1,000 characters'; end if;
    rec := jsonb_build_object('id', d->>'id', 'customerId', d->>'customerId', 'agreedStock', (d->>'agreedStock')::numeric,
      'refillAt', (d->>'refillAt')::numeric, 'batchSize', (d->>'batchSize')::numeric, 'endRule', d->>'endRule', 'collectRule', d->>'collectRule',
      'refillPrompt', d->>'refillPrompt', 'costTiming', coalesce(d->>'costTiming', 'used'), 'reviewOn', d->'reviewOn',
      'notes', btrim(coalesce(d->>'notes', '')), 'design', coalesce((d->>'design')::int, (item.data->>'design')::int, 1),
      'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now());
    if had then
      update public.stock_records set data = data || rec || jsonb_build_object('status', 'active', 'version', (data->>'version')::int + 1)
        where shop_id = p_shop and collection = 'partnerItems' and id = item.id;
    else
      insert into public.stock_records(shop_id, collection, id, data) values (p_shop, 'partnerItems', (d->>'id')::uuid,
        rec || jsonb_build_object('status', 'active', 'version', 1, 'onHand', 0, 'moves', '[]'::jsonb, 'createdBy', me, 'createdByLabel', label, 'createdAt', now()));
    end if;
    insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event);
    return;
  end if;
  if not had then raise exception 'Partner item not found' using errcode = 'PT409'; end if;

  if k = 'partner.ended' then
    if lvl < 3 then raise exception 'Only a Manager or higher can end a partner agreement'; end if;
    if coalesce(d->>'endRule', '') not in ('partnerPays', 'writeOff', 'sellToOthers') then raise exception 'Choose what happens to the stock left'; end if;
    move := jsonb_build_object('kind', 'ended', 'endRule', d->>'endRule', 'onHand', on_hand);
    update public.stock_records set data = data || jsonb_build_object('status', 'ended', 'endRule', d->>'endRule', 'endedAt', now(),
        'endedByLabel', label, 'version', (data->>'version')::int + 1)
      where shop_id = p_shop and collection = 'partnerItems' and id = item.id;

  elsif k = 'partner.stock_adjusted' then
    if lvl < 2 then raise exception 'Only an Admin or higher can count or adjust partner stock'; end if;
    qty := (d->>'quantity')::numeric;
    if jsonb_typeof(d->'quantity') is distinct from 'number' or qty < 0 or qty > 100000000 or qty <> trunc(qty) then raise exception 'Enter the stock on hand as a whole number'; end if;
    if length(btrim(coalesce(d->>'reason', ''))) not between 1 and 200 then raise exception 'Enter a reason'; end if;
    move := jsonb_build_object('kind', 'set', 'quantity', qty - on_hand, 'reason', btrim(d->>'reason'));
    on_hand := qty;

  elsif k = 'partner.design_changed' then
    if lvl < 3 then raise exception 'Only a Manager or higher can change the design'; end if;
    -- Stock of the old design is used first: it is kept as is; new builds are the new design.
    move := jsonb_build_object('kind', 'design', 'design', coalesce((item.data->>'design')::int, 1) + 1, 'reason', btrim(coalesce(d->>'reason', '')));
    update public.stock_records set data = data || jsonb_build_object('design', coalesce((data->>'design')::int, 1) + 1,
        'oldDesignStock', on_hand, 'version', (data->>'version')::int + 1)
      where shop_id = p_shop and collection = 'partnerItems' and id = item.id;

  elsif k = 'partner.build_started' then
    if lvl < 2 then raise exception 'Only an Admin or higher can prepare partner stock'; end if;
    qty := (d->>'quantity')::numeric;
    if jsonb_typeof(d->'quantity') is distinct from 'number' or qty < 1 or qty > 100000000 or qty <> trunc(qty) then raise exception 'Enter how many to prepare'; end if;
    select * into svc from public.services where shop_id = p_shop and id = item.id;
    if not found or svc.archived then raise exception 'The partner item''s service is no longer active'; end if;
    if (d->>'jobId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or exists (select 1 from public.jobs where shop_id = p_shop and id = (d->>'jobId')::uuid) then
      raise exception 'Invalid job ID'; end if;
    -- Its own steps: Added, the steps, Completed, Collected.
    flow := '["Added"]'::jsonb || coalesce((select jsonb_agg(x->'name') from jsonb_array_elements(coalesce(svc.production->'steps', '[]'::jsonb)) x), '[]'::jsonb) || '["Completed","Collected"]'::jsonb;
    for s in select x from jsonb_array_elements(coalesce(svc.production->'steps', '[]'::jsonb)) x loop
      if s ? 'minutes' then hours := hours || jsonb_build_object(s->>'name', round((s->>'minutes')::numeric / 60, 4)); end if;
    end loop;
    select * into mat from public.materials where shop_id = p_shop and id = svc.material_id;
    insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, metadata, modified_by, modified_by_label, modified_at, last_event_id)
    values (p_shop, (d->>'jobId')::uuid, (item.data->>'customerId')::uuid, svc.description, 'Partner stock: ' || svc.description || ' × ' || qty, 0, now(),
      jsonb_build_object('customerId', item.data->>'customerId', 'service', svc.description, 'serviceId', svc.id, 'quantity', qty,
        'description', 'Partner stock: ' || svc.description || ' × ' || qty, 'materialId', svc.material_id,
        'materialNeeded', case when mat.id is null or mat.require_size then 0 else round(qty * coalesce((svc.production->>'perItem')::numeric, 1), 3) end,
        'requireSize', coalesce(mat.require_size, false), 'measurementUnit', coalesce(mat.measurement_unit, 'item'),
        'checkMaterials', mat.id is not null, 'materialsAt', 'production', 'workflow', flow, 'productionStatus', 'Added', 'version', 1,
        'createdBy', me, 'createdByLabel', label, 'partnerBuild', jsonb_build_object('itemId', item.id, 'quantity', qty, 'design', coalesce((item.data->>'design')::int, 1)))
      || case when hours <> '{}'::jsonb then jsonb_build_object('stageHours', hours) else '{}'::jsonb end,
      me, label, now(), e);
    move := jsonb_build_object('kind', 'build', 'jobId', d->>'jobId', 'quantity', 0, 'planned', qty);

  elsif k in ('partner.stock_taken', 'partner.stock_built') then
    select * into j from public.jobs where shop_id = p_shop and id = (d->>'jobId')::uuid for update;
    if not found then raise exception 'Job not found' using errcode = 'PT409'; end if;
    if k = 'partner.stock_taken' then
      if j.metadata->'partner'->>'itemId' is distinct from item.id::text then raise exception 'This job is not for this partner item'; end if;
      if (j.metadata->>'partnerTaken')::boolean then raise exception 'Already taken from stock' using errcode = 'PT409'; end if;
      if j.production_status = 'Cancelled' then raise exception 'This job is cancelled' using errcode = 'PT409'; end if;
      qty := coalesce((j.metadata->'partner'->>'fromStock')::numeric, 0);
      if qty <= 0 then raise exception 'Nothing to take from stock'; end if;
      if qty > on_hand then raise exception 'Only % in stock for this partner now (the job counted %). Review the job.', trim_scale(on_hand), trim_scale(qty) using errcode = 'PT409'; end if;
      on_hand := on_hand - qty;
      move := jsonb_build_object('kind', 'sold', 'jobId', j.id, 'quantity', -qty);
      update public.jobs set metadata = metadata || '{"partnerTaken": true}', version = version + 1, modified_by = me, modified_by_label = label,
        modified_at = now(), last_event_id = e where shop_id = p_shop and id = j.id;
    else
      if j.production_status not in ('Completed', 'Collected') then raise exception 'Add it to stock once the job is completed' using errcode = 'PT409'; end if;
      if (j.metadata->>'partnerCredited')::boolean then raise exception 'Already added to stock' using errcode = 'PT409'; end if;
      if j.metadata->'partnerBuild'->>'itemId' = item.id::text then qty := (j.metadata->'partnerBuild'->>'quantity')::numeric;
      elsif j.metadata->'partner'->>'itemId' = item.id::text then
        qty := greatest(0, coalesce((j.metadata->'partner'->>'made')::numeric, 0) - coalesce((j.metadata->'partner'->>'toMake')::numeric, 0));
      else raise exception 'This job is not for this partner item'; end if;
      if qty <= 0 then raise exception 'Nothing left over to add to stock'; end if;
      on_hand := on_hand + qty;
      move := jsonb_build_object('kind', case when j.metadata ? 'partnerBuild' then 'built' else 'leftover' end, 'jobId', j.id, 'quantity', qty);
      update public.jobs set metadata = metadata || '{"partnerCredited": true}', version = version + 1, modified_by = me, modified_by_label = label,
        modified_at = now(), last_event_id = e where shop_id = p_shop and id = j.id;
    end if;
  else
    raise exception 'Unknown partner change';
  end if;

  if move is not null and k not in ('partner.ended', 'partner.design_changed') then
    update public.stock_records set data = data || jsonb_build_object('onHand', on_hand, 'version', (data->>'version')::int + 1)
      where shop_id = p_shop and collection = 'partnerItems' and id = item.id;
  end if;
  update public.stock_records set data = jsonb_set(data, '{moves}', (
      select coalesce(jsonb_agg(m order by n), '[]'::jsonb) from (
        select m, n from jsonb_array_elements(coalesce(data->'moves', '[]'::jsonb)) with ordinality t(m, n) order by n desc limit 299) x)
      || jsonb_build_array(move || jsonb_build_object('at', now(), 'byLabel', label, 'onHand', on_hand)))
    where shop_id = p_shop and collection = 'partnerItems' and id = item.id;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, me, p_event)
    on conflict do nothing;
end $f$;
revoke all on function public.apply_partner_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_partner_event(uuid, jsonb) to authenticated;

do $patch$
declare d text; n text;
begin
  -- A service may be made for one partner (production.partnerOf: the customer's id).
  d := pg_get_functiondef('private.service_production(jsonb)'::regprocedure);
  n := regexp_replace(d, '''steps'',\s*''materialsAt''\)\)', '''steps'', ''materialsAt'', ''partnerOf''))');
  if n = d then raise exception 'service_production keys pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'or\s*\(p\s*\?\s*''materialsAt''\s*and', 'or (p ? ''partnerOf'' and coalesce(p->>''partnerOf'', '''') !~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'')
     or (p ? ''materialsAt'' and');
  if n = d then raise exception 'service_production check pattern not found'; end if;
  d := n;
  n := regexp_replace(d, 'then jsonb_build_object\(''materialsAt'',\s*p->>''materialsAt''\)\s*else\s*''\{\}''::jsonb\s*end;',
    'then jsonb_build_object(''materialsAt'', p->>''materialsAt'') else ''{}''::jsonb end
    || case when p ? ''partnerOf'' then jsonb_build_object(''partnerOf'', p->>''partnerOf'') else ''{}''::jsonb end;');
  if n = d then raise exception 'service_production output pattern not found'; end if;
  execute n;

  -- The Partners page (page access version 5).
  d := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  n := regexp_replace(d, '''Material Waste'',\s*''Stock Count''\];', '''Material Waste'',''Stock Count'',''Partners''];');
  if n = d then raise exception 'check_dynamic_business_settings pages pattern not found'; end if;
  d := n;
  n := regexp_replace(d, '''3''::jsonb,\s*''4''::jsonb\)', '''3''::jsonb,''4''::jsonb,''5''::jsonb)');
  if n = d then raise exception 'check_dynamic_business_settings version pattern not found'; end if;
  execute n;
end $patch$;
