-- Paying a payee once, with advances (owner, 25 Nov). The app spreads one payee payment over their
-- unpaid expenses as ordinary expense payments (web/src/payee-payments.mjs); what is left over is an
-- advance held with the payee. Here:
--   * two money moves with a payee: 'payee_advance' (money out of an account to the payee) and
--     'advance_returned' (money the payee gives back, no more than is held);
--   * expense payments with source 'Payee advance': paid from the advance, with no account, no more
--     than is held; they move no account (left out of the account transactions);
--   * private.payee_advance: what is held (advances, less returns, less expense payments from it);
--   * guard_owned_money_record treats an advance payment like Personal funds (no account);
--   * a check that no change (a correction or cancelled advance) leaves a payee's advance below zero.
-- Patterns allow for CR LF, as the SQL editor sends a pasted file.

create or replace function private.payee_advance(p_shop uuid, p_payee uuid) returns bigint
language sql stable set search_path to '' as $f$
  select coalesce((select sum(case when data->>'moneyType' = 'payee_advance' then 1 else -1 end * (data->>'amount')::bigint)
           from public.business_operations_records
           where shop_id = p_shop and collection = 'accountEntries' and data->>'action' = 'money' and data->>'payeeId' = p_payee::text), 0)::bigint
       - coalesce((select sum((p->>'amount')::bigint) from public.expenses e cross join lateral jsonb_array_elements(e.data->'payments') p
           where e.shop_id = p_shop and e.data->>'payeeId' = p_payee::text and p->>'source' = 'Payee advance'), 0)::bigint
$f$;
revoke all on function private.payee_advance(uuid, uuid) from public, anon, authenticated;

create or replace function private.check_payee_advance() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if new.collection = 'accountEntries' and new.data ? 'payeeId'
     and private.payee_advance(new.shop_id, (new.data->>'payeeId')::uuid) < 0 then
    raise exception 'The advance already used would be more than the advance paid. Correct the expense payments first.' using errcode = 'PT409';
  end if;
  return null;
end $f$;
drop trigger if exists check_payee_advance on public.business_operations_records;
create constraint trigger check_payee_advance after insert or update on public.business_operations_records
  for each row execute function private.check_payee_advance();

do $patch$
declare d text; pat text;
begin
  -- 1. Money moves with a payee.
  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  if position('payee_advance' in d) = 0 then
    pat := '\(''loan_in'',''loan_repayment'',''owner_in'',''owner_out'',''other_income''\)';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event money types pattern not found'; end if;
    d := regexp_replace(d, pat, $r$('loan_in','loan_repayment','owner_in','owner_out','other_income','payee_advance','advance_returned')$r$);
    pat := 'in \(''loan_repayment'',''owner_out''\) then -1';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event direction pattern not found'; end if;
    d := regexp_replace(d, pat, $r$in ('loan_repayment','owner_out','payee_advance') then -1$r$);
    pat := '(\s+)(else\s+select value into t from jsonb_array_elements\(private\.operations_transactions\(p_shop\)\))';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event assignment pattern not found'; end if;
    d := regexp_replace(d, pat, $r$
   if d->>'moneyType' in ('payee_advance','advance_returned') then
    begin select data into dest from public.business_operations_records where shop_id=p_shop and collection='payees' and id=(d->>'payeeId')::uuid;
    exception when others then dest := null; end;
    if dest is null or (d->>'moneyType'='payee_advance' and coalesce((dest->>'archived')::boolean,false)) then raise exception 'Choose the payee';end if;
    if d->>'moneyType'='advance_returned' and v>private.payee_advance(p_shop,(dest->>'id')::uuid) then raise exception 'That is more than the advance held with %',dest->>'name' using errcode='PT409';end if;
    nxt:=nxt||jsonb_build_object('payeeId',dest->>'id');
   end if;\1\2$r$);
    execute d;
  end if;

  -- 2. Expense payments from a payee's advance.
  d := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
  if position('Payee advance' in d) = 0 then
    pat := '\(''Business cash'',''Business bank account'',''Personal funds'',''Other''\) then raise exception ''Choose payment method and source'';end if;';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_expense_event payment source pattern not found'; end if;
    d := regexp_replace(d, pat, $r$('Business cash','Business bank account','Personal funds','Other','Payee advance') then raise exception 'Choose payment method and source';end if;
  if p->>'source'='Payee advance' then
   if nullif(nxt->>'payeeId','') is null then raise exception 'Choose the payee to pay from their advance';end if;
   if nullif(p->>'accountId','') is not null then raise exception 'A payment from an advance does not come from an account';end if;
   if paid>private.payee_advance(p_shop,(nxt->>'payeeId')::uuid) then raise exception 'That is more than the advance held with this payee' using errcode='PT409';end if;
  end if;$r$);
    execute d;
  end if;

  -- 3. Paid from an advance: no account moves, and it is never "unassigned".
  d := pg_get_functiondef('private.operations_transactions_core(uuid)'::regprocedure);
  if position('Payee advance' in d) = 0 then
    pat := '(jsonb_array_elements\(e->''payments''\) p)(\s+union all)';
    if regexp_count(d, pat) <> 1 then raise exception 'operations_transactions_core expense pattern not found'; end if;
    d := regexp_replace(d, pat, $r$\1 where coalesce(p->>'source','')<>'Payee advance'\2$r$);
    execute d;
  end if;

  -- 4. A payment from an advance names no account (like Personal funds).
  d := pg_get_functiondef('private.guard_owned_money_record()'::regprocedure);
  if position('Payee advance' in d) = 0 then
    pat := 'p->>''source''=''Personal funds'',new\.branch_id';
    if regexp_count(d, pat) <> 1 then raise exception 'guard_owned_money_record pattern not found'; end if;
    d := regexp_replace(d, pat, $r$p->>'source' in ('Personal funds','Payee advance'),new.branch_id$r$);
    execute d;
  end if;
end $patch$;
