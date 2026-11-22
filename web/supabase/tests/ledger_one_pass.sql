-- Rollback-only fixture. NEW-02: the one-pass download, with branches.
-- Builds a business with two branches and a store, records in every downloaded table (some at each
-- branch), and checks what the owner and a branch cashier receive. sql-tests.mjs then compares the
-- download with the old layered one for every member and branch (test.ledger_same).
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); shop uuid;
  svc uuid := gen_random_uuid(); mat uuid := gen_random_uuid();
  c_main uuid := gen_random_uuid(); c_b2 uuid := gen_random_uuid(); c_linked uuid := gen_random_uuid(); c_served uuid := gen_random_uuid();
  j_main uuid := gen_random_uuid(); j_b2 uuid := gen_random_uuid(); j_served uuid := gen_random_uuid();
  p_main uuid := gen_random_uuid(); p_b2 uuid := gen_random_uuid(); p_ref uuid := '00000000-0000-4000-8000-000000000001'; -- sorts first by id, last by time
  acc_main uuid := gen_random_uuid(); acc_b2 uuid := gen_random_uuid();
  owner2 uuid := gen_random_uuid(); shop2 uuid; c2 uuid := gen_random_uuid();
  led jsonb; t timestamptz := '2026-11-01 10:00:00.5+00';
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'one-pass-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('One pass');
  perform test.add_member(shop, cashier, 'cashier');


  -- Records written directly (triggers off): this fixture tests reading, not saving.
  set local session_replication_role = replica;
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, jsonb_build_object(
    'branches', jsonb_build_array(jsonb_build_object('id', 'main', 'name', 'Main'),
      jsonb_build_object('id', 'b-ikeja01', 'name', 'Ikeja', 'customers', 'own', 'prices', 'own'),
      jsonb_build_object('id', 'b-store01', 'name', 'Store', 'kind', 'store')),
    'branchAccess', jsonb_build_object(cashier::text, jsonb_build_array('b-ikeja01'))))
  on conflict (shop_id) do update set settings = public.business_settings.settings || excluded.settings;
  insert into public.services(id, shop_id, description, price, created_by, created_by_label, modified_by, modified_by_label, last_event_id,
      icon, category, code, tags, sold_at, min_quantity)
  values (svc, shop, 'Flyers', 5000, owner, 'Owner', owner, 'Owner', gen_random_uuid(), 'print', 'Paper', 'FL1', '["a"]', '["b-ikeja01"]', 10);
  insert into public.branch_prices(shop_id, branch_id, service_id, price) values (shop, 'b-ikeja01', svc, 6500);
  insert into public.materials(id, shop_id, name, measurement_unit, available, created_by, created_by_label, modified_by, modified_by_label, last_event_id)
  values (mat, shop, 'Paper', 'sheet', 100, owner, 'Owner', owner, 'Owner', gen_random_uuid());
  insert into public.location_stock(shop_id, location_id, material_id, available) values (shop, 'b-ikeja01', mat, 7), (shop, 'b-store01', mat, 40);
  insert into public.stock_requests(id, shop_id, material_id, from_location, to_location, quantity, status, requested_at)
  values (gen_random_uuid(), shop, mat, 'b-store01', 'b-ikeja01', 5, 'pending', now());

  insert into public.customers(id, shop_id, name, created_at, branch_id, linked_branches, called_as) values
    (c_main, shop, 'Main customer', t, null, '{}', 'Mr M'),
    (c_b2, shop, 'Ikeja customer', t + interval '1 s', 'b-ikeja01', '{}', ''),
    (c_linked, shop, 'Linked customer', t + interval '2 s', null, array['b-ikeja01'], ''),
    (c_served, shop, 'Served at Ikeja', t + interval '3 s', null, '{}', '');
  insert into public.jobs(id, shop_id, customer_id, service, description, amount, created_at, branch_id, metadata) values
    (j_main, shop, c_main, 'Flyers', 'Main job', 1000, t, null, '{"stage":"Added"}'),
    (j_b2, shop, c_b2, 'Flyers', 'Ikeja job', 2000, t, 'b-ikeja01', '{"branchId":"stale"}'),
    (j_served, shop, c_served, 'Flyers', 'Served job', 3000, t + interval '1 s', 'b-ikeja01', '{}');
  -- Same created_at, so the order falls back to the id text.
  insert into public.payments(id, shop_id, customer_id, amount, method, paid_on, created_at, branch_id, method_label) values
    (p_main, shop, c_main, 1000, 'Cash', '2026-11-01', t, null, null),
    (p_b2, shop, c_b2, 2000, 'POS', '2026-11-01', t, 'b-ikeja01', 'Bank — POS'),
    (p_ref, shop, c_b2, 500, 'Cash', '2026-11-02', t + interval '2 s', 'b-ikeja01', null);
  insert into public.payment_allocations(shop_id, payment_id, job_id, amount) values (shop, p_main, j_main, 1000), (shop, p_b2, j_b2, 2000);
  insert into public.checkout_records(shop_id, id, customer_id, data, created_at, branch_id) values
    (shop, p_main, c_main, jsonb_build_object('id', p_main, 'methodLabel', 'Till'), t, null),
    (shop, p_b2, c_b2, jsonb_build_object('id', p_b2), t, 'b-ikeja01');
  insert into public.sale_adjustments(shop_id, id, actor_id, data, created_at, branch_id) values
    (shop, p_ref, owner, jsonb_build_object('id', p_ref, 'action', 'sale.refunded', 'methodLabel', 'Cash drawer'), t + interval '2 s', 'b-ikeja01');
  insert into public.material_stock_changes(id, shop_id, material_id, action, after_available, actor_id, actor_label, created_at, branch_id, job_id)
  values (gen_random_uuid(), shop, mat, 'material.stock_added', 100, owner, 'Owner', t, null, null),
         (gen_random_uuid(), shop, mat, 'material.job_used', 7, owner, 'Owner', t + interval '1 s', 'b-ikeja01', j_b2);
  insert into public.expenses(id, shop_id, data, branch_id)
  select e, shop, jsonb_build_object('id', e, 'incurredOn', d, 'amount', a), b
  from (values (gen_random_uuid(), '2026-11-01', 100, null), (gen_random_uuid(), '2026-11-02', 200, 'b-ikeja01')) x(e, d, a, b);
  insert into public.quotations(id, shop_id, data, branch_id)
  select q, shop, jsonb_build_object('id', q, 'createdAt', '2026-11-01', 'customerId', c_main), null from gen_random_uuid() q;
  insert into public.customer_reminders(id, shop_id, data, branch_id)
  select r, shop, jsonb_build_object('id', r, 'remindedAt', '2026-11-03'), 'b-ikeja01' from gen_random_uuid() r;
  insert into public.business_operations_records(shop_id, collection, id, data) values
    (shop, 'moneyAccounts', acc_main, jsonb_build_object('id', acc_main, 'name', 'Main till', 'createdAt', '2026-11-01')),
    (shop, 'moneyAccounts', acc_b2, jsonb_build_object('id', acc_b2, 'name', 'Ikeja till', 'branch', 'b-ikeja01', 'createdAt', '2026-11-02')),
    (shop, 'accountEntries', gen_random_uuid(), jsonb_build_object('accountId', acc_b2, 'createdAt', '2026-11-03')),
    (shop, 'accountEntries', gen_random_uuid(), jsonb_build_object('accountId', acc_main, 'createdAt', '2026-11-04'));
  -- A business without branches: a record that still has a branch id is not tagged or filtered.
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner2, 'one-pass-single@example.invalid', now(), '{}', now());
  shop2 := test.new_shop('Single', owner2);
  insert into public.customers(id, shop_id, name, created_at, linked_branches, called_as) values (c2, shop2, 'Solo', t, '{}', '');
  insert into public.jobs(id, shop_id, customer_id, service, description, amount, created_at, branch_id, metadata)
  values (gen_random_uuid(), shop2, c2, 'Flyers', 'Solo job', 1000, t, 'b-ikeja01', '{}');
  set local session_replication_role = origin;

  -- The owner (General Manager) sees every branch, each record tagged with its branch.
  led := public.get_ledger(shop);
  if jsonb_array_length(led->'jobs') <> 3 or jsonb_array_length(led->'customers') <> 4 then raise exception 'Owner download incomplete: %', led->'jobs'; end if;
  if (select count(*) from jsonb_array_elements(led->'jobs') x where x->>'branchId' = 'b-ikeja01') <> 2 then raise exception 'Jobs not tagged with their branch: % %', (select row_to_json(x) from private.branch_view(shop) x), led->'jobs'; end if;
  if (select x->>'methodLabel' from jsonb_array_elements(led->'payments') x where x->>'id' = p_ref::text) <> 'Cash drawer'
     or (select x->>'refundId' from jsonb_array_elements(led->'payments') x where x->>'id' = p_ref::text) <> p_ref::text then
    raise exception 'Refund label lost: %', led->'payments';
  end if;
  if (select x->>'methodLabel' from jsonb_array_elements(led->'payments') x where x->>'id' = p_b2::text) <> 'Bank — POS' then raise exception 'Payment label lost'; end if;
  if led->'services'->0->>'minQuantity' <> '10' or led->'services'->0->>'code' <> 'FL1' then raise exception 'Service fields lost: %', led->'services'; end if;
  if not led ? 'locationStock' or (select count(*) from jsonb_array_elements(led->'moneyAccounts') x where x->>'name' like '% till') <> 2 then
    raise exception 'Branch extras missing: %', led->'moneyAccounts';
  end if;

  -- The Ikeja cashier sees Ikeja only: its own customers (and those it served), its prices and stock.
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  perform set_config('request.headers', '{"x-psl-branch":"b-ikeja01"}', true);
  led := public.get_ledger(shop);
  if (select count(*) from jsonb_array_elements(led->'jobs') x where x->>'branchId' is distinct from 'b-ikeja01') > 0
     or jsonb_array_length(led->'jobs') <> 2 then raise exception 'Cashier sees other branches'' jobs: %', led->'jobs'; end if;
  if (select string_agg(x->>'name', ',' order by x->>'name') from jsonb_array_elements(led->'customers') x)
     <> 'Ikeja customer,Linked customer,Served at Ikeja' then raise exception 'Own customers wrong: %', led->'customers'; end if;
  if led->'services'->0->>'price' <> '6500' or led->'services'->0->'base'->>'price' <> '5000' then raise exception 'Branch price not applied'; end if;
  if led->'materials'->0->>'available' <> '7' then raise exception 'Branch stock not applied: %', led->'materials'; end if;
  if (select string_agg(x->>'name', ',') from jsonb_array_elements(led->'moneyAccounts') x) <> 'Ikeja till'
     or jsonb_array_length(led->'accountEntries') <> 1 then raise exception 'Other branches'' money shown: %', led->'moneyAccounts'; end if;
  if jsonb_array_length(led->'expenses') <> 1 or jsonb_array_length(led->'checkouts') <> 1 then raise exception 'Branch filter missing'; end if;

  perform set_config('request.headers', '{}', true);
  perform set_config('request.jwt.claim.sub', owner2::text, true);
  led := public.get_ledger(shop2);
  if jsonb_array_length(led->'jobs') <> 1 or led->'jobs'->0 ? 'branchId' or led ? 'locationStock' then
    raise exception 'Single-branch download changed: %', led->'jobs';
  end if;

  raise notice 'One-pass download: owner and branch cashier views passed';
end $test$;
rollback;
