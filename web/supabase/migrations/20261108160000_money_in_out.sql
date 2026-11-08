-- Accounts → Money in / out: money that is not a sale or an expense. Loans received and repaid
-- (owed to a lender, a saved payee), the owner putting money in or taking it out, and other income
-- (gifts, grants). Each is an account entry with action "money" that moves the account's balance.
-- The app applies the same rules (operations.mjs, money-moves.mjs).

-- What is still owed to a lender (kobo).
create or replace function private.lender_owed(p_shop uuid, p_lender uuid) returns bigint
language sql stable set search_path to '' as $f$
  select coalesce(sum(case when data->>'moneyType' = 'loan_in' then 1 else -1 end * (data->>'amount')::bigint), 0)::bigint
  from public.business_operations_records
  where shop_id = p_shop and collection = 'accountEntries' and data->>'action' = 'money' and data->>'lenderId' = p_lender::text
$f$;

create or replace function private.operations_balance(p_shop uuid, p_account uuid, p_day date) returns bigint
language plpgsql stable set search_path to '' as $function$
declare a jsonb;total bigint;e jsonb;t jsonb;
begin
 select data into a from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=p_account;
 if a is null then raise exception 'Account not found';end if;
 total:=(a->>'openingBalance')::bigint;
 for t in select value from jsonb_array_elements(private.operations_transactions(p_shop)) loop
  if t->>'accountId'=p_account::text and (t->>'paidOn')::date between (a->>'openingDate')::date and p_day then total:=total+(t->>'direction')::bigint*(t->>'amount')::bigint;end if;
 end loop;
 for e in select data from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and (data->>'paidOn')::date between (a->>'openingDate')::date and p_day loop
  if e->>'action'='transfer' then
   if e->>'accountId'=p_account::text then total:=total-(e->>'amount')::bigint;end if;
   if e->>'toAccountId'=p_account::text then total:=total+(e->>'amount')::bigint;end if;
  elsif e->>'action'='reconciliation' and e->>'accountId'=p_account::text then total:=total+(e->>'amount')::bigint;
  elsif e->>'action'='money' and e->>'accountId'=p_account::text then total:=total+(e->>'direction')::bigint*(e->>'amount')::bigint;
  end if;
 end loop;
 return total;
end $function$;

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  pat := $$elsif k in ('account.transferred','account.reconciled','account.assigned') then$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_operations_event kinds pattern not found'; end if;
  d := replace(d, pat, $$elsif k in ('account.transferred','account.reconciled','account.assigned','account.money_moved') then$$);
  pat := $$  else
   select value into t from jsonb_array_elements(private.operations_transactions(p_shop))$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_operations_event assignment pattern not found'; end if;
  execute replace(d, pat, $$  elsif k='account.money_moved' then
   v:=(d->>'amount')::numeric;
   if coalesce(d->>'moneyType','') not in ('loan_in','loan_repayment','owner_in','owner_out','other_income') then raise exception 'Choose what kind of money this is';end if;
   if v is null or v<=0 or v>100000000000 or v<>trunc(v) then raise exception 'Enter an amount greater than zero';end if;
   nxt:=nxt||jsonb_build_object('action','money','moneyType',d->>'moneyType','amount',v::bigint,'direction',case when d->>'moneyType' in ('loan_repayment','owner_out') then -1 else 1 end);
   if d->>'moneyType' in ('loan_in','loan_repayment') then
    select data into dest from public.business_operations_records where shop_id=p_shop and collection='payees' and id=(d->>'lenderId')::uuid;
    if dest is null or (d->>'moneyType'='loan_in' and coalesce((dest->>'archived')::boolean,false)) then raise exception 'Choose the lender';end if;
    if d->>'moneyType'='loan_repayment' and v>private.lender_owed(p_shop,(dest->>'id')::uuid) then raise exception 'That is more than is still owed to %',dest->>'name' using errcode='PT409';end if;
    nxt:=nxt||jsonb_build_object('lenderId',dest->>'id');
   end if;
$$ || pat);

  d := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pat := $$'account.assigned','checkout.completed'$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(d, pat, $$'account.assigned','account.money_moved','checkout.completed'$$);
end $patch$;

revoke all on function private.lender_owed(uuid, uuid) from public, anon;
grant execute on function private.lender_owed(uuid, uuid) to authenticated;
