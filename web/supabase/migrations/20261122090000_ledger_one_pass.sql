-- NEW-02: the download is built in one pass.
--
-- get_ledger used to be 15 layers, each calling the one before and patching its result: jobs,
-- payments, material history and checkouts were built several times, and each later layer
-- unpacked the JSON again to join extra columns back in. This builds every collection once,
-- with all its fields, in the order and shape the layers produced. The output is the same, byte for
-- byte (the TEST and supabase/tests/ledger_one_pass.sql compare it with the old download).
--
-- The old download stays as private.get_ledger_layered (for that comparison, and to switch back
-- with one statement if ever needed). The get_ledger_before_* layers are left in place for it.

-- 1. Keep the old download under a new name.
create or replace function private.get_ledger_layered(p_shop uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); result jsonb;
begin
  perform set_config('psl.ledger', 'on', true);
  result := public.get_ledger_before_min_order(p_shop);
  if result ? 'services' then
    result := jsonb_set(result, '{services}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('minQuantity', coalesce(s.min_quantity, 0)) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'services') with ordinality x(v, n)
      left join public.services s on s.shop_id = p_shop and s.id = (x.v->>'id')::uuid));
  end if;
  perform set_config('psl.ledger', prev, true);
  return result;
end $$;
revoke all on function private.get_ledger_layered(uuid) from public, anon, authenticated;

-- 2. The download, in one pass.
create or replace function public.get_ledger(p_shop uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
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
        'modifiedByLabel', modified_by_label, 'modifiedAt', modified_at, 'lastEventId', last_event_id) order by created_at, id), '[]'::jsonb)
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
end $$;
