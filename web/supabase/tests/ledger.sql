-- Run as postgres in a disposable Supabase database. Everything rolls back.
begin;
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001', 'printshopledger-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002', 'printshopledger-b@example.invalid');
insert into public.shops(id, name) values
 ('20000000-0000-4000-8000-000000000001', 'Business A'),
 ('20000000-0000-4000-8000-000000000002', 'Business B');
insert into public.shop_members(shop_id, user_id, role) values
 ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'admin'),
 ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'admin');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$
declare
  s uuid := '20000000-0000-4000-8000-000000000001';
  c uuid := '30000000-0000-4000-8000-000000000001';
  j uuid := '40000000-0000-4000-8000-000000000001';
  p jsonb;
  rejected boolean;
begin
  if (select count(*) from public.shops) <> 1 then raise exception 'FAIL: cross-business read'; end if;
  perform public.apply_ledger_event(s, jsonb_build_object('id', gen_random_uuid(), 'kind', 'customer.created', 'data',
    jsonb_build_object('id', c, 'name', 'Customer A', 'phone', '', 'createdAt', now())));
  perform public.apply_ledger_event(s, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.created', 'data',
    jsonb_build_object('id', j, 'customerId', c, 'service', 'Banner', 'description', 'Test job', 'amount', 2000000, 'createdAt', now())));
  p := jsonb_build_object('id', gen_random_uuid(), 'kind', 'payment.recorded', 'data', jsonb_build_object(
    'id', gen_random_uuid(), 'customerId', c, 'amount', 1500000, 'method', 'Cash', 'paidOn', '2026-10-03',
    'createdAt', now(), 'allocations', jsonb_build_array(jsonb_build_object('jobId', j, 'amount', 1500000))));
  perform public.apply_ledger_event(s, p);
  perform public.apply_ledger_event(s, p);
  if (select count(*) from public.payments) <> 1 then raise exception 'FAIL: duplicate retry'; end if;
  if (select sum(amount) from public.payment_allocations) <> 1500000 then raise exception 'FAIL: allocation'; end if;

  rejected := false;
  begin
    perform public.apply_ledger_event(s, jsonb_build_object('id', gen_random_uuid(), 'kind', 'payment.recorded', 'data', jsonb_build_object(
      'id', gen_random_uuid(), 'customerId', c, 'amount', 600000, 'method', 'Cash', 'paidOn', '2026-10-03',
      'createdAt', now(), 'allocations', jsonb_build_array(jsonb_build_object('jobId', j, 'amount', 600000)))));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: overpayment accepted'; end if;
  if (select count(*) from public.payments) <> 1 then raise exception 'FAIL: partial save on rejected payment'; end if;

  rejected := false;
  begin
    perform public.apply_ledger_event(s, jsonb_build_object('id', gen_random_uuid(), 'kind', 'payment.recorded', 'data', jsonb_build_object(
      'id', gen_random_uuid(), 'customerId', c, 'amount', 100000, 'method', 'Cash', 'paidOn', '2026-10-03',
      'createdAt', now(), 'allocations', jsonb_build_array(jsonb_build_object('jobId', j, 'amount', 50000)))));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: allocation mismatch accepted'; end if;
  if (select count(*) from public.payments) <> 1 then raise exception 'FAIL: partial save on mismatch'; end if;

  rejected := false;
  begin
    perform public.get_ledger('20000000-0000-4000-8000-000000000002');
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: cross-business RPC read'; end if;
  if has_table_privilege('authenticated', 'public.payments', 'INSERT') then raise exception 'FAIL: direct payment write allowed'; end if;
  if has_table_privilege('authenticated', 'public.shop_members', 'UPDATE') then raise exception 'FAIL: role elevation allowed'; end if;
  if has_function_privilege('anon', 'public.apply_ledger_event(uuid,jsonb)', 'EXECUTE') then raise exception 'FAIL: anonymous write allowed'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$
declare rejected boolean := false;
begin
  if (select count(*) from public.jobs) <> 0 then raise exception 'FAIL: Business B can see Business A jobs'; end if;
  begin
    perform public.apply_ledger_event('20000000-0000-4000-8000-000000000001', jsonb_build_object(
      'id', gen_random_uuid(), 'kind', 'customer.created', 'data', jsonb_build_object('id', gen_random_uuid(), 'name', 'Intruder', 'createdAt', now())));
  exception when others then rejected := true;
  end;
  if not rejected then raise exception 'FAIL: cross-business write accepted'; end if;
end;
$$;
rollback;
