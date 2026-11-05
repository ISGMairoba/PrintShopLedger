-- Expenses:
-- * An expense and each payment can carry the time it happened (incurredAt / paidAt, ISO). The day
--   (incurredOn / paidOn) stays and must be the same Lagos day. Saved without a time (older app
--   versions) the time is cleared.
-- * expense.payment_corrected: an Admin corrects a payment (amount, account and method, time,
--   reference) or removes one entered by mistake, with a reason. The payment keeps its corrections,
--   a removed one moves to removedPayments. The account guard re-checks the account and method.

create or replace function private.expense_time(p_value jsonb, p_day date, p_key text) returns jsonb
language plpgsql immutable set search_path to '' as $f$
declare t timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' or p_value = '""'::jsonb then return jsonb_build_object(p_key, null); end if;
  if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'Choose a valid time'; end if;
  begin t := (p_value #>> '{}')::timestamptz; exception when others then raise exception 'Choose a valid time'; end;
  if (t at time zone 'Africa/Lagos')::date <> p_day then raise exception 'The time must be on the chosen day'; end if;
  return jsonb_build_object(p_key, p_value);
end $f$;

create or replace function private.correct_expense_payment(p_payments jsonb, d jsonb, u uuid, label text) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare p jsonb; q jsonb := d->'payment'; c jsonb; reason text; paid numeric; day date; kept jsonb := '[]'; removed jsonb := '[]'; hit boolean := false;
begin
  if jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason')) not between 1 and 500 then raise exception 'Enter the reason for the correction (up to 500 characters)'; end if;
  reason := btrim(d->>'reason');
  for p in select value from jsonb_array_elements(coalesce(p_payments, '[]')) loop
    if p->>'id' is distinct from d->>'paymentId' then kept := kept || jsonb_build_array(p); continue; end if;
    hit := true;
    c := jsonb_build_object('reason', reason, 'correctedBy', u, 'correctedByLabel', label, 'correctedAt', now(), 'before', p - 'corrections');
    if coalesce((d->>'remove')::boolean, false) then
      removed := removed || jsonb_build_array(p || jsonb_build_object('corrections', coalesce(p->'corrections', '[]') || jsonb_build_array(c), 'removedAt', now()));
      continue;
    end if;
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'amount') is distinct from 'number' then raise exception 'Payment amount required'; end if;
    paid := (q->>'amount')::numeric;
    if paid <= 0 or paid > 100000000000 or paid <> trunc(paid) then raise exception 'Payment must be positive integer kobo'; end if;
    if coalesce(q->>'paidOn', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid payment date'; end if;
    day := (q->>'paidOn')::date;
    if coalesce(q->>'method', '') not in ('Cash','POS','Transfer','Other') or coalesce(q->>'source', '') not in ('Business cash','Business bank account','Personal funds','Other') then raise exception 'Choose payment method and source'; end if;
    if jsonb_typeof(q->'reference') is distinct from 'string' or length(q->>'reference') > 160 then raise exception 'Invalid payment reference'; end if;
    if q ? 'methodLabel' and (jsonb_typeof(q->'methodLabel') is distinct from 'string' or length(btrim(q->>'methodLabel')) not between 1 and 80 or q->>'methodLabel' ~ '[\x00-\x1f\x7f]') then raise exception 'Invalid payment method name'; end if;
    kept := kept || jsonb_build_array(p || jsonb_build_object('accountId', q->'accountId', 'methodLabel', coalesce(q->>'methodLabel', q->>'method'), 'amount', paid::bigint, 'paidOn', day,
      'method', q->>'method', 'source', q->>'source', 'reference', btrim(q->>'reference'), 'corrections', coalesce(p->'corrections', '[]') || jsonb_build_array(c))
      || private.expense_time(q->'paidAt', day, 'paidAt'));
  end loop;
  if not hit then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('payments', kept, 'removed', removed);
end $f$;
revoke all on function private.expense_time(jsonb, date, text), private.correct_expense_payment(jsonb, jsonb, uuid, text) from public, anon;

do $patch$
declare d text := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure); s text := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pats text[][] := array[
    array[$$'createdAt',coalesce(old->'createdAt',to_jsonb(now())))||audit;$$,
          $$'createdAt',coalesce(old->'createdAt',to_jsonb(now())))||audit||private.expense_time(d->'incurredAt',day,'incurredAt');$$],
    array[$$'createdByLabel',label,'createdAt',now());$$,
          $$'createdByLabel',label,'createdAt',now())||private.expense_time(p->'paidAt',day,'paidAt');$$],
    array[$$ else raise exception 'Unknown expense operation';end if;$$,
          $$ elsif k='expense.payment_corrected' then
  nxt:=old||audit||jsonb_build_object('version',(old->>'version')::integer+1);lines:=old_lines;
  child:=private.correct_expense_payment(payments,d,u,label);payments:=child->'payments';
  nxt:=nxt||jsonb_build_object('payments',payments,'removedPayments',coalesce(old->'removedPayments','[]'::jsonb)||(child->'removed'));child:=null;
 else raise exception 'Unknown expense operation';end if;$$]];
  i int;
begin
  for i in 1..array_length(pats, 1) loop
    if (length(d) - length(replace(d, pats[i][1], ''))) / length(pats[i][1]) <> 1 then raise exception 'apply_expense_event pattern % not found exactly once', i; end if;
    d := replace(d, pats[i][1], pats[i][2]);
  end loop;
  execute d;
  if (length(s) - length(replace(s, $$'expense.voided')$$, ''))) / length($$'expense.voided')$$) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(s, $$'expense.voided')$$, $$'expense.voided','expense.payment_corrected')$$);
end $patch$;

-- Quotations: quotation.deleted. The quotation stays on the server with status 'deleted' (so every
-- device learns of it on its next sync) and the app hides it. Only the person who made it or an Admin
-- may delete it; one that became an order cannot be deleted.
do $patch$
declare d text := pg_get_functiondef('public.apply_quotation_event(uuid,jsonb)'::regprocedure);
  pat text := $$  elsif k='quotation.converted' then$$;
begin
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_quotation_event pattern not found exactly once'; end if;
  execute replace(d, pat, $$  elsif k='quotation.deleted' then
    if old is null then raise exception 'Quotation not found'; end if;
    if old->>'status'='converted' then raise exception 'A quotation that became an order cannot be deleted'; end if;
    if (old->>'createdBy') is distinct from u::text and not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2) then
      raise exception 'Only an Admin or the person who made this quotation can delete it' using errcode='42501';
    end if;
    nxt := old || audit || jsonb_build_object('status','deleted','deletedAt',now(),'deletedByLabel',label,'version',(old->>'version')::integer+1);
$$ || pat);
end $patch$;
