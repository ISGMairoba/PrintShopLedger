-- Rollback-only fixture. AUD-26: a console payment sent twice with one intent id is recorded once.
-- SEC-01: quotations and reminders are read only for signed-in users and closed to anon.
begin;
do $test$
declare owner uuid := gen_random_uuid(); dev uuid := gen_random_uuid(); shop uuid; a jsonb; b jsonb; c jsonb; intent uuid := gen_random_uuid();
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'hk-owner@example.invalid', now(), '{}', now()), (dev, 'hk-console@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  shop := test.new_shop('Housekeeping');
  insert into private.console_members(user_id, name, role) values (dev, 'Console', 'owner');
  perform set_config('request.jwt.claim.sub', dev::text, true);
  set local role authenticated;
  a := public.console_record_payment(shop, jsonb_build_object('amount', 500000, 'paidOn', current_date, 'method', 'Transfer',
    'reference', 'T1', 'note', '', 'intentId', intent));
  b := public.console_record_payment(shop, jsonb_build_object('amount', 500000, 'paidOn', current_date, 'method', 'Transfer',
    'reference', 'T1', 'note', '', 'intentId', intent));
  c := public.console_record_payment(shop, jsonb_build_object('amount', 500000, 'paidOn', current_date, 'method', 'Transfer',
    'reference', 'T2', 'note', ''));
  reset role;
  if a->>'id' <> b->>'id' or not coalesce((b->>'repeated')::boolean, false) or c->>'id' = a->>'id' then
    raise exception 'Retry recorded twice: % % %', a, b, c;
  end if;
  if (select count(*) from public.subscription_payments where shop_id = shop) <> 2 then raise exception 'Payments: wrong count'; end if;
  if has_table_privilege('anon', 'public.quotations', 'select') or has_table_privilege('authenticated', 'public.quotations', 'insert')
     or has_table_privilege('authenticated', 'public.customer_reminders', 'truncate')
     or not has_table_privilege('authenticated', 'public.customer_reminders', 'select') then
    raise exception 'Grants on quotations and reminders not tidied';
  end if;
  raise notice 'Housekeeping passed';
end $test$;
rollback;
