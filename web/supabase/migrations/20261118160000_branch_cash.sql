-- Money by branch (plans/branches-next.md, step 1):
-- * Every open branch (not stores) has its own Cash account, made automatically now and whenever
--   a branch is added or reopened. It takes the business's Cash payment method, so cash taken at a
--   branch goes into that branch's till.
-- * General Managers (not only the Developer) set up accounts and their payment methods, including
--   which branch an account belongs to or whether every branch shares it.

create or replace function private.ensure_branch_cash(p_shop uuid) returns integer
language plpgsql security definer set search_path to '' as $f$
declare br jsonb; n integer := 0; tmpl jsonb; aid uuid; acc jsonb; stamp timestamptz := now();
  opened date := (now() at time zone 'Africa/Lagos')::date; nm text;
begin
  -- A business not using accounts yet gets its first ones elsewhere (private.create_default_accounts).
  if not exists (select 1 from public.business_operations_records where shop_id = p_shop and collection = 'moneyAccounts') then
    return 0;
  end if;
  -- The business's Cash method, as the main branch's cash account has it.
  select m into tmpl from public.business_operations_records r,
    jsonb_array_elements(coalesce(r.data->'paymentMethods', '[]'::jsonb)) m
   where r.shop_id = p_shop and r.collection = 'moneyAccounts' and coalesce(r.data->>'branch', 'main') = 'main'
     and not coalesce((r.data->>'archived')::boolean, false) and m->>'kind' = 'Cash' and coalesce((m->>'enabled')::boolean, true)
   limit 1;
  tmpl := coalesce(tmpl, '{"name":"Cash","label":"Cash","kind":"Cash","enabled":true,"aliases":[]}'::jsonb);
  for br in
    select x from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
     where b.shop_id = p_shop and x->>'id' <> 'main' and coalesce(x->>'kind', 'branch') <> 'store'
       and not coalesce((x->>'archived')::boolean, false)
  loop
    if exists (select 1 from public.business_operations_records where shop_id = p_shop and collection = 'moneyAccounts'
               and data->>'branch' = br->>'id' and data->>'accountType' = 'cash') then
      continue;
    end if;
    aid := gen_random_uuid();
    nm := left('Cash, ' || coalesce(nullif(btrim(br->>'name'), ''), 'branch'), 80);
    acc := jsonb_build_object('id', aid, 'name', nm, 'accountType', 'cash', 'branch', br->>'id',
      'paymentMethods', jsonb_build_array(tmpl || jsonb_build_object('id', gen_random_uuid(), 'enabled', true)),
      'methods', jsonb_build_array(tmpl->>'label') || coalesce(tmpl->'aliases', '[]'::jsonb),
      'version', 1, 'archived', false, 'openingDate', opened, 'openingBalance', 0, 'paymentMethodsVersion', 1,
      'createdAt', stamp, 'modifiedAt', stamp, 'createdByLabel', 'Branch accounts', 'modifiedByLabel', 'Branch accounts');
    insert into public.business_operations_records (shop_id, collection, id, data) values (p_shop, 'moneyAccounts', aid, acc);
    insert into public.business_operations_records (shop_id, collection, id, data)
    values (p_shop, 'operationHistory', gen_random_uuid(), jsonb_build_object('id', gen_random_uuid(), 'recordId', aid,
      'action', 'account.created', 'before', null, 'after', acc, 'modifiedAt', stamp, 'modifiedByLabel', 'Branch accounts',
      'reason', 'Every branch has its own Cash account.'));
    n := n + 1;
  end loop;
  return n;
end $f$;
revoke all on function private.ensure_branch_cash(uuid) from public, anon, authenticated;

create or replace function private.branch_cash_on_settings() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if tg_op = 'INSERT' or new.settings->'branches' is distinct from old.settings->'branches' then
    perform private.ensure_branch_cash(new.shop_id);
  end if;
  return null;
end $f$;
drop trigger if exists branch_cash on public.business_settings;
create trigger branch_cash after insert or update of settings on public.business_settings
  for each row execute function private.branch_cash_on_settings();

-- The branches there are today.
do $m$ declare s uuid; begin
  for s in select shop_id from public.business_settings
           where jsonb_array_length(coalesce(settings->'branches', '[]'::jsonb)) > 1 loop
    perform private.ensure_branch_cash(s);
  end loop;
end $m$;

-- General Managers set up accounts too.
do $m$
declare def text := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  t text := 'if k in (''account.created'',''account.updated'') and lvl<>5 then raise exception ''Only a Developer can create accounts or change payment-method links'' using errcode=''42501'';end if;';
begin
  if position(t in def) = 0 then
    if position('Only General Managers and above can create accounts' in def) > 0 then return; end if;
    raise exception 'apply_operations_event: account check not found';
  end if;
  execute replace(def, t, 'if k in (''account.created'',''account.updated'') and lvl<4 then raise exception ''Only General Managers and above can create accounts or change payment-method links'' using errcode=''42501'';end if;');
end $m$;
