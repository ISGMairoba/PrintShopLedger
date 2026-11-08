-- Repeating expenses (rent, salaries, internet…): reminders, never automatic expenses. Each is a
-- business operations record (collection "repeatingExpenses"). When due, an Admin records it as an
-- ordinary expense (checking the amount) or skips it; either moves it to its next date. Monthly and
-- yearly ones keep their day of the month. The app applies the same rules (repeating-expenses.mjs).

-- The records table only accepts known collections: add repeating expenses.
alter table public.business_operations_records drop constraint business_operations_records_collection_check;
alter table public.business_operations_records add constraint business_operations_records_collection_check
  check (collection = any (array['payees', 'moneyAccounts', 'accountEntries', 'operationHistory', 'repeatingExpenses']));

-- The date after p_on; monthly and yearly keep p_anchor (day of the month), clamped to the month.
create or replace function private.repeat_next(p_on date, p_every text, p_anchor integer) returns date
language plpgsql immutable set search_path to '' as $f$
declare m date;
begin
  if p_every = 'week' then return p_on + 7; end if;
  m := (date_trunc('month', p_on) + case when p_every = 'year' then interval '1 year' else interval '1 month' end)::date;
  return make_date(extract(year from m)::integer, extract(month from m)::integer,
    least(coalesce(p_anchor, extract(day from p_on)::integer), extract(day from (m + interval '1 month' - interval '1 day'))::integer));
end $f$;

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  pat := $re$else\s+raise exception 'Unknown operation';$re$;
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event end pattern not found'; end if;
  execute regexp_replace(d, pat, $$elsif k in ('repeat.created','repeat.updated','repeat.done') then
  select data into old from public.business_operations_records where shop_id=p_shop and collection='repeatingExpenses' and id=rid for update;
  if k='repeat.created' then
   if old is not null then raise exception 'Record already exists';end if;
  elsif old is null or coalesce((old->>'version')::integer,1) is distinct from (d->>'baseVersion')::integer then
   raise exception 'This repeating expense changed elsewhere. Reopen it.' using errcode='PT409';
  end if;
  if k='repeat.done' then
   if old->>'status' is distinct from 'active' or d->>'dueOn' is distinct from old->>'nextDue' then raise exception 'This one has already been recorded or skipped' using errcode='PT409';end if;
   if coalesce(d->>'action','') not in ('recorded','skipped') then raise exception 'Record or skip it';end if;
   v:=(old->>'amount')::numeric;
   if d->>'action'='recorded' then
    select (data->>'amount')::numeric into v from public.expenses where shop_id=p_shop and id=(d->>'expenseId')::uuid;
    if not found then raise exception 'Save the expense first';end if;
   end if;
   nxt:=old||audit||jsonb_build_object('amount',v::bigint,
    'nextDue',private.repeat_next((old->>'nextDue')::date,old->>'every',(old->>'anchor')::integer),
    'version',coalesce((old->>'version')::integer,1)+1,
    'history',(select coalesce(jsonb_agg(h order by o),'[]'::jsonb) from (
      select h,o from jsonb_array_elements(coalesce(old->'history','[]'::jsonb)||jsonb_build_array(
        jsonb_build_object('dueOn',old->>'nextDue','action',d->>'action','by',u,'byLabel',label,'at',now())
        ||case when d->>'action'='recorded' then jsonb_build_object('expenseId',d->>'expenseId') else '{}'::jsonb end)) with ordinality x(h,o)
      order by o desc limit 60) y));
  else
   reason:=btrim(coalesce(d->>'description',old->>'description'));
   if reason is null or length(reason) not between 1 and 200 then raise exception 'Description: up to 200 characters, required';end if;
   expected:=btrim(coalesce(d->>'category',old->>'category'));
   if expected is null or length(expected) not between 1 and 80 then raise exception 'Category: up to 80 characters, required';end if;
   v:=coalesce((d->>'amount')::numeric,(old->>'amount')::numeric,0);
   if v<0 or v>100000000000 or v<>trunc(v) then raise exception 'Enter a valid amount';end if;
   on_day:=coalesce((d->>'nextDue')::date,(old->>'nextDue')::date);
   if on_day is null then raise exception 'Choose the next date';end if;
   if coalesce(d->>'every',old->>'every','') not in ('week','month','year') then raise exception 'Choose how often it repeats';end if;
   if coalesce(d->>'status',old->>'status','active') not in ('active','paused','stopped') then raise exception 'Choose active, paused or stopped';end if;
   if length(coalesce(d->>'payee',old->>'payee','')) > 160 or length(coalesce(d->>'note',old->>'note','')) > 1000 or length(coalesce(d->>'payeeId',old->>'payeeId','')) > 40 then raise exception 'Invalid repeating expense details';end if;
   nxt:=coalesce(old,'{}'::jsonb)||audit||jsonb_build_object('id',rid,'description',reason,'category',expected,'amount',v::bigint,
    'payeeId',coalesce(d->>'payeeId',old->>'payeeId',''),'payee',btrim(coalesce(d->>'payee',old->>'payee','')),'note',btrim(coalesce(d->>'note',old->>'note','')),
    'every',coalesce(d->>'every',old->>'every'),'nextDue',on_day,'status',coalesce(d->>'status',old->>'status','active'),
    'anchor',case when d ? 'nextDue' and (d->>'nextDue')::date is distinct from (old->>'nextDue')::date then extract(day from on_day)::integer else coalesce((old->>'anchor')::integer,extract(day from on_day)::integer) end,
    'history',coalesce(old->'history','[]'::jsonb),'version',coalesce((old->>'version')::integer,0)+1,
    'createdAt',coalesce(old->'createdAt',to_jsonb(now())),'createdBy',coalesce(old->'createdBy',to_jsonb(u)),'createdByLabel',coalesce(old->'createdByLabel',to_jsonb(label)));
  end if;
  insert into public.business_operations_records(shop_id,collection,id,data) values(p_shop,'repeatingExpenses',rid,nxt) on conflict(shop_id,collection,id) do update set data=excluded.data;
 else raise exception 'Unknown operation';$$);

  -- Devices download repeating expenses with the other operations records.
  pat := $$array['payees','moneyAccounts','accountEntries','operationHistory']$$;
  d := pg_get_functiondef('public.get_ledger_changes(uuid,text,boolean)'::regprocedure);
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'get_ledger_changes pattern not found'; end if;
  execute replace(d, pat, $$array['payees','moneyAccounts','accountEntries','operationHistory','repeatingExpenses']$$);
  d := pg_get_functiondef('public.get_ledger_before_branches(uuid)'::regprocedure);
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'get_ledger_before_branches pattern not found'; end if;
  execute replace(d, pat, $$array['payees','moneyAccounts','accountEntries','operationHistory','repeatingExpenses']$$);

  -- Reviewed (held) work and offline conflicts know the new operations.
  d := pg_get_functiondef('private.apply_reviewed_operation(uuid,jsonb,uuid)'::regprocedure);
  pat := $$or p_event->>'kind' like 'account.%' then$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_reviewed_operation pattern not found'; end if;
  execute replace(d, pat, $$or p_event->>'kind' like 'account.%' or p_event->>'kind' like 'repeat.%' then$$);
  d := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pat := $$'account.money_moved',$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(d, pat, $$'account.money_moved','repeat.created','repeat.updated','repeat.done',$$);
end $patch$;

revoke all on function private.repeat_next(date, text, integer) from public, anon;
grant execute on function private.repeat_next(date, text, integer) to authenticated;
