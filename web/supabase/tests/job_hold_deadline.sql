-- Rollback-only fixture. "Hold and extend deadline": resuming moves the due date by the time on hold.
begin;
do $test$
declare
  owner uuid := gen_random_uuid(); shop uuid; c uuid := gen_random_uuid();
  j uuid := gen_random_uuid(); k uuid := gen_random_uuid(); n uuid := gen_random_uuid();
  meta jsonb; v int;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data, created_at)
  values (owner, 'hold-owner@example.invalid', now(), '{}', now());
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  shop := test.new_shop('Hold deadline');
  insert into public.customers(id, shop_id, name, created_at, linked_branches, called_as) values (c, shop, 'Ada', now(), '{}', '');
  insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at, production_status, metadata) values
    (shop, j, c, 'Print', 'Extends', 1000, now(), 'Added', '{"dueAt":"2026-11-10T17:00:00.000Z"}'),
    (shop, k, c, 'Print', 'Plain hold', 1000, now(), 'Added', '{"dueAt":"2026-11-10T17:00:00.000Z"}'),
    (shop, n, c, 'Print', 'No deadline', 1000, now(), 'Added', '{}');

  set local role authenticated;
  -- Held, asking to extend (the third has no deadline, so nothing is kept to extend).
  perform public.apply_job_hold_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.held', 'data', jsonb_build_object(
    'id', j, 'baseVersion', 1, 'reason', 'Waiting for design approval', 'note', '', 'extendDeadline', true,
    'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  perform public.apply_job_hold_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.held', 'data', jsonb_build_object(
    'id', k, 'baseVersion', 1, 'reason', 'Waiting for materials', 'note', '',
    'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  perform public.apply_job_hold_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.held', 'data', jsonb_build_object(
    'id', n, 'baseVersion', 1, 'reason', 'Other', 'note', 'Ink', 'extendDeadline', true,
    'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  reset role;
  if (select metadata->'hold'->'extendDeadline' from public.jobs where id = j) is distinct from 'true'::jsonb then raise exception 'Extend not kept'; end if;
  if (select metadata->'hold' ? 'extendDeadline' from public.jobs where id = n) then raise exception 'Extend kept without a deadline'; end if;

  -- 27.5 hours on hold.
  update public.jobs set metadata = jsonb_set(metadata, '{hold,heldAt}', to_jsonb(now() - interval '27 hours 30 minutes')) where shop_id = shop;

  set local role authenticated;
  for v in 1..3 loop
    perform public.apply_job_hold_event(shop, jsonb_build_object('id', gen_random_uuid(), 'kind', 'job.resumed', 'data', jsonb_build_object(
      'id', (array[j, k, n])[v], 'baseVersion', 2, 'modifiedBy', owner, 'modifiedByLabel', 'Owner', 'modifiedAt', now())));
  end loop;
  reset role;

  select metadata into meta from public.jobs where id = j;
  if meta->>'dueAt' <> '2026-11-11T20:30:00.000Z' then raise exception 'Deadline not extended: %', meta->>'dueAt'; end if;
  if meta->'dueHistory'->-1->>'from' <> '2026-11-10T17:00:00.000Z' or meta->'dueHistory'->-1->>'to' <> '2026-11-11T20:30:00.000Z'
     or meta->'dueHistory'->-1->>'reason' not like 'On hold: Waiting for design approval%' then
    raise exception 'Due history wrong: %', meta->'dueHistory';
  end if;
  if (select metadata->>'dueAt' from public.jobs where id = k) <> '2026-11-10T17:00:00.000Z'
     or (select metadata ? 'dueHistory' from public.jobs where id = k) then raise exception 'Plain hold moved the deadline'; end if;
  if (select metadata ? 'dueAt' from public.jobs where id = n) then raise exception 'A deadline appeared'; end if;
  raise notice 'Hold and extend deadline passed';
end $test$;
rollback;
