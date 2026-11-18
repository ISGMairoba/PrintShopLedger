-- Each branch's own Cash account is called "Cash", like the main branch's (it was "Cash, <branch>"
-- because account names had to be unique across the business). Account names are now unique
-- within a branch (an account shared by every branch: across the business); the all-branches
-- view shows each account's branch beside its name.
do $m$
declare d text := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  t text := $x$and lower(btrim(data->>'name'))=lower(nxt->>'name')) then raise exception 'An active record already has that name'$x$;
begin
  if position('same_account_scope(data->>''branch'',nxt->>''branch'')) then raise exception ''An active record' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'apply_operations_event: name check not found'; end if;
  execute replace(d, t, $x$and lower(btrim(data->>'name'))=lower(nxt->>'name') and (col<>'moneyAccounts' or private.same_account_scope(data->>'branch',nxt->>'branch'))) then raise exception 'An active record already has that name'$x$);
end $m$;

-- New branches' Cash accounts: "Cash" (or "Cash, <branch>" if a shared account already has that name).
do $m$
declare d text := pg_get_functiondef('private.ensure_branch_cash(uuid)'::regprocedure);
  t text := $x$nm := left('Cash, ' || coalesce(nullif(btrim(br->>'name'), ''), 'branch'), 80);$x$;
begin
  if position('shared account already' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'ensure_branch_cash: name not found'; end if;
  execute replace(d, t, t || $x$
    -- "Cash" unless an account shared by every branch already has that name.
    if not exists (select 1 from public.business_operations_records where shop_id = p_shop and collection = 'moneyAccounts'
                   and not coalesce((data->>'archived')::boolean, false) and lower(btrim(data->>'name')) = 'cash'
                   and coalesce(data->>'branch', 'main') in ('*', br->>'id')) then nm := 'Cash'; end if;$x$);
end $m$;

-- The Cash accounts made for branches so far.
update public.business_operations_records r set data = r.data || jsonb_build_object('name', 'Cash',
    'version', coalesce((r.data->>'version')::integer, 1) + 1, 'modifiedAt', now())
 where r.collection = 'moneyAccounts' and r.data->>'createdByLabel' = 'Branch accounts' and r.data->>'name' like 'Cash, %'
   and coalesce(r.data->>'branch', 'main') not in ('main', '*')
   and not exists (select 1 from public.business_operations_records o where o.shop_id = r.shop_id and o.collection = 'moneyAccounts'
                   and o.id <> r.id and not coalesce((o.data->>'archived')::boolean, false) and lower(btrim(o.data->>'name')) = 'cash'
                   and coalesce(o.data->>'branch', 'main') in ('*', r.data->>'branch'));
