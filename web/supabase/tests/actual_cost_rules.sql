-- Rollback-only fixture. Actual cost rules (plans/actual-cost-v2.md, parts B and C): a priced
-- restock, a transfer that ignores the phone's cost, a return at the job's own cost, an expense with
-- amounts on its stock lines, and a split whose pieces share the roll's value by cost, less waste.
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); shop uuid; c uuid := gen_random_uuid(); j uuid := gen_random_uuid();
  paper uuid := gen_random_uuid(); a4 uuid := gen_random_uuid(); a5 uuid := gen_random_uuid(); bought uuid := gen_random_uuid();
  split_event uuid := gen_random_uuid(); x uuid := gen_random_uuid(); v record; unit numeric;
  mat jsonb := jsonb_build_object('measurementUnit', 'sheet', 'requireSize', false, 'available', 0);
  ev jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'actual-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Actual cost');
  set local role authenticated;
  for v in select * from (values (paper, 'Art paper', false, null::numeric), (a4, 'A4', true, null), (a5, 'A5', false, 1000),
                                 (bought, 'Ink', false, null)) t(id, name, can_split, price) loop
    perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.created', 'data',
      mat || jsonb_build_object('id', v.id, 'name', v.name, 'canSplit', v.can_split, 'costPrice', v.price,
        'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  end loop;

  -- 100 sheets for ₦10,000: ₦100 each.
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.stock_added', 'data',
    jsonb_build_object('id', paper, 'baseVersion', 1, 'quantity', 100, 'reason', 'Restock', 'cost', jsonb_build_object('supplierPrice', 1000000),
      'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  reset role;
  select * into v from private.stock_values where shop_id = shop and location = 'main' and material_id = paper;
  if round(v.average) <> 10000 or v.quantity <> 100 then raise exception 'Restock: % at %', v.quantity, v.average; end if;

  -- A job takes 10 sheets at ₦100; the price then rises to ₦300 (a new restock of 50 for ₦15,000 brings
  -- the average to ₦155); 4 sheets come back from the job at the ₦100 it took them at.
  insert into public.customers(id, shop_id, name, created_at, linked_branches, called_as) values (c, shop, 'Ada', now(), '{}', '');
  insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, production_status, metadata)
  values (shop, j, c, 'Print', 'Return test', 5000, now(), 'Added', '{}');
  insert into public.material_stock_changes(id, shop_id, material_id, action, before_available, after_available, reason, actor_id,
    actor_label, created_at, material_name, measurement_unit, before_values, after_values, details_complete, job_id)
  values (gen_random_uuid(), shop, paper, 'material.job_used', 100, 90, '', owner, 'Owner', now(), 'Art paper', 'sheet', '{}', '{}', true, j);
  set local role authenticated;
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.stock_added', 'data',
    jsonb_build_object('id', paper, 'baseVersion', 2, 'quantity', 50, 'reason', 'Restock', 'cost', jsonb_build_object('supplierPrice', 1500000),
      'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  reset role;
  insert into public.material_stock_changes(id, shop_id, material_id, action, before_available, after_available, reason, actor_id,
    actor_label, created_at, material_name, measurement_unit, before_values, after_values, details_complete, job_id)
  values (gen_random_uuid(), shop, paper, 'material.job_corrected', 140, 144, '', owner, 'Owner', now(), 'Art paper', 'sheet', '{}', '{}', true, j);
  select unit_cost into unit from public.material_stock_changes where shop_id = shop and job_id = j and action = 'material.job_corrected';
  if round(unit) <> 10000 then raise exception 'Return at % (expected the job''s ₦100)', unit / 100; end if;

  -- An expense buys 20 litres of ink for ₦8,000: its line amount makes it a priced restock (₦400 each).
  set local role authenticated;
  perform public.apply_expense_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'expense.created', 'data', jsonb_build_object(
    'id', x, 'description', 'Ink', 'category', 'Materials', 'incurredOn', '2026-11-20', 'amount', 800000, 'payee', '', 'note', '',
    'receiptReference', '', 'materials', jsonb_build_array(jsonb_build_object('materialId', bought, 'quantity', 20, 'measurementUnit', 'sheet', 'amount', 800000)),
    'stockIds', jsonb_build_object(bought::text, gen_random_uuid()), 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  begin
    perform public.apply_expense_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'expense.created', 'data', jsonb_build_object(
      'id', gen_random_uuid(), 'description', 'Ink', 'category', 'Materials', 'incurredOn', '2026-11-20', 'amount', 800000, 'payee', '', 'note', '',
      'receiptReference', '', 'materials', jsonb_build_array(jsonb_build_object('materialId', bought, 'quantity', 5, 'measurementUnit', 'sheet', 'amount', 1000)),
      'stockIds', jsonb_build_object(bought::text, gen_random_uuid()), 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
    raise exception 'Line amounts not adding up were accepted';
  exception when others then if sqlerrm not like 'The materials'' amounts must add up%' then raise; end if;
  end;
  reset role;
  select * into v from private.stock_values where shop_id = shop and location = 'main' and material_id = bought;
  if round(v.average) <> 40000 or v.restocks <> 1 then raise exception 'Expense line not a priced restock: % (% restocks)', v.average, v.restocks; end if;

  -- 10 A4 at ₦200 each (₦2,000) split into 20 A5 (cost price ₦10 each... only A5 is a piece, so it takes all
  -- the value less 10% waste: ₦1,800 for 20, ₦90 each).
  set local role authenticated;
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.stock_added', 'data',
    jsonb_build_object('id', a4, 'baseVersion', 1, 'quantity', 10, 'reason', 'Restock', 'cost', jsonb_build_object('supplierPrice', 200000),
      'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  perform public.apply_material_event(shop, jsonb_build_object('id', split_event, 'kind', 'material.split', 'data', jsonb_build_object(
    'id', a4, 'baseVersion', 2, 'quantity', 10, 'reason', 'Cut', 'wastePercent', 10,
    'pieces', jsonb_build_array(jsonb_build_object('toId', a5, 'toBaseVersion', 1, 'toEventId', gen_random_uuid(), 'yield', 2)),
    'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  reset role;
  select * into v from private.stock_values where shop_id = shop and location = 'main' and material_id = a5;
  if v.quantity <> 20 or round(v.value) <> 180000 then raise exception 'Split pieces: % sheets worth %', v.quantity, v.value; end if;
  if (select after_values->>'wasteQuantity' from public.material_stock_changes where id = split_event) <> '1.000' then
    raise exception 'Split waste not kept: %', (select after_values from public.material_stock_changes where id = split_event);
  end if;
  -- 20 sheets of paper to Ikeja: they arrive at the main branch's average (the phone's ₦999 is ignored).
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, $cfg${"businessName": "Actual cost", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}, {"label": "POS", "kind": "POS", "enabled": true}, {"label": "Transfer", "kind": "Transfer", "enabled": true}], "expenseCategories": ["Materials", "Electricity", "Fuel", "Rent", "Wages", "Maintenance", "Delivery", "Outsourcing", "Internet / phone", "Other"], "jobSources": ["In shop / USB", "Shop network", "WhatsApp", "Email", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet", "piece", "metre", "square metre", "roll", "kilogram", "litre"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Expenses", "Materials", "Services", "Stock History", "Print Settings", "Users", "My Account", "Conflict Inbox", "Material Waste"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thank you for your business."}, "branches": [{"id": "main", "name": "Main"}, {"id": "b-ikeja001", "name": "Ikeja"}]}$cfg$::jsonb)
  on conflict (shop_id) do update set settings = excluded.settings;
  select average into unit from private.stock_values where shop_id = shop and location = 'main' and material_id = paper;
  set local role authenticated;
  perform public.transfer_stock(gen_random_uuid(), shop, paper, 'main', 'b-ikeja001', 20, 'To Ikeja', 99900, true);
  reset role;
  select * into v from private.stock_values where shop_id = shop and location = 'b-ikeja001' and material_id = paper;
  if v.quantity <> 20 or round(v.average, 2) <> round(unit, 2) then
    raise exception 'Transfer arrived at % (main''s average %)', v.average, unit;
  end if;
  raise notice 'Actual cost rules passed';
end $test$;
rollback;
