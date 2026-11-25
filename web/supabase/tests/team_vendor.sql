-- Rollback-only fixture. Team work: an outside vendor doing a stage, or a share of it next to the Team, chosen from Payees.
begin;
do $test$
declare pay uuid := gen_random_uuid(); exp uuid := gen_random_uuid(); rec jsonb;
  owner uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  shop uuid; cust uuid := gen_random_uuid(); j uuid := gen_random_uuid(); ada uuid := gen_random_uuid();
  asg uuid := gen_random_uuid(); w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); led jsonb; refused text; r jsonb;
  manager uuid := gen_random_uuid(); w3 uuid := gen_random_uuid(); q1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid();
  cfg jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'team-vendor-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Team work');
  perform test.add_member(shop, cashier, 'cashier');
  perform test.add_member(shop, admin, 'admin');
  perform test.add_member(shop, manager, 'manager');
  cfg := $cfg${"businessName": "Team work", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}], "expenseCategories": ["Materials", "Other"], "jobSources": ["In shop / USB", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Jobs", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Users", "My Account"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thanks"}}$cfg$::jsonb;
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, cfg)
    on conflict (shop_id) do update set settings = excluded.settings;
  insert into public.customers(shop_id, id, name, created_at) values (shop, cust, 'Bola', now());
  insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, production_status, metadata)
  values (shop, j, cust, 'Flyers', '1,000 flyers', 500000, now() - interval '3 days', 'Printing', '{"quantity": 1000}');

  -- Switched off: team changes are refused.
  refused := '';
  set local role authenticated;
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.person_saved', 'data',
      jsonb_build_object('id', ada, 'name', 'Ada')));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'Team work is switched off%' then raise exception 'Off: %', refused; end if;

  -- Only a General Manager or higher switches it on: an Admin is refused, the owner (rank 4) may.
  perform set_config('request.jwt.claim.sub', admin::text, true);
  refused := '';
  begin
    update public.business_settings set settings = settings || '{"teamWork": {"enabled": true}}' where shop_id = shop;
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Only a General Manager%' then raise exception 'Admin switched Team work: %', refused; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  refused := '';
  begin
    update public.business_settings set settings = settings || '{"teamWork": {"enabled": true, "doneAtDays": 400}}' where shop_id = shop;
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Choose 0 to 90 days%' then raise exception 'Bad days: %', refused; end if;
  update public.business_settings set settings = settings || '{"teamWork": {"enabled": true}}' where shop_id = shop;

  -- A Team person added by name (no login); a cashier cannot.
  set local role authenticated;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.person_saved', 'data',
    jsonb_build_object('id', ada, 'baseVersion', 0, 'name', ' Ada ', 'role', 'Finisher', 'phone', '0803')));
  reset role;
  update public.jobs set production_status = 'Completed', metadata = metadata || '{"workflow": ["Added","Printing","Finishing","Completed","Collected"]}' where id = j;
  set local role authenticated;
  perform public.apply_operations_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'payee.created', 'data',
    jsonb_build_object('id', pay, 'name', 'Kano Prints', 'phone', '', 'address', '', 'note', '', 'modifiedBy', owner)));
  -- A whole stage outsourced (no people): no share needed.
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
    jsonb_build_object('id', w1, 'jobId', j, 'stage', 'Printing', 'doneAt', now(), 'unit', 'percent', 'shares', '[]'::jsonb,
      'vendor', jsonb_build_object('name', 'Kano Prints', 'cost', 900000, 'payeeId', pay, 'expenseId', exp))));
  select data into rec from public.team_records where id = w1;
  if rec->'vendor'->>'payeeId' <> pay::text or rec->'vendor'->>'expenseId' <> exp::text or (rec->'vendor'->>'cost')::int <> 900000 then
    raise exception 'Vendor not kept: %', rec; end if;
  -- Next to the Team: the shares, the vendor's included, add up to 100.
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Finishing', 'doneAt', now(), 'unit', 'percent',
        'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 60)), 'vendor', jsonb_build_object('name', 'Kano Prints', 'cost', 0))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Enter the vendor''s share%' then raise exception 'No vendor share: %', refused; end if;
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Finishing', 'doneAt', now(), 'unit', 'percent',
        'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 60)), 'vendor', jsonb_build_object('name', 'Kano Prints', 'cost', 0, 'share', 50))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'The shares must add up to 100%' then raise exception 'Over 100: %', refused; end if;
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Finishing', 'doneAt', now(), 'unit', 'percent', 'shares', '[]'::jsonb,
        'vendor', jsonb_build_object('name', 'Nobody', 'cost', 0, 'payeeId', gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Choose the vendor from Payees%' then raise exception 'Unknown payee: %', refused; end if;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
    jsonb_build_object('id', w2, 'jobId', j, 'stage', 'Finishing', 'doneAt', now(), 'unit', 'percent',
      'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 60)), 'vendor', jsonb_build_object('name', 'Kano Prints', 'cost', 0, 'share', 40, 'payeeId', pay))));
  reset role;
  if (select (data->'vendor'->>'share')::numeric from public.team_records where id = w2) <> 40 then raise exception 'Vendor share not kept'; end if;
  raise notice 'Team vendor passed';
end $test$;
rollback;
