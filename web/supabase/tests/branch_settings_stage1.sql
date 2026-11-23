-- Rollback-only fixture. AUD-10 stage 1: a branch's own "stock below zero" rule applies to its stock;
-- the main branch keeps the business-wide rule.
begin;
do $test$
declare owner uuid := gen_random_uuid(); shop uuid; mat uuid := gen_random_uuid(); refused text := '';
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'aud10-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  shop := test.new_shop('Branch rules');
  set local session_replication_role = replica;
  insert into public.business_settings(shop_id, modified_by, settings) values (shop, owner, jsonb_build_object(
    'jobs', jsonb_build_object('stockBelowZero', 'allow'),
    'branches', jsonb_build_array(jsonb_build_object('id', 'main', 'name', 'Main'),
      jsonb_build_object('id', 'b-ikeja01', 'name', 'Ikeja'),
      jsonb_build_object('id', 'b-store01', 'name', 'Store', 'kind', 'store')),
    'branchSettings', jsonb_build_object('b-ikeja01', jsonb_build_object('jobs', jsonb_build_object('jobs',
      jsonb_build_object('stockBelowZero', 'block'))))))
  on conflict (shop_id) do update set settings = public.business_settings.settings || excluded.settings;
  insert into public.materials(id, shop_id, name, measurement_unit, available, created_by, created_by_label, modified_by, modified_by_label, last_event_id)
  values (mat, shop, 'Paper', 'sheet', 100, owner, 'Owner', owner, 'Owner', gen_random_uuid());
  insert into public.location_stock(shop_id, location_id, material_id, available) values (shop, 'b-ikeja01', mat, 7);
  set local session_replication_role = origin;
  set local role authenticated;
  -- Ikeja blocks going below zero: sending 10 of its 7 is refused.
  begin
    perform public.transfer_stock(p_shop => shop, p_material => mat, p_from => 'b-ikeja01', p_to => 'b-store01', p_quantity => 10);
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Not enough Paper%' then raise exception 'Branch rule not applied: %', refused; end if;
  -- Main allows it (the business-wide rule): sending 150 of 100 goes through.
  perform public.transfer_stock(p_shop => shop, p_material => mat, p_from => 'main', p_to => 'b-store01', p_quantity => 150);
  reset role;
  if (select available from public.materials where id = mat) <> -50 then raise exception 'Main transfer not applied'; end if;
  raise notice 'Branch settings stage 1 passed';
end $test$;
rollback;
