-- Accounts → Hide (savings): a hidden account is left out of account lists, payments, expense
-- payments and the totals; money moves in and out of it by transfer (or Money in / out). Only
-- General Managers and above (level 4+) see it, use it, and hide or unhide accounts. Hiding removes
-- the account's payment-method links so no payment is routed to it. The app applies the same rules
-- (operations.mjs, AccountsPage).

do $patch$
declare d text; pat text;
begin
  -- Sales: a payment can't go into a hidden account.
  d := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  pat := 'collection=''moneyAccounts''\s+and\s+id=\(d->>''accountId''\)::uuid\s+and\s+not\s+\(data->>''archived''\)::boolean';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_checkout_event account pattern not found'; end if;
  execute regexp_replace(d, pat, $$collection='moneyAccounts' and id=(d->>'accountId')::uuid and not (data->>'archived')::boolean and not coalesce((data->>'hidden')::boolean,false)$$);

  -- Expense payments: the same.
  d := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
  pat := 'collection=''moneyAccounts''\s+and\s+id=\(d->''payment''->>''accountId''\)::uuid\s+and\s+not\s+\(data->>''archived''\)::boolean';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_expense_event account pattern not found'; end if;
  execute regexp_replace(d, pat, $$collection='moneyAccounts' and id=(d->'payment'->>'accountId')::uuid and not (data->>'archived')::boolean and not coalesce((data->>'hidden')::boolean,false)$$);

  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  -- A variable for the entry a correction changes.
  pat := 'expected_balance\s+bigint;\s*t\s+jsonb;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event declare pattern not found'; end if;
  d := regexp_replace(d, pat, 'expected_balance bigint;t jsonb;hid jsonb;');
  -- Entries touching a hidden account: General Managers and above only; payments never go in.
  pat := 'if\s+k\s+in\s+\(''account\.created'',''account\.updated''\)\s+and\s+lvl<>5\s+then';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event guard pattern not found'; end if;
  d := regexp_replace(d, pat, $$if k in ('account.transferred','account.reconciled','account.assigned','account.money_moved','account.entry_corrected') then
  if k='account.entry_corrected' then select data into hid from public.business_operations_records where shop_id=p_shop and collection='accountEntries' and id=rid; end if;
  if exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and coalesce((data->>'hidden')::boolean,false)
            and id::text in (coalesce(d->>'accountId',''),coalesce(d->>'toAccountId',''),coalesce(hid->>'accountId',''),coalesce(hid->>'toAccountId',''))) then
   if lvl<4 then raise exception 'Only General Managers and above can use hidden accounts' using errcode='42501';end if;
   if k='account.assigned' then raise exception 'A hidden account takes transfers only, not payments';end if;
  end if;
 end if;
 if k in ('account.created','account.updated') and lvl<>5 then$$);
  -- Hide or unhide an account.
  pat := 'else\s+raise\s+exception\s+''Unknown operation'';\s*end\s+if;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event unknown-operation pattern not found'; end if;
  d := regexp_replace(d, pat, $$elsif k='account.visibility_changed' then
  if lvl<4 then raise exception 'Only General Managers and above can hide or show accounts' using errcode='42501';end if;
  if jsonb_typeof(d->'hidden') is distinct from 'boolean' then raise exception 'Choose whether to hide the account';end if;
  select data into old from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=rid for update;
  if old is null then raise exception 'Account not found';end if;
  if (d->>'baseVersion')::integer is distinct from (old->>'version')::integer then raise exception 'This record changed elsewhere. Reopen it.' using errcode='PT409';end if;
  nxt:=old||audit||jsonb_build_object('hidden',(d->>'hidden')::boolean,'version',(old->>'version')::integer+1)
   ||case when (d->>'hidden')::boolean then jsonb_build_object('methods','[]'::jsonb)||case when old ? 'paymentMethods' then jsonb_build_object('paymentMethods','[]'::jsonb) else '{}'::jsonb end else '{}'::jsonb end;
  update public.business_operations_records set data=nxt where shop_id=p_shop and collection='moneyAccounts' and id=rid;
 else raise exception 'Unknown operation';end if;$$);
  execute d;

  -- Conflicts: the new kind can be kept for review like other account changes.
  d := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pat := $$'account.money_moved',$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(d, pat, $$'account.money_moved','account.visibility_changed',$$);
end $patch$;
