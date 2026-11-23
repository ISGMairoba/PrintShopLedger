-- Rollback-only fixture. Correcting confirmed materials: who saves at once, who asks, whose entry
-- needs a higher approver, the Manager alert, stock counted since, the window, and the audit.
begin;
create function pg_temp.fix(p_kind text, p_job uuid, p_data jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'kind', p_kind, 'data', jsonb_build_object('id', p_job,
    'baseVersion', (select version from public.jobs where id = p_job), 'modifiedBy', current_setting('request.jwt.claim.sub')::uuid,
    'modifiedByLabel', 'Tester', 'modifiedAt', now()) || p_data)
$$;
create function pg_temp.use(p_m uuid, p_qty numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'line', 'm:' || p_m, 'materialId', p_m, 'quantity', p_qty))
$$;
do $test$
declare
  owner uuid := gen_random_uuid(); cashier uuid := gen_random_uuid(); admin uuid := gen_random_uuid(); manager uuid := gen_random_uuid();
  shop uuid; cust uuid := gen_random_uuid(); j uuid := gen_random_uuid(); m1 uuid := gen_random_uuid();
  req uuid; refused text; mc jsonb; ev jsonb;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'mc-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Material corrections');
  perform test.add_member(shop, cashier, 'cashier');
  perform test.add_member(shop, admin, 'admin');
  perform test.add_member(shop, manager, 'manager');
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.created', 'data',
    jsonb_build_object('id', m1, 'name', 'Paper', 'available', 100, 'measurementUnit', 'sheet', 'requireSize', false, 'modifiedBy', owner)));
  insert into public.customers(shop_id, id, name, created_at) values (shop, cust, 'Bola', now());
  insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, production_status, metadata)
  values (shop, j, cust, 'Flyers', '10 flyers', 50000, now() - interval '1 day', 'Printing',
    jsonb_build_object('checkMaterials', true, 'materialId', m1, 'materialNeeded', 10, 'measurementUnit', 'sheet'));

  -- Confirmed by an Admin: 10 sheets taken.
  perform set_config('request.jwt.claim.sub', admin::text, true);
  set local role authenticated;
  perform public.apply_job_check_event(shop, pg_temp.fix('job.materials_checked', j, jsonb_build_object('mode', 'confirm',
    'usages', pg_temp.use(m1, 10), 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  reset role;
  if (select available from public.materials where id = m1) <> 90 then raise exception 'Check did not take stock'; end if;

  -- Confirmed materials are not re-confirmed.
  refused := '';
  set local role authenticated;
  begin
    perform public.apply_job_check_event(shop, pg_temp.fix('job.materials_checked', j, jsonb_build_object('mode', 'confirm',
      'usages', pg_temp.use(m1, 11), 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'These materials are confirmed%' then raise exception 'Re-confirmed: %', refused; end if;

  -- A cashier asks (no reason refused; claiming to save directly refused); stock waits.
  perform set_config('request.jwt.claim.sub', cashier::text, true);
  set local role authenticated;
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
      'requestId', gen_random_uuid(), 'route', 'request', 'reason', 'x', 'usages', pg_temp.use(m1, 12))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Give a reason%' then raise exception 'No reason: %', refused; end if;
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
      'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'Two spoiled', 'usages', pg_temp.use(m1, 12))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'This correction now goes another way (request)%' then raise exception 'Cashier direct: %', refused; end if;
  req := gen_random_uuid();
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', req, 'route', 'request', 'reason', 'Two spoiled', 'usages', pg_temp.use(m1, 12))));
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.material_correction_decided', j, jsonb_build_object(
      'requestId', req, 'approve', true, 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'This correction needs%' then raise exception 'Cashier approved own: %', refused; end if;
  reset role;
  if (select available from public.materials where id = m1) <> 90 then raise exception 'Request moved stock'; end if;
  if (select metadata->'materialCorrection'->>'approverRank' from public.jobs where id = j) <> '2' then raise exception 'Approver rank'; end if;

  -- An Admin approves: 2 more taken, dated now, linked to the job; the request is gone, the audit kept.
  perform set_config('request.jwt.claim.sub', admin::text, true);
  set local role authenticated;
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.material_correction_decided', j, jsonb_build_object(
    'requestId', req, 'approve', true, 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  reset role;
  select metadata->'materialCheck' into mc from public.jobs where id = j;
  if (select available from public.materials where id = m1) <> 88 or (select metadata ? 'materialCorrection' from public.jobs where id = j)
     or mc->>'recordedBy' <> cashier::text or (mc->'usages'->0->>'quantity')::numeric <> 12
     or jsonb_array_length(mc->'corrections') <> 1 or mc->'corrections'->0->>'approvedBy' <> admin::text then
    raise exception 'Approval not applied: %', mc; end if;
  if not exists (select 1 from public.material_stock_changes where shop_id = shop and job_id = j and material_id = m1
      and action = 'material.job_used' and before_available - after_available = 2) then raise exception 'No stock change for the correction'; end if;

  -- An Admin corrects a cashier's entry directly: 1 fewer, given back. No change at all is refused.
  set local role authenticated;
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
      'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'Same again', 'usages', pg_temp.use(m1, 12))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Change at least one%' then raise exception 'No change: %', refused; end if;
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'Counted again', 'usages', pg_temp.use(m1, 11),
    'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  reset role;
  if (select available from public.materials where id = m1) <> 89 then raise exception 'Direct correction'; end if;

  -- The owner (General Manager) corrects: now the owner's entry.
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'Owner checked', 'usages', pg_temp.use(m1, 13),
    'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  -- A Manager corrects the owner's entry: it goes through, and the owner is told.
  perform set_config('request.jwt.claim.sub', manager::text, true);
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', gen_random_uuid(), 'route', 'alert', 'reason', 'Recount', 'usages', pg_temp.use(m1, 12),
    'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  reset role;
  select metadata->'materialCheck' into mc from public.jobs where id = j;
  if (select available from public.materials where id = m1) <> 88 or mc->'corrections'->-1->>'alertFor' <> owner::text
     or not (mc->'corrections'->-1->>'alert')::boolean then raise exception 'Manager alert: %', mc; end if;

  -- An Admin correcting the Manager's entry asks a Manager or above; the owner declines it.
  perform set_config('request.jwt.claim.sub', admin::text, true);
  set local role authenticated;
  req := gen_random_uuid();
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', req, 'route', 'request', 'reason', 'Looks high', 'usages', pg_temp.use(m1, 10))));
  if (select metadata->'materialCorrection'->>'approverRank' from public.jobs where id = j) <> '3' then raise exception 'Higher approver'; end if;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.material_correction_decided', j, jsonb_build_object(
    'requestId', req, 'approve', false, 'note', 'It was 12')));
  reset role;
  select metadata->'materialCheck' into mc from public.jobs where id = j;
  if (select available from public.materials where id = m1) <> 88 or mc->'corrections'->-1->>'status' <> 'declined'
     or (select metadata ? 'materialCorrection' from public.jobs where id = j) then raise exception 'Decline: %', mc; end if;

  -- Stock counted since: even the owner asks, and someone else approves.
  update public.jobs set metadata = jsonb_set(metadata, '{materialCheck,correctedAt}', to_jsonb(now() - interval '1 hour')) where id = j;
  perform public.apply_material_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'material.stock_set', 'data',
    jsonb_build_object('id', m1, 'baseVersion', (select version from public.materials where id = m1), 'quantity', 85,
      'reason', 'Physical count', 'modifiedBy', owner)));
  set local role authenticated;
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
      'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'After count', 'usages', pg_temp.use(m1, 14),
      'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'This correction now goes another way (request)%' then raise exception 'Counted direct: %', refused; end if;
  req := gen_random_uuid();
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
    'requestId', req, 'route', 'request', 'reason', 'After count', 'usages', pg_temp.use(m1, 14))));
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.material_correction_decided', j, jsonb_build_object(
      'requestId', req, 'approve', true, 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  if refused not like 'Someone else decides%' then raise exception 'Owner approved own: %', refused; end if;
  perform set_config('request.jwt.claim.sub', manager::text, true);
  perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.material_correction_decided', j, jsonb_build_object(
    'requestId', req, 'approve', true, 'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  reset role;
  select metadata->'materialCheck' into mc from public.jobs where id = j;
  if (select available from public.materials where id = m1) <> 83 or not (mc->'corrections'->-1->>'counted')::boolean then
    raise exception 'Counted approval: %', mc; end if;

  -- The window: 7 days after collection.
  update public.jobs set production_status = 'Collected', metadata = metadata || jsonb_build_object('stageAt', now() - interval '8 days')
    where id = j;
  set local role authenticated;
  refused := '';
  begin
    perform public.apply_job_material_correction_event(shop, pg_temp.fix('job.materials_corrected', j, jsonb_build_object(
      'requestId', gen_random_uuid(), 'route', 'direct', 'reason', 'Too late', 'usages', pg_temp.use(m1, 15),
      'stockIds', jsonb_build_object(m1, gen_random_uuid()))));
  exception when others then refused := sqlerrm;
  end;
  reset role;
  if refused not like 'Materials can be corrected up to 7 days%' then raise exception 'Window: %', refused; end if;
  raise notice 'Material corrections passed';
end $test$;
rollback;
