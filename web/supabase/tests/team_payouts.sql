-- Rollback-only fixture. Team work: paying commission out, with deductions and advances.
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
  values (owner, 'team-payouts-owner@example.invalid', now(), '{}', now());
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
  exp := gen_random_uuid();
  insert into public.expenses(id, shop_id, data) values (exp, shop, '{"category":"Commission"}');
  -- Commission switched off: refused.
  refused := '';
  set local role authenticated;
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.payout_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'personId', ada, 'kind', 'payout', 'amount', 5000, 'paidOn', current_date, 'expenseId', exp)));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'Commission is switched off%' then raise exception 'Off: %', refused; end if;
  update public.business_settings set settings = jsonb_set(settings, '{teamWork,commission}', 'true') where shop_id = shop;
  -- An Admin cannot pay (terms rank: General Manager).
  perform set_config('request.jwt.claim.sub', admin::text, true);
  refused := '';
  set local role authenticated;
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.payout_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'personId', ada, 'kind', 'payout', 'amount', 5000, 'paidOn', current_date, 'expenseId', exp)));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'You cannot pay commission%' then raise exception 'Admin paid: %', refused; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  -- A payout needs its expense; a deduction moves no money.
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.payout_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'personId', ada, 'kind', 'payout', 'amount', 5000, 'paidOn', current_date, 'expenseId', gen_random_uuid())));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Record the payment%' then raise exception 'No expense: %', refused; end if;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.payout_recorded', 'data',
    jsonb_build_object('id', q1, 'personId', ada, 'kind', 'payout', 'amount', 5000, 'paidOn', current_date, 'expenseId', exp, 'note', 'Advance')));
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.payout_recorded', 'data',
    jsonb_build_object('id', q2, 'personId', ada, 'kind', 'deduction', 'amount', 1000, 'paidOn', current_date, 'note', 'Spoilt print')));
  reset role;
  if (select count(*) from public.team_records where shop_id = shop and collection = 'teamPayouts') <> 2 then raise exception 'Payouts not kept'; end if;
  -- Pay: only those who set terms see others' payouts; each person sees their own.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  led := public.get_ledger(shop);
  if jsonb_array_length(led->'teamPayouts') <> 2 then raise exception 'Owner sees % payouts', jsonb_array_length(led->'teamPayouts'); end if;
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', cashier, 'role', 'authenticated')::text, true);
  led := public.get_ledger(shop);
  if jsonb_array_length(led->'teamPayouts') <> 0 then raise exception 'A cashier sees others'' payouts'; end if;
end $test$;
rollback;
