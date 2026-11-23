-- Rollback-only fixture. Lock screen: new Security choices, clearing a PIN, the wrong-tries notice.
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); admin uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); shop uuid;
  ok boolean;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'lock-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Lock screen');
  perform test.add_member(shop, admin, 'admin');
  perform test.add_member(shop, cashier, 'cashier');
  insert into private.member_pins(shop_id, user_id, pin_hash) values
    (shop, cashier, 'v1$150000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),
    (shop, admin, 'v1$150000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

  -- The new choices are accepted; a wrong one is refused.
  insert into public.business_settings(shop_id, modified_by, settings)
  values (shop, owner, $cfg${"businessName": "Lock screen", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}, {"label": "POS", "kind": "POS", "enabled": true}, {"label": "Transfer", "kind": "Transfer", "enabled": true}], "expenseCategories": ["Materials", "Electricity", "Fuel", "Rent", "Wages", "Maintenance", "Delivery", "Outsourcing", "Internet / phone", "Other"], "jobSources": ["In shop / USB", "Shop network", "WhatsApp", "Email", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet", "piece", "metre", "square metre", "roll", "kilogram", "litre"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Expenses", "Materials", "Services", "Stock History", "Print Settings", "Users", "My Account", "Conflict Inbox", "Material Waste"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thank you for your business."}, "security": {"autoLockMinutes": 5, "minPinLength": 6, "pinTries": 3, "rememberPeople": true, "rememberDays": 14, "rememberMax": 5, "requirePin": false, "allowBiometric": false}}$cfg$::jsonb)
  on conflict (shop_id) do update set settings = excluded.settings;
  begin
    update public.business_settings set settings = $cfg${"businessName": "Lock screen", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}, {"label": "POS", "kind": "POS", "enabled": true}, {"label": "Transfer", "kind": "Transfer", "enabled": true}], "expenseCategories": ["Materials", "Electricity", "Fuel", "Rent", "Wages", "Maintenance", "Delivery", "Outsourcing", "Internet / phone", "Other"], "jobSources": ["In shop / USB", "Shop network", "WhatsApp", "Email", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet", "piece", "metre", "square metre", "roll", "kilogram", "litre"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Expenses", "Materials", "Services", "Stock History", "Print Settings", "Users", "My Account", "Conflict Inbox", "Material Waste"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thank you for your business."}, "security": {"autoLockMinutes": 5, "pinTries": 4}}$cfg$::jsonb where shop_id = shop;
    raise exception 'pinTries 4 was accepted';
  exception when others then
    if sqlerrm not like 'Choose 3, 5 or 10 PIN tries%' then raise; end if;
  end;

  -- A cashier can't clear a PIN; an Admin clears the cashier's but not the owner's or their own.
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  set local role authenticated;
  begin perform public.clear_member_pin(shop, admin); raise exception 'cashier cleared a PIN';
  exception when others then if sqlerrm not like 'Only Admins%' then raise; end if; end;
  reset role;
  perform set_config('request.jwt.claim.sub', admin::text, true);
  set local role authenticated;
  perform public.clear_member_pin(shop, cashier);
  begin perform public.clear_member_pin(shop, owner); raise exception 'admin cleared the owner''s PIN';
  exception when others then if sqlerrm not like 'You can only clear%' then raise; end if; end;
  begin perform public.clear_member_pin(shop, admin); raise exception 'admin cleared own PIN';
  exception when others then if sqlerrm not like 'Change your own PIN%' then raise; end if; end;
  -- The cashier's lockout, reported from the device by whoever is signed in: one notice for Admins.
  perform public.report_pin_lockout(shop, cashier, 'Front desk phone');
  perform public.report_pin_lockout(shop, cashier, 'Front desk phone');
  reset role;
  if exists (select 1 from private.member_pins where shop_id = shop and user_id = cashier) then raise exception 'PIN not cleared'; end if;
  if not exists (select 1 from private.member_pins where shop_id = shop and user_id = admin) then raise exception 'Wrong PIN cleared'; end if;
  if (select count(*) from public.notices where shop_id = shop and title like 'Wrong PIN tries:%' and min_level = 2) <> 1 then
    raise exception 'Expected one lockout notice: %', (select count(*) from public.notices where shop_id = shop);
  end if;
  raise notice 'Lock screen passed';
end $test$;
rollback;
