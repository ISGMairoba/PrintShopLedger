-- Actual cost, parts C and D (plans/actual-cost-v2.md):
--   * Late delivery bills (decision 8): an expense linked to a restock after the restock makes only that
--     delivery's units still in stock dearer (the newest stock counts as used last); the part for units
--     already used is a late cost adjustment, kept in private.late_costs. Editing or voiding the expense
--     moves the difference the same way. Bills linked before are applied once now.
--   * The download (and every sync) carries the server's figures: each stock history line's unitCost
--     and costActual, every location's stock value (stockValues) and the late costs (lateCosts), so
--     every device shows the same costs however much history it keeps.

create table if not exists private.late_costs (
  shop_id uuid not null references public.shops(id) on delete cascade,
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null,
  restock_id uuid not null,
  material_id uuid not null,
  location text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists late_costs_shop on private.late_costs (shop_id, created_at);
create table if not exists private.restock_extras (
  shop_id uuid not null,
  expense_id uuid not null,
  restock_id uuid not null,
  amount numeric not null,
  primary key (shop_id, expense_id, restock_id)
);
alter table private.late_costs enable row level security;
alter table private.restock_extras enable row level security;
revoke all on private.late_costs, private.restock_extras from public, anon, authenticated;

-- Bring an expense's share of its restocks up to date: what it adds to each restock (by supplier price,
-- equally when all are free), less what was already applied.
create or replace function private.apply_restock_extras(p_shop uuid, p_expense uuid, p_data jsonb)
returns void language plpgsql security definer set search_path to '' as $f$
declare h record; want numeric; had numeric; delta numeric; received numeric; held numeric; joined numeric;
  total numeric; n integer; linked uuid[];
begin
  linked := case when coalesce((p_data->>'voided')::boolean, false) or jsonb_typeof(p_data->'restockIds') is distinct from 'array'
    then '{}'::uuid[] else array(select value::uuid from jsonb_array_elements_text(p_data->'restockIds')) end;
  select coalesce(sum((after_values->'cost'->>'supplierPrice')::numeric), 0), count(*) into total, n
    from public.material_stock_changes where shop_id = p_shop and id = any (linked) and after_values ? 'cost';
  for h in
    select l.id, l.material_id, coalesce(l.branch_id, 'main') loc, l.after_available - l.before_available got,
           coalesce((l.after_values->'cost'->>'supplierPrice')::numeric, 0) price
      from public.material_stock_changes l
     where l.shop_id = p_shop and (l.id = any (linked) or l.id in (select restock_id from private.restock_extras where shop_id = p_shop and expense_id = p_expense))
  loop
    want := case when not h.id = any (linked) or n = 0 then 0
                 when total > 0 then (p_data->>'amount')::numeric * h.price / total
                 else (p_data->>'amount')::numeric / n end;
    select amount into had from private.restock_extras where shop_id = p_shop and expense_id = p_expense and restock_id = h.id;
    delta := want - coalesce(had, 0);
    if delta = 0 then continue; end if;
    -- The newest stock counts as used last: the units of this delivery still held are the stock held,
    -- up to what it brought.
    select greatest(0, quantity) into held from private.stock_values where shop_id = p_shop and location = h.loc and material_id = h.material_id;
    received := greatest(0, h.got);
    joined := case when received > 0 then delta * least(1, coalesce(held, 0) / received) else 0 end;
    update private.stock_values set value = greatest(0, value + joined),
        average = case when quantity > 0 then greatest(0, value + joined) / quantity else average end, updated_at = now()
      where shop_id = p_shop and location = h.loc and material_id = h.material_id;
    if round(delta - joined, 4) <> 0 then
      insert into private.late_costs(shop_id, expense_id, restock_id, material_id, location, amount)
      values (p_shop, p_expense, h.id, h.material_id, h.loc, delta - joined);
    end if;
    insert into private.restock_extras values (p_shop, p_expense, h.id, want)
      on conflict (shop_id, expense_id, restock_id) do update set amount = excluded.amount;
  end loop;
end $f$;
revoke all on function private.apply_restock_extras(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function private.restock_extras_trigger() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if tg_op = 'UPDATE' and new.data->'restockIds' is not distinct from old.data->'restockIds'
     and new.data->'amount' is not distinct from old.data->'amount'
     and new.data->'voided' is not distinct from old.data->'voided' then return new; end if;
  perform private.apply_restock_extras(new.shop_id, new.id, new.data);
  return new;
end $f$;
drop trigger if exists zz_restock_extras on public.expenses;
create trigger zz_restock_extras after insert or update on public.expenses
  for each row execute function private.restock_extras_trigger();

-- Bills already linked to restocks: applied once, as of now.
do $m$
declare e record;
begin
  for e in select shop_id, id, data from public.expenses
            where jsonb_typeof(data->'restockIds') = 'array' and jsonb_array_length(data->'restockIds') > 0
              and not exists (select 1 from private.restock_extras x where x.shop_id = expenses.shop_id and x.expense_id = expenses.id)
  loop
    perform private.apply_restock_extras(e.shop_id, e.id, e.data);
  end loop;
end $m$;

-- The valuation for the download: every location's stock value (a branch sees its own) and late costs.
create or replace function private.valuation_for(p_shop uuid, p_keep text)
returns jsonb language plpgsql stable security definer set search_path to '' as $f$
begin
  if not public.is_shop_member(p_shop) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'stockValues', (select coalesce(jsonb_agg(jsonb_build_object('id', location || '|' || material_id, 'location', location,
        'materialId', material_id, 'quantity', quantity, 'value', round(value), 'average', round(average, 4),
        'restocks', restocks, 'noCost', no_cost) order by location, material_id), '[]'::jsonb)
      from private.stock_values where shop_id = p_shop and (p_keep is null or location = p_keep)),
    'lateCosts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'expenseId', expense_id, 'restockId', restock_id,
        'materialId', material_id, 'location', location, 'amount', round(amount), 'at', created_at) order by created_at, id), '[]'::jsonb)
      from private.late_costs where shop_id = p_shop and (p_keep is null or location = p_keep)));
end $f$;
revoke all on function private.valuation_for(uuid, text) from public, anon;
grant execute on function private.valuation_for(uuid, text) to authenticated;

-- The download.
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
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
        -- What the line moved at, by the server's valuation (Actual cost method).
        || case when unit_cost is not null then jsonb_build_object('unitCost', round(unit_cost, 4), 'costActual', coalesce(cost_actual, false)) else '{}'::jsonb end v
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

  -- The server's stock valuation and late costs (Actual cost method).
  result := result || private.valuation_for(p_shop, keep);
  perform set_config('psl.ledger', prev, true);
  return result;
end $function$;

-- Every sync carries them too (whole: they are small).
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null, p_slim boolean default false)
returns jsonb language plpgsql stable set search_path to '' as $f$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); r jsonb; v record;
begin
  perform set_config('psl.ledger', 'on', true);
  r := public.get_ledger_changes_before_guard(p_shop, p_since, p_slim);
  if r ? 'ledger' and not coalesce((r->>'full')::boolean, false) then
    select * into v from private.branch_view(p_shop);
    r := jsonb_set(r, '{ledger}', (r->'ledger') || private.valuation_for(p_shop,
      case when coalesce(v.has_branches, false) then v.keep_branch end));
  end if;
  perform set_config('psl.ledger', prev, true);
  return r;
end $f$;
