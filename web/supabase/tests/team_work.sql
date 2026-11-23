-- Rollback-only fixture. Team work: the switch (General Manager or higher), Team people, assigning,
-- recording work with shares and Done at, and confirming; and what each rank is refused.
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  shop uuid; cust uuid := gen_random_uuid(); j uuid := gen_random_uuid(); ada uuid := gen_random_uuid();
  asg uuid := gen_random_uuid(); w1 uuid := gen_random_uuid(); w2 uuid := gen_random_uuid(); led jsonb; refused text; r jsonb;
  manager uuid := gen_random_uuid(); w3 uuid := gen_random_uuid(); q1 uuid := gen_random_uuid(); q2 uuid := gen_random_uuid();
  cfg jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'team-owner@example.invalid', now(), '{}', now());
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
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.person_saved', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'baseVersion', 0, 'name', 'Tunde')));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Only an Admin%' then raise exception 'Cashier added a person: %', refused; end if;

  -- Assigning: an Admin assigns Printing to Ada and the cashier; a stale version is refused.
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.assigned', 'data',
    jsonb_build_object('id', asg, 'baseVersion', 0, 'jobId', j, 'stage', 'Printing', 'personIds', jsonb_build_array(ada, cashier))));
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.assigned', 'data',
      jsonb_build_object('id', asg, 'baseVersion', 0, 'jobId', j, 'stage', 'Printing', 'personIds', jsonb_build_array(ada))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Someone else changed%' then raise exception 'Stale assignment: %', refused; end if;
  reset role;

  -- Recording: the job moves on from Printing. A cashier records only their own work, now.
  update public.jobs set production_status = 'Completed' where shop_id = shop and id = j;
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  set local role authenticated;
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Printing', 'doneAt', now(), 'unit', 'percent',
        'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 100)))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'You can record only your own work%' then raise exception 'Cashier recorded for Ada: %', refused; end if;
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Printing', 'doneAt', now() - interval '2 days', 'unit', 'percent',
        'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 100)))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'You cannot record an earlier Done at%' then raise exception 'Cashier earlier Done at: %', refused; end if;
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Completed', 'doneAt', now(), 'unit', 'percent',
        'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 100)))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Record work for a stage the job has finished%' then raise exception 'Unfinished stage: %', refused; end if;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
    jsonb_build_object('id', w1, 'jobId', j, 'stage', 'Printing', 'doneAt', now(), 'unit', 'quantity',
      'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 400)))));
  -- An Admin records Ada's 600 of 1,000, done yesterday: confirmed at once (not their own work).
  perform set_config('request.jwt.claim.sub', admin::text, true);
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'jobId', j, 'stage', 'Printing', 'doneAt', now() - interval '1 day', 'unit', 'quantity',
        'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 1200)))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'The quantities add up to more%' then raise exception 'Too many: %', refused; end if;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
    jsonb_build_object('id', w2, 'jobId', j, 'stage', 'Printing', 'doneAt', now() - interval '1 day', 'unit', 'quantity',
      'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 600)),
      'redo', jsonb_build_object('responsibleId', cashier, 'note', 'Smudged'))));
  -- The cashier's own record waits; the Admin confirms it.
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_confirmed', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'recordIds', jsonb_build_array(w1))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'You cannot confirm work%' then raise exception 'Cashier confirmed: %', refused; end if;
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_confirmed', 'data',
    jsonb_build_object('id', gen_random_uuid(), 'recordIds', jsonb_build_array(w1))));

  -- The download and a sync carry the Team, assignments and work records.
  led := public.get_ledger(shop);
  if not exists (select 1 from jsonb_array_elements(led->'teamPeople') p where p->>'id' = ada::text and p->>'name' = 'Ada')
     or not exists (select 1 from jsonb_array_elements(led->'teamPeople') p where p->>'id' = cashier::text and (p->>'member')::boolean) then
    raise exception 'Team not downloaded: %', led->'teamPeople';
  end if;
  if (led->'jobAssignments'->0->'personIds') <> jsonb_build_array(ada, cashier) and (led->'jobAssignments'->0->'personIds') <> jsonb_build_array(cashier, ada) then
    raise exception 'Assignment: %', led->'jobAssignments';
  end if;
  select x into r from jsonb_array_elements(led->'workRecords') x where x->>'id' = w1::text;
  if r->>'status' <> 'confirmed' or r->>'confirmedBy' <> admin::text then raise exception 'Own record not confirmed: %', r; end if;
  select x into r from jsonb_array_elements(led->'workRecords') x where x->>'id' = w2::text;
  if r->>'status' <> 'confirmed' or (r->>'doneAt')::timestamptz > now() - interval '23 hours' or (r->>'recordedAt')::timestamptz < now() - interval '1 minute' then
    raise exception 'Done at / Recorded at: %', r;
  end if;
  led := public.get_ledger_changes(shop, (pg_current_xact_id()::text::bigint - 1)::text);
  if jsonb_array_length(led->'ledger'->'workRecords') <> 2 then raise exception 'Sync work records: %', led->'ledger'->'workRecords'; end if;

  -- Corrections. The cashier (not cleared) asks to correct their own record: a request an Admin approves.
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_corrected', 'data',
    jsonb_build_object('id', q1, 'recordId', w1, 'baseVersion', 2, 'reason', 'Counted wrong',
      'changes', jsonb_build_object('unit', 'quantity', 'doneAt', now(), 'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 350))))));
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.correction_decided', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'requestId', q1, 'approve', true)));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'This correction needs someone of a higher rank%' then raise exception 'Cashier approved: %', refused; end if;
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.correction_decided', 'data',
    jsonb_build_object('id', gen_random_uuid(), 'requestId', q1, 'approve', true)));
  -- An Admin corrects their own entry at once, with the audit kept.
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_corrected', 'data',
    jsonb_build_object('id', gen_random_uuid(), 'recordId', w2, 'baseVersion', 1, 'reason', 'It was 650',
      'changes', jsonb_build_object('unit', 'quantity', 'doneAt', now() - interval '1 day', 'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 650))))));
  -- The General Manager's entry: an Admin's correction waits for a General Manager; a Manager's goes through with an alert.
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_recorded', 'data',
    jsonb_build_object('id', w3, 'jobId', j, 'stage', 'In Queue', 'doneAt', now(), 'unit', 'percent',
      'shares', jsonb_build_array(jsonb_build_object('personId', ada, 'share', 100)))));
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_corrected', 'data',
    jsonb_build_object('id', q2, 'recordId', w3, 'baseVersion', 1, 'reason', 'Tunde helped',
      'changes', jsonb_build_object('unit', 'percent', 'doneAt', now(), 'shares', jsonb_build_array(jsonb_build_object('personId', admin, 'share', 100))))));
  perform set_config('request.jwt.claim.sub', manager::text, true);
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.correction_decided', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'requestId', q2, 'approve', true)));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'This correction needs someone of a higher rank%' then raise exception 'Manager approved a GM-level request: %', refused; end if;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_corrected', 'data',
    jsonb_build_object('id', gen_random_uuid(), 'recordId', w3, 'baseVersion', 1, 'reason', 'It was the queue clerk',
      'changes', jsonb_build_object('unit', 'percent', 'doneAt', now(), 'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 100))))));
  -- No reason: refused.
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.work_corrected', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'recordId', w3, 'baseVersion', 2, 'reason', '',
        'changes', jsonb_build_object('unit', 'percent', 'doneAt', now(), 'shares', jsonb_build_array(jsonb_build_object('personId', cashier, 'share', 100))))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Give a reason%' then raise exception 'No reason: %', refused; end if;
  -- The usual people for a stage: a cashier's checkout assigns them; anything else is refused.
  reset role;
  update public.business_settings set settings = jsonb_set(settings, '{teamWork,usual}', jsonb_build_object('Printing', jsonb_build_array(ada)))
    where shop_id = shop;
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  set local role authenticated;
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.assigned', 'data',
    jsonb_build_object('id', gen_random_uuid(), 'baseVersion', 0, 'jobId', j, 'stage', 'Printing', 'usual', true, 'personIds', jsonb_build_array(ada))));
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.assigned', 'data',
      jsonb_build_object('id', gen_random_uuid(), 'baseVersion', 0, 'jobId', j, 'stage', 'Printing', 'usual', true, 'personIds', jsonb_build_array(cashier))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'You cannot assign work%' then raise exception 'Cashier assigned others than the usual: %', refused; end if;
  perform set_config('request.jwt.claim.sub', manager::text, true);
  -- Commission terms: a Manager cannot set them (General Manager and above by default); the owner can.
  refused := '';
  begin
    perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.terms_set', 'data',
      jsonb_build_object('id', ada, 'baseVersion', 0, 'commission', jsonb_build_object('kind', 'percent', 'rate', 5))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'You cannot set commission terms%' then raise exception 'Manager set terms: %', refused; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform public.apply_team_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'team.terms_set', 'data',
    jsonb_build_object('id', ada, 'baseVersion', 0, 'commission', jsonb_build_object('kind', 'perUnit', 'rate', 50, 'salesRate', 2))));
  if jsonb_array_length(public.get_ledger(shop)->'teamTerms') <> 1 then raise exception 'Owner does not see terms'; end if;
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  if jsonb_array_length(public.get_ledger(shop)->'teamTerms') <> 0 then raise exception 'Cashier sees others'' terms'; end if;
  reset role;
  select data into r from public.team_records where shop_id = shop and id = w1;
  if r->'shares'->0->>'share' <> '350' or r->>'status' <> 'confirmed' or r->'corrections'->0->>'approvedBy' <> admin::text then
    raise exception 'Approved request not applied: %', r;
  end if;
  select data into r from public.team_records where shop_id = shop and id = w2;
  if r->'shares'->0->>'share' <> '650' or jsonb_array_length(r->'corrections') <> 1 or r->'corrections'->0->'before'->'shares'->0->>'share' <> '600' then
    raise exception 'Direct correction or its audit: %', r;
  end if;
  select data into r from public.team_records where shop_id = shop and id = w3;
  if r->'shares'->0->>'personId' <> cashier::text or not (r->'corrections'->0->>'alert')::boolean or r->'corrections'->0->>'alertFor' <> owner::text then
    raise exception 'Manager correction alert: %', r;
  end if;
  if (select data->>'approverRank' from public.team_records where id = q2) <> '4' then raise exception 'Approver rank for a GM entry'; end if;
  raise notice 'Team work passed';
end $test$;
rollback;
