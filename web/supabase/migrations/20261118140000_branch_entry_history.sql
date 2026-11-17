-- Change history at a branch: besides other branches' money accounts, the history of money in/out,
-- transfers and reconciliations on other branches' accounts is left out too (as the entries are).
-- Shared accounts' entries follow the same rule as the entries list: shown when they touch one of
-- the branch's own accounts.
create or replace function private.branch_operation_history(p_shop uuid, p_history jsonb, p_visible_accounts jsonb)
returns jsonb language sql stable security definer set search_path to '' as $function$
  select coalesce(jsonb_agg(h order by o), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_history, '[]')) with ordinality x(h, o)
  where (not exists (select 1 from public.business_operations_records r where r.shop_id = p_shop and r.collection = 'moneyAccounts'
                       and r.id::text = h->>'recordId')
         or exists (select 1 from jsonb_array_elements(coalesce(p_visible_accounts, '[]')) a where a->>'id' = h->>'recordId'))
    and not exists (
      select 1 from public.business_operations_records e
      where e.shop_id = p_shop and e.collection = 'accountEntries' and e.id::text = h->>'recordId'
        and not exists (select 1 from jsonb_array_elements(coalesce(p_visible_accounts, '[]')) a
                        where coalesce(a->>'branch', 'main') <> '*'
                          and a->>'id' in (e.data->>'accountId', e.data->>'toAccountId')))
$function$;
