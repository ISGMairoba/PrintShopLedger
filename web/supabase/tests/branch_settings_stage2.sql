-- Rollback-only fixture. AUD-10 stage 2: the overnight drawer closing follows each branch's own setting;
-- template prices and the handover rule read the branch's settings.
begin;
do $test$
declare owner uuid := gen_random_uuid(); shop uuid; cust uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  cfg jsonb; closed int;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'branch-stage2-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Branch stage 2');
  cfg := $cfg${"businessName": "Team work", "address": "", "phones": "", "email": "", "website": "", "socials": "", "logo": "", "primary": "#124b40", "accent": "#d9a126", "theme": "system", "options": {"paymentMethods": [{"label": "Cash", "kind": "Cash", "enabled": true}], "expenseCategories": ["Materials", "Other"], "jobSources": ["In shop / USB", "Other"], "stockReasons": ["Restocking", "Stock Count Correction", "Returned Stock", "Damaged Stock"], "materialUnits": ["sheet"], "jobStages": ["Added", "In Queue", "Printing", "Completed", "Collected"]}, "corrections": {"recentDays": 14}, "pageAccess": {"1": ["Point of Service", "My Sales", "Jobs", "Print Settings", "My Account"], "2": ["Dashboard", "Point of Service", "My Sales", "Jobs", "Customers", "Payments", "Users", "My Account"]}, "receipt": {"showLogo": true, "showAddress": true, "showContacts": true, "footer": "Thanks"}}$cfg$::jsonb || '{"branches": [{"id": "b-wuse001", "name": "Wuse"}], "branchSettings": {"b-wuse001": {"jobs": {"drawers": {"autoClose": false}}}}}';
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, cfg)
    on conflict (shop_id) do update set settings = excluded.settings;
  insert into public.customers(shop_id, id, name, created_at) values (shop, cust, 'Bola', now());
  -- Yesterday's sales: one at main, one at Wuse (which keeps its drawers open overnight).
  insert into public.checkout_records(shop_id, id, customer_id, data, branch_id) values
    (shop, c1, cust, jsonb_build_object('id', c1, 'createdBy', owner, 'createdAt', now() - interval '1 day', 'cashReceived', 0, 'method', 'Cash', 'total', 1000), null),
    (shop, c2, cust, jsonb_build_object('id', c2, 'createdBy', owner, 'createdAt', now() - interval '1 day', 'cashReceived', 0, 'method', 'Cash', 'total', 2000), 'b-wuse001');
  closed := private.auto_close_drawers(now() + interval '1 day');
  if (select drawer_closing_id from public.checkout_records where id = c1) is null then raise exception 'Main drawer not closed'; end if;
  if (select drawer_closing_id from public.checkout_records where id = c2) is not null then raise exception 'Wuse drawer closed against its own setting'; end if;
  if closed <> 1 then raise exception 'Closed % drawers', closed; end if;
  -- Template prices and the handover rule read the branch's settings.
  if position('branch_settings' in pg_get_functiondef('private.price_template_snapshot(uuid,jsonb,numeric,boolean)'::regprocedure)) = 0 then
    raise exception 'Template prices still read business-wide settings'; end if;
  if position('branch_settings' in pg_get_functiondef('private.apply_job_handover_event_core(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'The handover rule still reads business-wide settings'; end if;
end $test$;
rollback;
