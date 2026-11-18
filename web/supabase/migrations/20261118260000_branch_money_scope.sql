-- Money between branches (plans/branches-next.md): General Managers move money between any
-- branches' accounts (Accounts in the all-branches view); the entry shows at both branches.
-- Staff below General Manager use only their own branch's accounts and the shared ones, so they
-- cannot move money out of, or record money against, another branch's account.
create or replace function private.assert_account_branch(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare k text := p_event->>'kind'; d jsonb := p_event->'data'; bv record; ids text[]; old jsonb;
begin
  if k not like 'account.%' or k in ('account.created', 'account.updated', 'account.archived', 'account.restored') then return; end if;
  select * into bv from private.branch_view(p_shop);
  if not bv.has_branches or bv.keep_branch is null then return; end if;
  ids := array[d->>'accountId', d->>'toAccountId'];
  if k = 'account.entry_corrected' then
    select data into old from public.business_operations_records
     where shop_id = p_shop and collection = 'accountEntries' and id::text = d->>'id';
    ids := ids || array[old->>'accountId', old->>'toAccountId'];
  end if;
  if exists (select 1 from public.business_operations_records
             where shop_id = p_shop and collection = 'moneyAccounts' and id::text = any(ids)
               and coalesce(data->>'branch', 'main') not in ('*', bv.keep_branch)) then
    raise exception 'This account belongs to another branch. Only a General Manager can move money between branches.' using errcode = '42501';
  end if;
end $f$;
revoke all on function private.assert_account_branch(uuid, jsonb) from public, anon;
grant execute on function private.assert_account_branch(uuid, jsonb) to authenticated;

create or replace function public.apply_operations_event(p_shop uuid, p_event jsonb) returns void
language plpgsql set search_path to '' as $f$
begin
  perform private.assert_account_branch(p_shop, p_event);
  perform private.apply_operations_event(p_shop, p_event);
end $f$;
revoke all on function public.apply_operations_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_operations_event(uuid, jsonb) to authenticated;
