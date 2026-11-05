-- 1. Smaller first download. Each sale keeps a copy of its jobs as they were at the sale (receipts show
--    those). On a full download, a device that asks for it (p_slim) receives, for each such job, only
--    what differs from the job's current record (and, in $gone, fields the job has now but did not have
--    at the sale), and rebuilds the rest itself (normalizeLedger).
--    Older app versions do not ask and keep receiving the whole copy.
-- 2. Branch staff (not every branch) no longer receive the change history of money accounts that belong
--    to other branches. History of shared accounts and payees (shared) stays.

create or replace function private.slim_checkouts(p_checkouts jsonb, p_jobs jsonb) returns jsonb
language sql stable set search_path to '' as $f$
  with cur as (select coalesce(jsonb_object_agg(j->>'id', j), '{}'::jsonb) m from jsonb_array_elements(coalesce(p_jobs, '[]')) j)
  select coalesce(jsonb_agg(
    case when jsonb_typeof(c->'jobs') = 'array' and jsonb_array_length(c->'jobs') > 0 then
      c || jsonb_build_object('jobsTrimmed', true, 'jobs', (
        select jsonb_agg(case when cur.m ? (sj->>'id') then
            (select jsonb_object_agg(k, v) from jsonb_each(sj) e(k, v) where k = 'id' or (cur.m->(sj->>'id')->k) is distinct from v)
            || coalesce((select jsonb_build_object('$gone', jsonb_agg(k)) from jsonb_object_keys(cur.m->(sj->>'id')) k where not sj ? k), '{}')
          else sj end order by o)
        from jsonb_array_elements(c->'jobs') with ordinality s(sj, o)))
    else c end order by co), '[]'::jsonb)
  from cur, jsonb_array_elements(coalesce(p_checkouts, '[]')) with ordinality x(c, co)
$f$;

-- Change history a branch may see: everything except entries about another branch's money accounts.
create or replace function private.branch_operation_history(p_shop uuid, p_history jsonb, p_visible_accounts jsonb) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select coalesce(jsonb_agg(h order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_history, '[]')) with ordinality x(h, o)
  where not exists (select 1 from public.business_operations_records r where r.shop_id = p_shop and r.collection = 'moneyAccounts'
                      and r.id::text = h->>'recordId')
     or exists (select 1 from jsonb_array_elements(coalesce(p_visible_accounts, '[]')) a where a->>'id' = h->>'recordId')
$f$;

drop function if exists public.get_ledger_changes(uuid, text);
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null, p_slim boolean default false) returns jsonb
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
  if v.has_branches and v.keep_branch is not null then
    extra := private.branch_accounts(p_shop, extra, v.keep_branch);
    extra := jsonb_set(extra, '{operationHistory}', private.branch_operation_history(p_shop, extra->'operationHistory',
      (select coalesce(jsonb_agg(d), '[]'::jsonb) from (select data d from public.business_operations_records where shop_id = p_shop and collection = 'moneyAccounts') a
        where coalesce(d->>'branch', 'main') in ('*', v.keep_branch))));
  end if;
  if v.has_branches then
    extra := extra || jsonb_build_object('locationStock', private.visible_location_stock(p_shop, v.keep_branch is null),
      'stockRequests', private.visible_stock_requests(p_shop, v.keep_branch is null));
  end if;
  result := jsonb_set(result, '{ledger}', (result->'ledger') || extra);
  if p_slim and coalesce((result->>'full')::boolean, false) and result->'ledger' ? 'checkouts' then
    result := jsonb_set(result, '{ledger,checkouts}', private.slim_checkouts(result->'ledger'->'checkouts', result->'ledger'->'jobs'));
  end if;
  return result;
end $f$;
revoke all on function public.get_ledger_changes(uuid, text, boolean) from public, anon;
grant execute on function public.get_ledger_changes(uuid, text, boolean) to authenticated;
revoke all on function private.slim_checkouts(jsonb, jsonb), private.branch_operation_history(uuid, jsonb, jsonb) from public, anon;
grant execute on function private.slim_checkouts(jsonb, jsonb), private.branch_operation_history(uuid, jsonb, jsonb) to authenticated;
