-- Rollback-only fixture. Cost method: a material's cost price is saved, downloaded and used as the
-- sale's cost rate; a wrong one and a wrong cost method are refused.
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); shop uuid; mat uuid := gen_random_uuid(); led jsonb; rates jsonb; refused text := '';
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'cost-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Cost method');
  set local role authenticated;
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.created', 'data',
    jsonb_build_object('id', mat, 'name', 'Art paper', 'available', 10, 'measurementUnit', 'sheet', 'requireSize', false,
      'costPrice', 12550, 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  -- An edit that does not send it keeps it; null clears it later.
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.updated', 'data',
    jsonb_build_object('id', mat, 'baseVersion', 1, 'name', 'Art paper 300g', 'available', 10, 'measurementUnit', 'sheet',
      'requireSize', false, 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  begin
    perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.updated', 'data',
      jsonb_build_object('id', mat, 'baseVersion', 2, 'name', 'Art paper 300g', 'available', 10, 'measurementUnit', 'sheet',
        'requireSize', false, 'costPrice', -5, 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'Cost price must be%' then raise exception 'Negative cost price not refused: %', refused; end if;
  if (select cost_price from public.materials where id = mat) <> 12550 then raise exception 'Cost price not kept'; end if;
  led := public.get_ledger(shop);
  if (select x->>'costPrice' from jsonb_array_elements(led->'materials') x where x->>'id' = mat::text) <> '12550' then
    raise exception 'Cost price not downloaded: %', led->'materials';
  end if;
  rates := private.cost_rates_for(shop, jsonb_build_object('materialId', mat));
  if (rates->'materials'->>mat::text)::numeric <> 12550 then raise exception 'Sale cost rate not the cost price: %', rates; end if;
  -- Actual is accepted as the cost method; anything else is refused.
  insert into public.business_settings(shop_id, modified_by, settings)
  values (shop, owner, $cfg${"businessName": "Cost method", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}, {"label": "POS", "kind": "POS", "enabled": true}, {"label": "Transfer", "kind": "Transfer", "enabled": true}], "expenseCategories": ["Materials", "Electricity", "Fuel", "Rent", "Wages", "Maintenance", "Delivery", "Outsourcing", "Internet / phone", "Other"], "jobSources": ["In shop / USB", "Shop network", "WhatsApp", "Email", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet", "piece", "metre", "square metre", "roll", "kilogram", "litre"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Expenses", "Materials", "Services", "Stock History", "Print Settings", "Users", "My Account", "Conflict Inbox", "Material Waste"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thank you for your business."}, "costMethod": "actual"}$cfg$::jsonb)
  on conflict (shop_id) do update set settings = excluded.settings;
  refused := '';
  begin
    update public.business_settings set settings = $cfg${"businessName": "Cost method", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}, {"label": "POS", "kind": "POS", "enabled": true}, {"label": "Transfer", "kind": "Transfer", "enabled": true}], "expenseCategories": ["Materials", "Electricity", "Fuel", "Rent", "Wages", "Maintenance", "Delivery", "Outsourcing", "Internet / phone", "Other"], "jobSources": ["In shop / USB", "Shop network", "WhatsApp", "Email", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet", "piece", "metre", "square metre", "roll", "kilogram", "litre"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Expenses", "Materials", "Services", "Stock History", "Print Settings", "Users", "My Account", "Conflict Inbox", "Material Waste"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thank you for your business."}, "costMethod": "guess"}$cfg$::jsonb where shop_id = shop;
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Choose the cost method%' then raise exception 'Wrong cost method not refused: %', refused; end if;
  raise notice 'Cost method passed';
end $test$;
rollback;
