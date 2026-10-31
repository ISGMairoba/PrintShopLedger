-- Branches, phase 2b: money accounts by branch (plan: project doc plans/branches.md).
-- * Each money account belongs to a branch ('main' when not set) or is shared by all branches ('*').
--   A new account belongs to the branch it is created in unless another is chosen.
-- * A payment method can be the default for one account per branch: a branch's own account and a
--   shared one cannot both take it.
-- * Staff who do not work in every branch receive their branch's accounts and the shared ones, and
--   the transfers, reconciliations and assignments that touch their branch's own accounts.

-- The branch an account event gives the account (checked).
create or replace function private.account_branch(p_shop uuid, d jsonb, old jsonb) returns text
language plpgsql security definer set search_path to '' as $f$
declare b text := coalesce(nullif(d->>'branch', ''), old->>'branch',
  case when old is null then coalesce(private.request_branch(p_shop), 'main') else 'main' end);
begin
  if b !~ '^(main|b-[a-z0-9]{6,20}|\*)$' then raise exception 'Choose a valid branch for the account'; end if;
  return b;
end $f$;
-- Two accounts can be used in the same branch.
create or replace function private.same_account_scope(a text, b text) returns boolean
language sql immutable set search_path to '' as $f$
  select coalesce(a, 'main') = '*' or coalesce(b, 'main') = '*' or coalesce(a, 'main') = coalesce(b, 'main')
$f$;

do $mig$
declare src text; n integer;
  a1 text := $x$'methods',d->'methods')$x$;
  b1 text := $x$'methods',d->'methods','branch',private.account_branch(p_shop,d,old))$x$;
  a2 text := $x$and id<>rid and not coalesce((data->>'archived')::boolean,false) and exists(select 1 from jsonb_array_elements_text(data->'methods')$x$;
  b2 text := $x$and id<>rid and not coalesce((data->>'archived')::boolean,false) and private.same_account_scope(data->>'branch',private.account_branch(p_shop,d,old)) and exists(select 1 from jsonb_array_elements_text(data->'methods')$x$;
  -- The second check (on every save, restores included).
  a3 text := $x$and id<>rid and not (data->>'archived')::boolean and exists(select 1 from jsonb_array_elements_text(data->'methods') as methods(value) where nxt->'methods' ? methods.value)$x$;
  b3 text := $x$and id<>rid and not (data->>'archived')::boolean and private.same_account_scope(data->>'branch',nxt->>'branch') and exists(select 1 from jsonb_array_elements_text(data->'methods') as methods(value) where nxt->'methods' ? methods.value)$x$;
begin
  src := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 or (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1
     or (length(src) - length(replace(src, a3, ''))) / length(a3) <> 1 then
    raise exception 'apply_operations_event changed; review the branch accounts migration';
  end if;
  execute replace(replace(replace(src, a1, b1), a2, b2), a3, b3);
end $mig$;

-- Money accounts and their entries a branch may see (p_keep = the branch).
create or replace function private.branch_accounts(p_shop uuid, p_part jsonb, p_keep text) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare own text[];
begin
  select coalesce(array_agg(r.id::text), '{}') into own from public.business_operations_records r
   where r.shop_id = p_shop and r.collection = 'moneyAccounts' and coalesce(r.data->>'branch', 'main') = p_keep;
  if p_part ? 'moneyAccounts' then
    p_part := jsonb_set(p_part, '{moneyAccounts}', coalesce((select jsonb_agg(a order by o) from jsonb_array_elements(p_part->'moneyAccounts') with ordinality x(a, o)
      where coalesce(a->>'branch', 'main') in ('*', p_keep)), '[]'::jsonb));
  end if;
  if p_part ? 'accountEntries' then
    p_part := jsonb_set(p_part, '{accountEntries}', coalesce((select jsonb_agg(e order by o) from jsonb_array_elements(p_part->'accountEntries') with ordinality x(e, o)
      where e->>'accountId' = any(own) or e->>'toAccountId' = any(own)), '[]'::jsonb));
  end if;
  return p_part;
end $f$;

create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare
  result jsonb := public.get_ledger_before_branches(p_shop);
  v record;
  part record;
begin
  select * into v from private.branch_view(p_shop);
  if not v.has_branches then return result; end if;
  for part in select * from (values ('jobs','jobs'), ('payments','payments'), ('checkouts','checkout_records'),
      ('expenses','expenses'), ('drawerClosings','drawer_closings'), ('saleAdjustments','sale_adjustments'),
      ('quotations','quotations'), ('reminders','customer_reminders'), ('materialWaste','material_waste')) x(k, t) loop
    if result ? part.k then
      result := jsonb_set(result, array[part.k], private.branch_records(p_shop, result->part.k, part.t, v.keep_branch));
    end if;
  end loop;
  if v.keep_branch is not null then result := private.branch_accounts(p_shop, result, v.keep_branch); end if;
  return result;
end $f$;

-- Delta sync reads payees and accounts straight from their table: keep them to the branch too.
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare result jsonb; key text; extra jsonb := '{}'; v record;
begin
  result := public.get_ledger_changes_before_operations(p_shop, p_since);
  foreach key in array array['payees','moneyAccounts','accountEntries','operationHistory'] loop
    extra := extra || jsonb_build_object(key, (select coalesce(jsonb_agg(data order by data->>'modifiedAt', id), '[]'::jsonb)
      from public.business_operations_records where shop_id = p_shop and collection = key
        and (coalesce((result->>'full')::boolean, false) or sync_xid >= p_since::xid8)));
  end loop;
  select * into v from private.branch_view(p_shop);
  if v.has_branches and v.keep_branch is not null then extra := private.branch_accounts(p_shop, extra, v.keep_branch); end if;
  return jsonb_set(result, '{ledger}', (result->'ledger') || extra);
end $f$;

revoke all on function private.account_branch(uuid,jsonb,jsonb), private.same_account_scope(text,text), private.branch_accounts(uuid,jsonb,text) from public, anon;
grant execute on function private.account_branch(uuid,jsonb,jsonb), private.same_account_scope(text,text), private.branch_accounts(uuid,jsonb,text) to authenticated;
