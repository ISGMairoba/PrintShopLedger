-- Rollback-only fixture. Partners: an agreement, preparing stock, a sale that takes from stock and makes
-- a batch, the leftover back into stock, counts, a design change and ending the agreement.
begin;
do $test$
declare owner uuid := gen_random_uuid(); shop uuid; sara uuid := gen_random_uuid(); svc uuid := gen_random_uuid();
  build uuid := gen_random_uuid(); sale uuid := gen_random_uuid(); item jsonb; refused text; cfg jsonb;
  ev jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'partners-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  shop := test.new_shop('Partners');
  cfg := $cfg${"businessName": "Team work", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}], "expenseCategories": ["Materials", "Other"], "jobSources": ["In shop / USB", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Jobs", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Users", "My Account"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thanks"}}$cfg$::jsonb;
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, cfg) on conflict (shop_id) do update set settings = excluded.settings;
  insert into public.customers(shop_id, id, name, created_at) values (shop, sara, 'Sara', now());
  -- The partner item is a service made for Sara.
  if private.service_production(jsonb_build_object('partnerOf', sara, 'materialsAt', 'production'))->>'partnerOf' <> sara::text then
    raise exception 'partnerOf not kept'; end if;
  begin perform private.service_production('{"partnerOf":"nope"}'); raise exception 'Bad partnerOf accepted';
  exception when others then if sqlerrm = 'Bad partnerOf accepted' then raise; end if; end;
  insert into public.services(id, shop_id, description, price, created_by, created_by_label, modified_by, modified_by_label, last_event_id, production)
  values (svc, shop, 'A6 jotter, 60 pages', 50000, owner, 'Owner', owner, 'Owner', gen_random_uuid(),
    jsonb_build_object('partnerOf', sara, 'materialsAt', 'production', 'steps', '[{"name":"Printing","minutes":120,"unit":"h"},{"name":"Binding"}]'::jsonb));
  ev := jsonb_build_object('agreedStock', 200, 'refillAt', 80, 'batchSize', 250, 'endRule', 'partnerPays', 'collectRule', 'together', 'refillPrompt', 'ask', 'modifiedBy', owner);
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.item_saved', 'data', ev || jsonb_build_object('id', svc, 'customerId', sara, 'baseVersion', 0)));

  -- Prepare 250: a job for Sara at no charge, made without Design; when Completed, 250 go into stock.
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.build_started', 'data', jsonb_build_object('id', svc, 'jobId', build, 'quantity', 250, 'modifiedBy', owner)));
  if (select metadata->'workflow' from public.jobs where id = build) <> '["Added","Printing","Binding","Completed","Collected"]' or (select amount from public.jobs where id = build) <> 0 then
    raise exception 'Build job %', (select metadata from public.jobs where id = build); end if;
  refused := '';
  begin perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_built', 'data', jsonb_build_object('id', svc, 'jobId', build, 'modifiedBy', owner)));
  exception when others then refused := sqlerrm; end;
  if refused not like 'Add it to stock once the job is completed%' then raise exception 'Built early: %', refused; end if;
  update public.jobs set production_status = 'Completed', metadata = metadata || '{"productionStatus":"Completed"}' where id = build;
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_built', 'data', jsonb_build_object('id', svc, 'jobId', build, 'modifiedBy', owner)));
  if (select (data->>'onHand')::numeric from public.stock_records where id = svc) <> 250 then raise exception 'Not 250 on hand'; end if;

  -- A sale of 300: 250 from stock, 50 to make, made in a batch of 250: 200 left over go back.
  insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, production_status, metadata)
  values (shop, sale, sara, 'A6 jotter, 60 pages', '300 jotters', 15000000, now(), 'Added',
    jsonb_build_object('serviceId', svc, 'quantity', 300, 'partner', jsonb_build_object('itemId', svc, 'fromStock', 250, 'toMake', 50, 'made', 250)));
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_taken', 'data', jsonb_build_object('id', svc, 'jobId', sale, 'modifiedBy', owner)));
  if (select (data->>'onHand')::numeric from public.stock_records where id = svc) <> 0 then raise exception 'Stock not taken'; end if;
  refused := '';
  begin perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_taken', 'data', jsonb_build_object('id', svc, 'jobId', sale, 'modifiedBy', owner)));
  exception when others then refused := sqlerrm; end;
  if refused not like 'Already taken%' then raise exception 'Taken twice: %', refused; end if;
  update public.jobs set production_status = 'Completed' where id = sale;
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_built', 'data', jsonb_build_object('id', svc, 'jobId', sale, 'modifiedBy', owner)));
  select data into item from public.stock_records where id = svc;
  if (item->>'onHand')::numeric <> 200 then raise exception 'Leftover: %', item->>'onHand'; end if;

  -- Count: 198 on the shelf. A design change keeps the old stock to use first. Then the agreement ends.
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.stock_adjusted', 'data', jsonb_build_object('id', svc, 'quantity', 198, 'reason', 'Counted', 'modifiedBy', owner)));
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.design_changed', 'data', jsonb_build_object('id', svc, 'reason', 'New cover', 'modifiedBy', owner)));
  perform public.apply_partner_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'partner.ended', 'data', jsonb_build_object('id', svc, 'endRule', 'partnerPays', 'modifiedBy', owner)));
  select data into item from public.stock_records where id = svc;
  if (item->>'onHand')::numeric <> 198 or (item->>'design')::int <> 2 or item->>'status' <> 'ended' or jsonb_array_length(item->'moves') <> 7 then
    raise exception 'Item %', item; end if;
  if (item->'moves'->0->>'kind') <> 'build' or (item->'moves'->6->>'kind') <> 'ended' then raise exception 'Moves order %', item->'moves'; end if;
  if jsonb_array_length(public.get_ledger(shop)->'partnerItems') <> 1 then raise exception 'Download misses partner items'; end if;
end $test$;
rollback;
