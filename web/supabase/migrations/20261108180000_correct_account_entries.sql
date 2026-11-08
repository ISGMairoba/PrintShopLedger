-- Accounts: correct a mistaken transfer, reconciliation or money in / out entry in place (amount or
-- counted balance, date, note, accounts, lender), or cancel it (amount 0). The entry keeps every
-- earlier version with who changed it, when and why; the operation history keeps before and after.
-- The app applies the same rules (operations.mjs correctEntry).

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  pat := $re$else\s+raise exception 'Unknown operation';$re$;
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event end pattern not found'; end if;
  execute regexp_replace(d, pat, $$elsif k='account.entry_corrected' then
  select data into old from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and id=rid for update;
  if old is null or coalesce(old->>'action','') not in ('transfer','reconciliation','money') then raise exception 'Choose an entry to correct';end if;
  if coalesce((old->>'version')::integer,1) is distinct from (d->>'baseVersion')::integer then raise exception 'This entry changed elsewhere. Reopen it.' using errcode='PT409';end if;
  reason:=btrim(d->>'correctionReason');
  if reason is null or length(reason) not between 1 and 500 then raise exception 'Say why you are correcting it (up to 500 characters)';end if;
  nxt:=old;
  if d ? 'reason' then
   if jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason')) not between 1 and 500 then raise exception 'Enter a note up to 500 characters';end if;
   nxt:=nxt||jsonb_build_object('reason',btrim(d->>'reason'));
  end if;
  if old->>'action'='reconciliation' then
   actual:=case when d->>'cancel'='true' then (old->>'expectedBalance')::numeric else coalesce((d->>'actualBalance')::numeric,(old->>'actualBalance')::numeric) end;
   if actual is null or abs(actual)>100000000000 or actual<>trunc(actual) then raise exception 'Enter a valid counted balance';end if;
   nxt:=nxt||jsonb_build_object('actualBalance',actual::bigint,'amount',actual::bigint-(old->>'expectedBalance')::bigint);
  else
   on_day:=coalesce((d->>'paidOn')::date,(old->>'paidOn')::date);
   v:=case when d->>'cancel'='true' then 0 else coalesce((d->>'amount')::numeric,(old->>'amount')::numeric) end;
   if v is null or v<0 or v>100000000000 or v<>trunc(v) or (v=0 and d->>'cancel' is distinct from 'true') then raise exception 'Enter an amount greater than zero, or cancel the entry';end if;
   select data into a from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=coalesce(d->>'accountId',old->>'accountId')::uuid and not coalesce((data->>'archived')::boolean,false);
   if a is null or on_day<(a->>'openingDate')::date then raise exception 'Choose an active account opened by that date';end if;
   nxt:=nxt||jsonb_build_object('amount',v::bigint,'paidOn',on_day,'accountId',a->>'id');
   if old->>'action'='transfer' then
    select data into dest from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=coalesce(d->>'toAccountId',old->>'toAccountId')::uuid and not coalesce((data->>'archived')::boolean,false);
    if dest is null or dest->>'id'=a->>'id' or on_day<(dest->>'openingDate')::date then raise exception 'Choose a different active destination account opened by that date';end if;
    nxt:=nxt||jsonb_build_object('toAccountId',dest->>'id');
   elsif old ? 'lenderId' then
    select data into dest from public.business_operations_records where shop_id=p_shop and collection='payees' and id=coalesce(d->>'lenderId',old->>'lenderId')::uuid;
    if dest is null then raise exception 'Choose the lender';end if;
    nxt:=nxt||jsonb_build_object('lenderId',dest->>'id');
    -- No lender may end up repaid more than was lent.
    if exists(select 1 from unnest(array[old->>'lenderId',dest->>'id']) l
      where private.lender_owed(p_shop,l::uuid)
        - case when old->>'lenderId'=l then (case when old->>'moneyType'='loan_in' then 1 else -1 end)*(old->>'amount')::bigint else 0 end
        + case when dest->>'id'=l then (case when old->>'moneyType'='loan_in' then 1 else -1 end)*v::bigint else 0 end < 0) then
     raise exception 'A lender would be repaid more than was lent' using errcode='PT409';
    end if;
   end if;
  end if;
  nxt:=nxt||audit||jsonb_build_object('version',coalesce((old->>'version')::integer,1)+1,
   'corrections',coalesce(old->'corrections','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'before',jsonb_strip_nulls(jsonb_build_object('amount',old->'amount','paidOn',old->'paidOn','reason',old->'reason','accountId',old->'accountId','toAccountId',old->'toAccountId','lenderId',old->'lenderId','actualBalance',old->'actualBalance')),
    'reason',reason,'cancelled',d->>'cancel'='true','correctedBy',u,'correctedByLabel',label,'correctedAt',now())))
   ||case when d->>'cancel'='true' then jsonb_build_object('cancelled',true) else '{}'::jsonb end;
  update public.business_operations_records set data=nxt where shop_id=p_shop and collection='accountEntries' and id=rid;
 else raise exception 'Unknown operation';$$);

  d := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pat := $$'account.money_moved',$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(d, pat, $$'account.money_moved','account.entry_corrected',$$);
end $patch$;
