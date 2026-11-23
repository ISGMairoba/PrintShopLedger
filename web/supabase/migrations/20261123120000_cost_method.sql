-- Cost method (plans/actual-cost-v2.md, owner 23 Nov): every business starts on **Estimated**, where
-- each material has one cost price per unit and profit is worked out from it, with no cost entry
-- (supplier prices, linked bills) asked for. Businesses that switch to **Actual** use the server's
-- stock valuation (part A, and the rules added later).
--   1. materials.cost_price (kobo per unit, optional), saved with the material.
--   2. A sale stamps the material's cost price as its cost rate (before any linked service cost).
--   3. The download sends it (costPrice) with each material.
--   4. Business settings accept costMethod ('estimated', the default and left out, or 'actual').

alter table public.materials add column if not exists cost_price numeric;

-- 1.
CREATE OR REPLACE FUNCTION public.apply_material_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_data jsonb := p_event -> 'data';
  v_kind text := p_event ->> 'kind';
  v_event uuid := (p_event ->> 'id')::uuid;
  v_id uuid := (v_data ->> 'id')::uuid;
  v_user uuid := auth.uid();
  v_label text;
  v_existing jsonb;
  v_actor uuid;
  v_material public.materials%rowtype;
  v_available numeric;
  v_minimum numeric;
  v_to public.materials%rowtype;
  v_to_event uuid;
  v_qty numeric;
  v_yield numeric;
  v_change numeric;
  v_join boolean;
  v_pieces jsonb;
  v_piece jsonb;
  v_seen uuid[];
begin
 perform private.assert_sync_dependencies(p_shop,p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived
                 and access_level >= 2 and role in ('admin', 'manager', 'general_manager', 'developer')) then
    raise exception 'Only Admins and above change materials and stock.' using errcode = '42501';
  end if;
  if v_event is null or v_id is null then raise exception 'Missing material identifier'; end if;
  if (v_data ->> 'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select payload, actor_id into v_existing, v_actor from public.ledger_events where shop_id = p_shop and id = v_event;
  if found then
    if v_existing <> p_event or v_actor <> v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data ->> 'full_name'), ''), email, id::text)
    into v_label from auth.users where id = v_user;
  select * into v_material from public.materials where id = v_id and shop_id = p_shop for update;v_material:=private.at_location(p_shop,v_material);
  if v_kind = 'material.created' then
    if found then raise exception 'Material ID already exists'; end if;
  else
    if not found then raise exception 'Material not found'; end if;
    if (v_data ->> 'baseVersion')::integer is distinct from v_material.version then
      raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = 'PT409';
    end if;
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values(p_shop, v_event, v_user, p_event);
  if v_kind in ('material.created', 'material.updated') then
    if v_data ? 'minimumStock' then
      if jsonb_typeof(v_data -> 'minimumStock') is distinct from 'number' then raise exception 'Minimum stock must be a number'; end if;
      v_minimum := (v_data ->> 'minimumStock')::numeric;
    else v_minimum := coalesce(v_material.minimum_stock,0); end if;
    if v_minimum < 0 or v_minimum > 1000000000000 or v_minimum <> round(v_minimum,3) then raise exception 'Minimum stock must be zero or greater with at most three decimal places'; end if;
    if jsonb_typeof(v_data -> 'available') is distinct from 'number' then raise exception 'Available must be a number'; end if;
    v_available := (v_data ->> 'available')::numeric;
    if v_available < -1000000000000 or v_available > 1000000000000 or v_available <> round(v_available, 3) then
      raise exception 'Available must be within range with at most three decimal places';
    end if;
    if jsonb_typeof(v_data -> 'requireSize') is distinct from 'boolean' then raise exception 'Require Size must be boolean'; end if;
    if v_data ? 'canSplit' and jsonb_typeof(v_data -> 'canSplit') is distinct from 'boolean' then raise exception 'Can be split must be yes or no'; end if;
    -- Cost price per unit (kobo, Estimated cost method): a number, or null to clear; left as it was when not sent.
    if v_data ? 'costPrice' and v_data -> 'costPrice' <> 'null'::jsonb and (jsonb_typeof(v_data -> 'costPrice') is distinct from 'number'
       or (v_data ->> 'costPrice')::numeric < 0 or (v_data ->> 'costPrice')::numeric > 100000000000
       or (v_data ->> 'costPrice')::numeric <> round((v_data ->> 'costPrice')::numeric, 2)) then
      raise exception 'Cost price must be zero or more, in kobo with at most two decimal places';
    end if;
    if v_kind = 'material.created' then
      insert into public.materials(id, shop_id, name, available, measurement_unit, require_size, minimum_stock, can_split, created_by,
        created_by_label, modified_by, modified_by_label, last_event_id, cost_price)
      values(v_id, p_shop, btrim(v_data ->> 'name'), v_available, btrim(v_data ->> 'measurementUnit'),
        (v_data ->> 'requireSize')::boolean, v_minimum, coalesce((v_data ->> 'canSplit')::boolean, false), v_user, v_label, v_user, v_label, v_event,
        (v_data ->> 'costPrice')::numeric);
    else
      if v_material.archived then raise exception 'Restore this material before editing it'; end if;
      update public.materials set name = btrim(v_data ->> 'name'),
        measurement_unit = btrim(v_data ->> 'measurementUnit'), require_size = (v_data ->> 'requireSize')::boolean, minimum_stock = v_minimum, can_split = coalesce((v_data ->> 'canSplit')::boolean, can_split),
        cost_price = case when v_data ? 'costPrice' then (v_data ->> 'costPrice')::numeric else cost_price end,
        modified_by = v_user, modified_by_label = v_label, modified_at = now(),
        version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
    end if;
  elsif v_kind in ('material.stock_added', 'material.stock_set') then
    if v_material.archived then raise exception 'Restore this material before changing stock'; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' then raise exception 'Stock quantity must be a number'; end if;
    v_available := (v_data ->> 'quantity')::numeric;
    if v_available < -1000000000000 or v_available > 1000000000000 or v_available <> round(v_available,3) then raise exception 'Stock quantity must be within range with at most three decimal places'; end if;
    if length(coalesce(v_data ->> 'reason','')) > 500 then raise exception 'Stock note is too long'; end if;
    if v_kind = 'material.stock_added' then
      if v_available <= 0 then raise exception 'Quantity to add must be greater than zero'; end if;
      v_available := v_material.available + v_available;
    end if;
    if abs(v_available) > 1000000000000 then raise exception 'Available quantity is too large'; end if;
    update public.materials set available = v_available, modified_by = v_user, modified_by_label = v_label,
      modified_at = now(), version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
  elsif v_kind in ('material.archived', 'material.restored') then
    if v_material.archived = (v_kind = 'material.archived') then raise exception 'Material is already in that state'; end if;
    update public.materials set archived = (v_kind = 'material.archived'), modified_by = v_user,
      modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  elsif v_kind = 'material.split' then
    if v_material.archived then raise exception 'Restore both materials before splitting stock'; end if;
    if not v_material.can_split then raise exception 'Turn on "Can be split" for % first', v_material.name; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' then raise exception 'Enter how many to split'; end if;
    v_qty := (v_data ->> 'quantity')::numeric;
    if v_qty <= 0 or v_qty > 1000000000 or v_qty <> round(v_qty, 3) then
      raise exception 'Enter quantities greater than zero, with at most three decimal places';
    end if;
    if v_data ? 'join' and jsonb_typeof(v_data -> 'join') is distinct from 'boolean' then raise exception 'Invalid split'; end if;
    v_join := coalesce((v_data ->> 'join')::boolean, false);
    if length(coalesce(v_data ->> 'reason', '')) > 500 then raise exception 'Stock note is too long'; end if;
    if v_data ? 'pieces' then
      v_pieces := v_data -> 'pieces';
      if jsonb_typeof(v_pieces) is distinct from 'array' or jsonb_array_length(v_pieces) < 1 or jsonb_array_length(v_pieces) > 20 then
        raise exception 'Add between 1 and 20 pieces';
      end if;
    else
      v_pieces := jsonb_build_array(jsonb_build_object('toId', v_data -> 'toId', 'toBaseVersion', v_data -> 'toBaseVersion',
        'toEventId', v_data -> 'toEventId', 'yield', v_data -> 'yield'));
    end if;
    if abs(v_material.available + case when v_join then v_qty else -v_qty end) > 1000000000000 then
      raise exception 'Available quantity is too large';
    end if;
    v_seen := array[v_id];
    for v_piece in select value from jsonb_array_elements(v_pieces) loop
      if jsonb_typeof(v_piece -> 'yield') is distinct from 'number' then raise exception 'Enter how many one item makes'; end if;
      v_yield := (v_piece ->> 'yield')::numeric;
      if v_yield <= 0 or v_yield > 1000000000 or v_yield <> round(v_yield, 3) then
        raise exception 'Enter quantities greater than zero, with at most three decimal places';
      end if;
      if coalesce(v_piece ->> 'toId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(v_piece ->> 'toEventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Choose the other material';
      end if;
      if (v_piece ->> 'toId')::uuid = any (v_seen) then raise exception 'Choose each smaller material once, and not the one being split'; end if;
      v_seen := v_seen || (v_piece ->> 'toId')::uuid;
      select * into v_to from public.materials where id = (v_piece ->> 'toId')::uuid and shop_id = p_shop for update;
      if not found then raise exception 'Material not found'; end if;
      v_to := private.at_location(p_shop, v_to);
      if v_to.archived then raise exception 'Restore both materials before splitting stock'; end if;
      if (v_piece ->> 'toBaseVersion')::integer is distinct from v_to.version then
        raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = 'PT409';
      end if;
      v_to_event := (v_piece ->> 'toEventId')::uuid;
      if v_to_event = v_event or exists (select 1 from public.ledger_events where shop_id = p_shop and id = v_to_event) then
        raise exception 'Operation ID already used';
      end if;
      v_change := round(v_qty * v_yield, 3);
      if abs(v_to.available + case when v_join then -v_change else v_change end) > 1000000000000 then
        raise exception 'Available quantity is too large';
      end if;
      insert into public.ledger_events(shop_id, id, actor_id, payload)
      values (p_shop, v_to_event, v_user, jsonb_build_object('id', v_to_event, 'kind', 'material.split',
        'data', (v_data - 'pieces') || v_piece || jsonb_build_object('id', v_to.id, 'fromId', v_id, 'splitEventId', v_event)));
      update public.materials set available = v_to.available + case when v_join then -v_change else v_change end,
        modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_to_event
        where id = v_to.id and shop_id = p_shop;
    end loop;
    update public.materials set available = v_material.available + case when v_join then v_qty else -v_qty end,
      modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  else raise exception 'Unknown material operation'; end if;

end;
$function$;

-- 2.
CREATE OR REPLACE FUNCTION private.cost_rates_for(p_shop uuid, p_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
    -- The material's own cost price first (Materials), else the first cost linked to it.
    select cost_price into r from public.materials where shop_id = p_shop and id = m::uuid;
    if r is null then
    select (s.costing->>'amount')::numeric / coalesce(nullif((s.costing->>'per')::numeric, 0), 1) into r
    from public.services s
    where s.shop_id = p_shop and s.material_id = m::uuid and not s.archived and s.costing->>'amount' is not null
    order by s.created_at, s.id limit 1;
    end if;
    rates := rates || jsonb_build_object(m, r);
  end loop;
  return jsonb_build_object(
    'service', case when cost->>'amount' is not null
      then (cost->>'amount')::numeric / coalesce(nullif((cost->>'per')::numeric, 0), 1) end,
    'materials', rates,
    'at', now());
end $function$;

-- 3.
CREATE OR REPLACE FUNCTION public.get_ledger(p_shop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  prev text := coalesce(current_setting('psl.ledger', true), '');
  result jsonb;
  v record;
  own boolean := false;
  br boolean;
  keep text;
begin
  if current_setting('psl.skip_ledger', true) = 'on' then return null; end if;
  perform set_config('psl.ledger', 'on', true);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;

  select * into v from private.branch_view(p_shop);
  br := coalesce(v.has_branches, false);
  keep := case when br then v.keep_branch end;
  -- A branch that keeps its own customers sees only those it serves.
  if br and keep is not null and keep <> 'main' then
    select exists (select 1 from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
                   where b.shop_id = p_shop and x->>'id' = keep and x->>'customers' = 'own') into own;
  end if;

  result := jsonb_build_object(
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'materialId',material_id,'price',price,
        'shelfItem',shelf_item,'private',private,'costing',costing,'packPrices',pack_prices,'priceTiers',price_tiers,'customPrice',custom_price,
        'materialOptions',to_jsonb(material_options),'confirmStage',confirm_stage,'production',production,'variantGroup',variant_group,
        'variantName',variant_name,'archived',archived,'version',version,'createdBy',created_by,'createdByLabel',created_by_label,
        'createdAt',created_at,'modifiedBy',modified_by,'modifiedByLabel',modified_by_label,'modifiedAt',modified_at,'lastEventId',last_event_id,
        'icon',coalesce(icon,''),'category',coalesce(category,''),'code',coalesce(code,''),'tags',coalesce(tags,'[]'::jsonb),
        'soldAt',coalesce(sold_at,'[]'::jsonb),'minQuantity',coalesce(min_quantity,0))
      order by description,id), '[]'::jsonb) from public.services where shop_id=p_shop),
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'available', available, 'minimumStock', minimum_stock,
        'measurementUnit', measurement_unit, 'requireSize', require_size, 'canSplit', can_split, 'archived', archived, 'version', version,
        'createdBy', created_by, 'createdByLabel', created_by_label, 'createdAt', created_at, 'modifiedBy', modified_by,
        'modifiedByLabel', modified_by_label, 'modifiedAt', modified_at, 'lastEventId', last_event_id)
        || case when cost_price is not null then jsonb_build_object('costPrice', cost_price) else '{}'::jsonb end
      order by created_at, id), '[]'::jsonb)
      from public.materials where shop_id = p_shop),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
        'creditLimit', c.credit_limit, 'archived', c.archived, 'version', c.version, 'createdAt', c.created_at, 'createdBy', c.created_by,
        'createdByLabel', c.created_by_label, 'modifiedBy', c.modified_by, 'modifiedByLabel', c.modified_by_label, 'modifiedAt', c.modified_at,
        'lastEventId', c.last_event_id, 'calledAs', coalesce(c.called_as, ''), 'branchId', coalesce(c.branch_id, 'main'),
        'creditLimits', coalesce(c.credit_limits, '{}'::jsonb), 'linkedBranches', to_jsonb(coalesce(c.linked_branches, '{}'::text[])))
      order by c.created_at, c.id), '[]'::jsonb)
      from public.customers c where c.shop_id = p_shop
        and (not own or coalesce(c.branch_id, 'main') = keep or keep = any(c.linked_branches)
          or exists (select 1 from public.jobs j where j.shop_id = p_shop and j.customer_id = c.id and j.branch_id = keep)
          or exists (select 1 from public.checkout_records k where k.shop_id = p_shop and k.customer_id = c.id and k.branch_id = keep)
          or exists (select 1 from public.payments p where p.shop_id = p_shop and p.customer_id = c.id and p.branch_id = keep)
          or exists (select 1 from public.quotations q where q.shop_id = p_shop and q.data->>'customerId' = c.id::text and q.branch_id = keep))),
    'jobs', (select coalesce(jsonb_agg(j.metadata||jsonb_build_object('id',j.id,'customerId',j.customer_id,'service',j.service,
        'description',j.description,'amount',j.amount,'createdAt',j.created_at,'productionStatus',j.production_status,'version',j.version,
        'modifiedBy',j.modified_by,'modifiedByLabel',j.modified_by_label,'modifiedAt',j.modified_at,'lastEventId',j.last_event_id)
        || case when br and j.branch_id is not null then jsonb_build_object('branchId', j.branch_id) else '{}'::jsonb end
      order by j.created_at,j.id),'[]'::jsonb)
      from public.jobs j where j.shop_id=p_shop and (keep is null or coalesce(j.branch_id,'main') = keep)),
    'payments', (select coalesce(jsonb_agg(x.v order by x.v->>'createdAt', x.v->>'id'), '[]'::jsonb) from (
      select jsonb_build_object('id',p.id,'customerId',p.customer_id,'amount',p.amount,'method',p.method,'paidOn',p.paid_on,
          'reference',p.reference,'createdAt',p.created_at,'walletUsed',p.wallet_used,'walletAdded',p.wallet_added,'checkoutId',p.checkout_id,
          'allocations',coalesce((select jsonb_agg(jsonb_build_object('jobId',a.job_id,'amount',a.amount) order by a.job_id)
            from public.payment_allocations a where a.shop_id=p_shop and a.payment_id=p.id),'[]'::jsonb))
        || case when cr.data ? 'methodLabel' then jsonb_build_object('methodLabel', cr.data->'methodLabel') else '{}'::jsonb end
        || case when sa.id is not null then jsonb_build_object('refundId', sa.id, 'methodLabel', sa.data->>'methodLabel') else '{}'::jsonb end
        || case when p.method_label is not null then jsonb_build_object('methodLabel', p.method_label) else '{}'::jsonb end
        || case when br and p.branch_id is not null then jsonb_build_object('branchId', p.branch_id) else '{}'::jsonb end v
      from public.payments p
      left join public.checkout_records cr on cr.shop_id=p_shop and cr.id=p.id
      left join public.sale_adjustments sa on sa.shop_id=p_shop and sa.id=p.id and sa.data->>'action'='sale.refunded'
      where p.shop_id=p_shop and (keep is null or coalesce(p.branch_id,'main') = keep)) x),
    'checkouts', (select coalesce(jsonb_agg(data||jsonb_build_object('drawerClosingId',drawer_closing_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.checkout_records where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'drawerClosings', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by closed_at,id),'[]'::jsonb)
      from public.drawer_closings where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'materialHistory', (select coalesce(jsonb_agg(x.v order by x.v->>'changedAt', x.v->>'id'), '[]'::jsonb) from (
      select jsonb_build_object('id',id,'materialId',material_id,'materialName',material_name,'measurementUnit',measurement_unit,
          'action',action,'beforeAvailable',before_available,'afterAvailable',after_available,'reason',reason,'changedBy',actor_id,
          'changedByLabel',actor_label,'changedAt',created_at,'before',before_values,'after',after_values,'detailsComplete',details_complete,
          'jobId',job_id,'checkoutId',checkout_id,'expenseId',expense_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end v
      from public.material_stock_changes where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)) x),
    'expenses', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by data->>'incurredOn',id),'[]'::jsonb)
      from public.expenses where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'expenseHistory', (select coalesce(jsonb_agg(data order by data->>'changedAt',id),'[]'::jsonb) from public.expense_changes where shop_id=p_shop),
    'saleAdjustments', (select coalesce(jsonb_agg(data||jsonb_build_object('drawerClosingId',drawer_closing_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.sale_adjustments where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'materialWaste', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.material_waste where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'quotations', (select coalesce(jsonb_agg(q.data
        || case when br and q.branch_id is not null then jsonb_build_object('branchId', q.branch_id) else '{}'::jsonb end
      order by q.data->>'createdAt', q.id), '[]'::jsonb)
      from public.quotations q where q.shop_id=p_shop and (keep is null or coalesce(q.branch_id,'main') = keep)),
    'reminders', (select coalesce(jsonb_agg(r.data
        || case when br and r.branch_id is not null then jsonb_build_object('branchId', r.branch_id) else '{}'::jsonb end
      order by r.data->>'remindedAt', r.id), '[]'::jsonb)
      from public.customer_reminders r where r.shop_id=p_shop and (keep is null or coalesce(r.branch_id,'main') = keep))
  );

  -- Money records: one read, split by collection.
  result := result || (select jsonb_object_agg(k.key, coalesce(o.items, '[]'::jsonb))
    from unnest(array['payees','moneyAccounts','accountEntries','operationHistory','repeatingExpenses']) k(key)
    left join (select collection, jsonb_agg(data order by data->>'createdAt', id) items
               from public.business_operations_records where shop_id=p_shop group by collection) o on o.collection = k.key);

  if br then
    if keep is not null then result := private.branch_accounts(p_shop, result, keep); end if;
    result := jsonb_set(result, '{services}', private.branch_price_services(p_shop, result->'services'));
    result := jsonb_set(result, '{materials}', private.location_materials(p_shop, result->'materials'));
    result := result || jsonb_build_object('locationStock', private.visible_location_stock(p_shop, keep is null),
      'stockRequests', private.visible_stock_requests(p_shop, keep is null));
  end if;

  perform set_config('psl.ledger', prev, true);
  return result;
end $function$;

-- 4.
CREATE OR REPLACE FUNCTION private.check_dynamic_business_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;
 known text[]:=array['Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
  'Payment Reminders','Payments','Expenses','Payees','Accounts','Materials','Services','Edit Products','Stock History','Print Settings','Users',
  'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
 tabs text[]:=array['Profile & logo','Appearance','Receipts','Payment methods','Dropdowns & workflow','Jobs & payments','Default time frames','Words','Messages','Pricing templates','Corrections','Security','Branches'];
begin
 if config ? 'security' and (jsonb_typeof(config->'security') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(config->'security') key where key not in ('autoLockMinutes','syncMinutes','historyKeep','lockOnOpen','limitsBlockActions','minPinLength','pinTries','requirePin','rememberPeople','rememberDays','rememberMax','allowBiometric'))
   or jsonb_typeof(config->'security'->'autoLockMinutes') is distinct from 'number'
   or (config->'security'->>'autoLockMinutes')::numeric<>trunc((config->'security'->>'autoLockMinutes')::numeric)
   or (config->'security'->>'autoLockMinutes')::numeric not between 0 and 240) then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;
 if config->'security' ? 'limitsBlockActions' and jsonb_typeof(config->'security'->'limitsBlockActions') is distinct from 'boolean' then raise exception 'Choose whether page limits also block their actions';end if;
 -- Cost method (plans/actual-cost-v2.md): Estimated (the default, left out) or Actual.
 if config ? 'costMethod' and coalesce(config->>'costMethod', '') not in ('estimated', 'actual') then raise exception 'Choose the cost method: Estimated or Actual';end if;
 -- Lock screen choices (plans/lock-screen.md); left out when at their defaults.
 if config->'security' ? 'minPinLength' and (jsonb_typeof(config->'security'->'minPinLength') is distinct from 'number' or (config->'security'->>'minPinLength') not in ('4','5','6')) then raise exception 'Choose a minimum PIN length of 4, 5 or 6 digits';end if;
 if config->'security' ? 'pinTries' and (jsonb_typeof(config->'security'->'pinTries') is distinct from 'number' or (config->'security'->>'pinTries') not in ('3','5','10')) then raise exception 'Choose 3, 5 or 10 PIN tries';end if;
 if config->'security' ? 'requirePin' and jsonb_typeof(config->'security'->'requirePin') is distinct from 'boolean' then raise exception 'Choose whether staff must have a PIN';end if;
 if config->'security' ? 'rememberPeople' and jsonb_typeof(config->'security'->'rememberPeople') is distinct from 'boolean' then raise exception 'Choose whether devices remember the people who sign in';end if;
 if config->'security' ? 'rememberDays' and (jsonb_typeof(config->'security'->'rememberDays') is distinct from 'number' or (config->'security'->>'rememberDays') !~ '^[0-9]+$' or (config->'security'->>'rememberDays')::int not between 1 and 90) then raise exception 'Choose how long a device remembers someone: 1 to 90 days';end if;
 if config->'security' ? 'rememberMax' and (jsonb_typeof(config->'security'->'rememberMax') is distinct from 'number' or (config->'security'->>'rememberMax') !~ '^[0-9]+$' or (config->'security'->>'rememberMax')::int not between 2 and 20) then raise exception 'Choose how many people a device remembers: 2 to 20';end if;
 if config->'security' ? 'allowBiometric' and jsonb_typeof(config->'security'->'allowBiometric') is distinct from 'boolean' then raise exception 'Choose whether face/fingerprint unlock is allowed';end if;
 if config->'security' ? 'lockOnOpen' and jsonb_typeof(config->'security'->'lockOnOpen') is distinct from 'boolean' then raise exception 'Choose whether the app locks when opened';end if;
 if config->'security' ? 'syncMinutes' and (jsonb_typeof(config->'security'->'syncMinutes') is distinct from 'number'
   or (config->'security'->>'syncMinutes')::numeric<>trunc((config->'security'->>'syncMinutes')::numeric)
   or (config->'security'->>'syncMinutes')::numeric not between 1 and 60) then raise exception 'Choose a sync check time from 1 to 60 minutes';end if;
 if config->'security' ? 'historyKeep' and coalesce(config->'security'->>'historyKeep','') not in ('7d','14d','30d','3m','6m','12m')
   then raise exception 'Choose how much history devices keep';end if;
 if config ? 'corrections' and (jsonb_typeof(config->'corrections') is distinct from 'object' or jsonb_typeof(config->'corrections'->'recentDays') is distinct from 'number' or (config->'corrections'->>'recentDays')::numeric<>trunc((config->'corrections'->>'recentDays')::numeric) or (config->'corrections'->>'recentDays')::numeric not between 1 and 365) then raise exception 'Choose a correction history window from 1 to 365 days';end if;
 if config ? 'pageAccess' then
  if jsonb_typeof(config->'pageAccess') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3','4')) then raise exception 'Invalid page access settings';end if;
  foreach rank_key in array array['1','2','3','4'] loop
   allowed=config->'pageAccess'->rank_key;if rank_key in ('3','4') and allowed is null then continue;end if;
   if jsonb_typeof(allowed) is distinct from 'array' or not allowed ? 'My Account' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed)) then raise exception 'Invalid page access settings';end if;
   for page in select value from jsonb_array_elements(allowed) loop
    if jsonb_typeof(page) is distinct from 'string' or not (page#>>'{}')=any(known) or rank_key='1' and page#>>'{}' in ('Dashboard','Reports','Edit Products','Users','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste') then raise exception 'Restricted page access';end if;
   end loop;
  end loop;
 end if;
 if config ? 'pageAccessVersion' and config->'pageAccessVersion' not in ('2'::jsonb,'3'::jsonb) then raise exception 'Invalid page access settings';end if;
 if config ? 'settingsTabs' then
  if jsonb_typeof(config->'settingsTabs') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'settingsTabs') key where key not in ('2','3','4')) then raise exception 'Invalid Business Settings tab access';end if;
  for rank_key in select key from jsonb_object_keys(config->'settingsTabs') key loop
   allowed=config->'settingsTabs'->rank_key;
   if jsonb_typeof(allowed) is distinct from 'array' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed))
    or exists(select 1 from jsonb_array_elements(allowed) t where jsonb_typeof(t.value) is distinct from 'string' or not (t.value#>>'{}')=any(tabs)) then
    raise exception 'Invalid Business Settings tab access';
   end if;
  end loop;
 end if;
 return new;
end;$function$;
