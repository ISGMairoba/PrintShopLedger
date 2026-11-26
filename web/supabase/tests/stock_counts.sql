-- Rollback-only fixture. Stock counts, shelves, and materials taken in production.
begin;
do $test$
declare shop uuid;developer uuid=gen_random_uuid();outsider uuid=gen_random_uuid();
  mat uuid := '30000000-0000-4000-8000-000000000001'; job uuid := 'f5db0e47-7d85-4e3d-8834-899857378d7f';
  me uuid := '10000000-0000-4000-8000-000000000001'; cnt uuid := gen_random_uuid(); key text; refused text; r jsonb; led jsonb;
begin
insert into auth.users(id,email,raw_user_meta_data,created_at) values('10000000-0000-4000-8000-000000000001','stock-count-test@example.invalid','{}',now()),(outsider,outsider::text||'@example.invalid','{}',now());
update auth.users set email_confirmed_at=now() where id='10000000-0000-4000-8000-000000000001';
perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(developer,'staff-developer-stock-count@staff.printshopledger.invalid',now(),'{}',now());
shop=(public.complete_business_registration('10000000-0000-4000-8000-000000000001'::uuid,developer,'Stock count test','Tester',repeat('c',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('c',64))->>'shopId')::uuid;
perform public.apply_customer_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id','20000000-0000-4000-8000-000000000001','name','Test customer','phone','080111','address','Road','creditLimit',0,'modifiedBy','10000000-0000-4000-8000-000000000001')));
perform public.apply_material_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',jsonb_build_object('id','30000000-0000-4000-8000-000000000001','name','Paper','available',10,'measurementUnit','sheet','requireSize',false,'modifiedBy','10000000-0000-4000-8000-000000000001')));
perform public.apply_service_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',jsonb_build_object('id','40000000-0000-4000-8000-000000000001','description','Printing','materialId','30000000-0000-4000-8000-000000000001','price',10000,'modifiedBy','10000000-0000-4000-8000-000000000001')));
  -- A service may choose when its materials leave stock.
  if private.service_production('{"materialsAt":"production"}')->>'materialsAt' <> 'production' then raise exception 'materialsAt not kept'; end if;
  begin perform private.service_production('{"materialsAt":"later"}'); raise exception 'Bad materialsAt accepted';
  exception when others then if sqlerrm = 'Bad materialsAt accepted' then raise; end if; end;

  -- In production: the sale takes nothing and reserves the 60 sheets.
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, me, $cfg${"businessName": "Team work", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}], "expenseCategories": ["Materials", "Other"], "jobSources": ["In shop / USB", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Jobs", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Users", "My Account"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thanks"}}$cfg$::jsonb || '{"production":{"materialsAt":"production"},"jobs":{}}')
    on conflict (shop_id) do update set settings = public.business_settings.settings || '{"production":{"materialsAt":"production"}}';
  perform test.checkout(shop, $event${"id":"c78c2e1c-d0e2-405e-b683-5715e8236a0d","kind":"checkout.completed","data":{"id":"c78c2e1c-d0e2-405e-b683-5715e8236a0d","customerId":"20000000-0000-4000-8000-000000000001","newCustomer":null,"termsAndConditions":"Sales terms snapshot","customerSnapshot":{"id":"20000000-0000-4000-8000-000000000001","name":"Test customer","phone":"080111","address":"Road"},"jobBalances":[{"id":"f5db0e47-7d85-4e3d-8834-899857378d7f","description":"Test job","service":"Printing","amount":600000,"paidBefore":0,"paidThisCheckout":600000,"outstandingAfter":0}],"jobs":[{"id":"f5db0e47-7d85-4e3d-8834-899857378d7f","serviceId":"40000000-0000-4000-8000-000000000001","description":"Test job","quantity":60,"source":"WhatsApp","sourceNote":"","width":null,"height":null,"amount":600000,"unitPrice":10000,"service":"Printing","materialId":"30000000-0000-4000-8000-000000000001","materialNeeded":60,"measurementUnit":"sheet","requireSize":false,"serviceVersion":1,"customerId":"20000000-0000-4000-8000-000000000001","createdAt":"2026-10-06T12:00:00Z","checkoutId":"c78c2e1c-d0e2-405e-b683-5715e8236a0d","checkoutPosition":0,"productionStatus":"Added","version":1,"createdBy":"10000000-0000-4000-8000-000000000001","createdByLabel":"Manager","modifiedBy":"10000000-0000-4000-8000-000000000001","modifiedByLabel":"Manager","modifiedAt":"2026-10-06T12:00:00Z"}],"expectedAccount":"wallet=0;","cashReceived":700000,"useWallet":true,"override":null,"method":"Cash","paidOn":"2026-10-06","reference":"","createdBy":"10000000-0000-4000-8000-000000000001","createdByLabel":"Manager","createdAt":"2026-10-06T12:00:00Z","total":600000,"allocations":[{"jobId":"f5db0e47-7d85-4e3d-8834-899857378d7f","amount":600000}],"allocated":600000,"walletUsed":0,"walletAdded":100000,"walletAfter":100000,"outstandingBefore":600000,"outstandingAfter":0}}$event$::jsonb);
  if (select available from public.materials where id = mat) <> 10 then raise exception 'Production sale took stock: %', (select available from public.materials where id = mat); end if;
  if (select metadata->>'materialsAt' from public.jobs where id = job) <> 'production' then raise exception 'Job not marked for production'; end if;
  if private.material_reserved(shop, mat) <> 60 then raise exception 'Reserved %', private.material_reserved(shop, mat); end if;
  if exists (select 1 from public.material_stock_changes where shop_id = shop and job_id = job) then raise exception 'A stock change was recorded at the sale'; end if;

  -- The materials check takes what was really used (58), and the reservation ends.
  select l.key into key from private.job_check_lines(shop, (select metadata from public.jobs where id = job)) l limit 1;
  perform public.apply_job_check_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.materials_checked', 'data', jsonb_build_object(
    'id', job, 'baseVersion', (select version from public.jobs where id = job), 'mode', 'confirm', 'modifiedBy', me, 'modifiedAt', now(),
    'usages', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'line', key, 'materialId', mat, 'quantity', 58)),
    'stockIds', jsonb_build_object(mat::text, gen_random_uuid()))));
  if (select available from public.materials where id = mat) <> -48 then raise exception 'Check took %', 10 - (select available from public.materials where id = mat); end if;
  if private.material_reserved(shop, mat) <> 0 then raise exception 'Still reserved after the check'; end if;

  -- Stock below zero blocked: what is free (stock less reserved) must cover a sale in production.
  update public.business_settings set settings = jsonb_set(settings, '{jobs}', coalesce(settings->'jobs', '{}'::jsonb) || '{"stockBelowZero":"block"}') where shop_id = shop;
  refused := '';
  begin perform private.check_reserve(shop, mat, 1, null); exception when others then refused := sqlerrm; end;
  if refused not like 'Not enough Paper%reserved%' then raise exception 'Reserve check: %', refused; end if;
  update public.business_settings set settings = jsonb_set(settings, '{jobs}', settings->'jobs' || '{"stockBelowZero":"allow"}') where shop_id = shop;

  -- Shelves: an Admin sets where a material is kept.
  perform public.apply_stock_count_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'count.shelf_set', 'data',
    jsonb_build_object('id', mat, 'shelf', 'Rack A', 'modifiedBy', me)));

  -- A count: 5 counted a minute ago, then 3 added. Finishing sets 8 (5 + what moved since).
  update public.material_stock_changes set created_at = now() - interval '1 hour' where shop_id = shop;
  perform public.apply_stock_count_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'count.saved', 'data', jsonb_build_object(
    'id', cnt, 'baseVersion', 0, 'name', 'Month-end', 'scope', jsonb_build_object('kind', 'shelf', 'shelves', jsonb_build_array('Rack A')),
    'lines', jsonb_build_array(jsonb_build_object('materialId', mat, 'counted', 5, 'countedAt', now() - interval '1 minute')), 'modifiedBy', me)));
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.stock_added', 'data', jsonb_build_object(
    'id', mat, 'quantity', 3, 'baseVersion', (select version from public.materials where id = mat), 'reason', 'Restocking', 'modifiedBy', me)));
  -- Big difference: a higher rank must finish it.
  update public.business_settings set settings = jsonb_set(settings, '{production}', settings->'production' || '{"stockCount":{"approveRank":5}}') where shop_id = shop;
  refused := '';
  begin
    perform public.apply_stock_count_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'count.finished', 'data', jsonb_build_object(
      'id', cnt, 'baseVersion', 1, 'stockIds', jsonb_build_object(mat::text, gen_random_uuid()), 'modifiedBy', me)));
  exception when others then refused := sqlerrm; end;
  if refused not like 'This count has big differences%' then raise exception 'Big difference: %', refused; end if;
  update public.business_settings set settings = jsonb_set(settings, '{production}', settings->'production' || '{"stockCount":{"approveRank":2}}') where shop_id = shop;
  perform public.apply_stock_count_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'count.finished', 'data', jsonb_build_object(
    'id', cnt, 'baseVersion', 1, 'stockIds', jsonb_build_object(mat::text, gen_random_uuid()), 'modifiedBy', me)));
  if (select available from public.materials where id = mat) <> 8 then raise exception 'Count set %', (select available from public.materials where id = mat); end if;
  select data into r from public.stock_records where shop_id = shop and collection = 'stockCounts' and id = cnt;
  if r->>'status' <> 'finished' or (r->'lines'->0->>'expected')::numeric <> -48 or (r->'lines'->0->>'difference')::numeric <> 53
     or (r->'lines'->0->>'setTo')::numeric <> 8 or not (r->>'flagged')::boolean then raise exception 'Count record %', r; end if;
  if not exists (select 1 from public.material_stock_changes where shop_id = shop and material_id = mat and action = 'material.stock_set' and reason = 'Stock count: Month-end') then
    raise exception 'No stock count change recorded'; end if;
  -- A finished count cannot change.
  refused := '';
  begin
    perform public.apply_stock_count_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'count.cancelled', 'data', jsonb_build_object('id', cnt, 'baseVersion', 2, 'modifiedBy', me)));
  exception when others then refused := sqlerrm; end;
  if refused not like 'This count is already finished%' then raise exception 'Finished count changed: %', refused; end if;

  -- The download has the count and the shelf.
  led := public.get_ledger(shop);
  if jsonb_array_length(led->'stockCounts') <> 1 or led->'materialShelves'->0->>'shelf' <> 'Rack A' then raise exception 'Download %', led->'materialShelves'; end if;
  if jsonb_array_length(public.get_ledger_changes(shop, null)->'ledger'->'stockCounts') <> 1 then raise exception 'Changes miss counts'; end if;
end $test$;
rollback;
