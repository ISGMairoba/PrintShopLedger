-- Every business starts with two money accounts and three payment methods:
--   Cash (method Cash) and Bank (methods POS and Transfer).
-- * New businesses get them at registration.
-- * Existing businesses that have no accounts yet get them now, opening on the day the business was
--   created with a zero opening balance, so their earlier payments count in the balances.
-- The method labels stay "Cash", "POS" and "Transfer", the same as the business's payment methods,
-- so sales recorded earlier (and on devices that are not yet updated) still match their account.
-- Businesses that already have accounts are not changed.

create or replace function private.create_default_accounts(p_shop uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare
  opened date; stamp timestamptz := now(); acc jsonb; aid uuid;
begin
  if exists (select 1 from public.business_operations_records where shop_id = p_shop and collection = 'moneyAccounts') then return; end if;
  select (created_at at time zone 'Africa/Lagos')::date into opened from public.shops where id = p_shop;
  opened := coalesce(opened, (stamp at time zone 'Africa/Lagos')::date);
  for acc in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('name', 'Cash', 'accountType', 'cash', 'paymentMethods', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'name', 'Cash', 'label', 'Cash', 'kind', 'Cash', 'enabled', true, 'aliases', '[]'::jsonb))),
      jsonb_build_object('name', 'Bank', 'accountType', 'bank', 'paymentMethods', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'name', 'POS', 'label', 'POS', 'kind', 'POS', 'enabled', true, 'aliases', '[]'::jsonb),
        jsonb_build_object('id', gen_random_uuid(), 'name', 'Transfer', 'label', 'Transfer', 'kind', 'Transfer', 'enabled', true, 'aliases', '[]'::jsonb)))))
  loop
    aid := gen_random_uuid();
    acc := acc || jsonb_build_object('id', aid, 'methods', (select jsonb_agg(m->'label') from jsonb_array_elements(acc->'paymentMethods') m),
      'version', 1, 'archived', false, 'openingDate', opened, 'openingBalance', 0, 'paymentMethodsVersion', 1,
      'createdAt', stamp, 'modifiedAt', stamp, 'createdByLabel', 'Default accounts', 'modifiedByLabel', 'Default accounts');
    insert into public.business_operations_records (shop_id, collection, id, data) values (p_shop, 'moneyAccounts', aid, acc);
    aid := gen_random_uuid();
    insert into public.business_operations_records (shop_id, collection, id, data) values (p_shop, 'operationHistory', aid,
      jsonb_build_object('id', aid, 'recordId', acc->>'id', 'action', 'account.created', 'before', null, 'after', acc,
        'modifiedAt', stamp, 'modifiedByLabel', 'Default accounts', 'reason', 'Every business starts with a Cash and a Bank account.'));
  end loop;
end $f$;
revoke all on function private.create_default_accounts(uuid) from public, anon, authenticated;

-- New businesses: at registration.
do $mig$
declare src text; a text := 'insert into public.business_accounts(shop_id,user_id) values(v_shop,p_owner);';
begin
  src := pg_get_functiondef('private.complete_business_registration(uuid,uuid,text,text,text,text)'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'complete_business_registration changed; review the default accounts migration'; end if;
  execute replace(src, a, a || ' perform private.create_default_accounts(v_shop);');
end $mig$;

-- Existing businesses without accounts.
do $mig$
declare sid uuid;
begin
  for sid in select s.id from public.shops s where not exists (select 1 from public.business_operations_records r where r.shop_id = s.id and r.collection = 'moneyAccounts') loop
    perform private.create_default_accounts(sid);
  end loop;
end $mig$;
