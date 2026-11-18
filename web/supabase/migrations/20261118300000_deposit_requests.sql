-- Requests to correct a deposit with no job: anyone the business does not allow to correct one
-- (Business Settings → Corrections) sends a request; someone it allows approves it (the approval
-- applies the correction as that person, so private.correct_deposit checks their rank). Cashiers
-- request only for deposits they took. One request waits per payment at a time.
alter table public.correction_requests alter column job_id drop not null;

create or replace function private.submit_deposit_request(p_shop uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare u uuid := auth.uid(); lvl integer; label text; d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid;
  reason text := btrim(d->>'reason'); cust uuid; p public.payments%rowtype; taker text;
begin
  select access_level, name into lvl, label from public.shop_members where shop_id = p_shop and user_id = u and not archived for share;
  if not found then raise exception 'Only active staff can request a correction'; end if;
  if coalesce(d->>'customerId', '') !~* '^[0-9a-f-]{36}$' or coalesce(d->>'paymentId', '') !~* '^[0-9a-f-]{36}$' then
    raise exception 'Choose a payment for this customer';
  end if;
  cust := (d->>'customerId')::uuid;
  select * into p from public.payments where shop_id = p_shop and id = (d->>'paymentId')::uuid and customer_id = cust for share;
  if not found then raise exception 'Choose a payment for this customer'; end if;
  if exists (select 1 from public.jobs where shop_id = p_shop and customer_id = cust) then
    raise exception 'This customer has jobs now. Sync and reopen the correction.' using errcode = 'PT409';
  end if;
  select data->>'createdBy' into taker from public.checkout_records where shop_id = p_shop and id = coalesce(p.checkout_id, p.id);
  if lvl < 2 and taker is distinct from u::text then raise exception 'You can request corrections only for deposits you took'; end if;
  if exists (select 1 from public.correction_requests where shop_id = p_shop and id = e) or exists (select 1 from public.ledger_events where shop_id = p_shop and id = e) then
    if exists (select 1 from public.correction_requests where shop_id = p_shop and id = e and event = p_event and requested_by = u) then
      return private.correction_request_list(p_shop, lvl >= 2);
    end if;
    raise exception 'Request ID is already used';
  end if;
  if exists (select 1 from public.correction_requests where shop_id = p_shop and status = 'pending' and kind = 'payment.corrected'
             and job_id is null and event->'data'->>'paymentId' = p.id::text) then
    raise exception 'A correction for this deposit is already waiting for approval';
  end if;
  insert into public.correction_requests (shop_id, id, job_id, kind, event, reason, requested_by, requested_by_label)
  values (p_shop, e, null, 'payment.corrected', p_event, reason, u, coalesce(label, ''));
  return private.correction_request_list(p_shop, lvl >= 2);
end $f$;
revoke all on function private.submit_deposit_request(uuid, jsonb) from public, anon, authenticated;

-- submit_correction_request: a payment correction with no job is a deposit request.
do $m$
declare d text := pg_get_functiondef('public.submit_correction_request(uuid,jsonb)'::regprocedure);
  t text := $x$if (d->>'jobId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Job not found';end if;$x$;
begin
  if position('private.submit_deposit_request' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'submit_correction_request: job check not found'; end if;
  execute replace(d, t, $x$if k='payment.corrected' and coalesce(d->>'jobId','')='' then return private.submit_deposit_request(p_shop,p_event);end if;
 $x$ || t);
end $m$;
