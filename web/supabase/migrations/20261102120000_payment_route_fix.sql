-- Fix: sales paid into an account whose method name differs from its type (SMG "Moniepoint
-- (Transfer)", Mairoba's Moniepoint/OPAY accounts) were refused with "Choose an active account and
-- one of its enabled payment methods".
-- Cause: a sale writes its payment line before the sale record and without the method's name, so
-- the payment check looked for a method called just "Transfer" and found none.
-- Now:
-- * A payment that belongs to a sale is placed by the sale's own check (guard_owned_checkout), which
--   has the method's name and the chosen account.
-- * Other payments (and corrections) are placed by method name; when the name is missing, by type when
--   only one account takes that type; when it still cannot be placed it stays unassigned (it can be
--   assigned on the Accounts page) instead of refusing the work.
begin;
create or replace function private.route_owned_payment() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare aid uuid; checkout jsonb; label text; entry_id uuid; n integer;
begin
  if new.amount <= 0 then return new; end if;
  -- New sale payments: the sale's own check places them.
  if tg_op = 'INSERT' and new.checkout_id is not null then return new; end if;
  if tg_op = 'UPDATE' and old.amount > 0 and (new.method, new.method_label, new.paid_on) is not distinct from (old.method, old.method_label, old.paid_on) then return new; end if;
  if not exists (select 1 from public.business_operations_records where shop_id = new.shop_id and collection = 'moneyAccounts') then return new; end if;
  select data into checkout from public.checkout_records where shop_id = new.shop_id and id = coalesce(new.checkout_id, new.id);
  label := coalesce(nullif(new.method_label, ''), nullif(checkout->>'methodLabel', ''), new.method);
  begin
    aid := private.resolve_owned_method(new.shop_id, null, label, new.method, new.paid_on, false, new.branch_id);
  exception when others then
    aid := null;
  end;
  if aid is null then
    -- By type, when exactly one usable account takes it.
    select count(*), min(r.id::text)::uuid into n, aid from public.business_operations_records r
      where r.shop_id = new.shop_id and r.collection = 'moneyAccounts' and not coalesce((r.data->>'archived')::boolean, false)
        and coalesce(r.data->>'branch', 'main') in ('*', coalesce(new.branch_id, private.request_branch(new.shop_id), 'main'))
        and (r.data->>'openingDate')::date <= new.paid_on
        and exists (select 1 from jsonb_array_elements(coalesce(r.data->'paymentMethods', '[]')) m where (m->>'enabled')::boolean and m->>'kind' = new.method);
    if n <> 1 then return new; end if;
    select m->>'label' into label from public.business_operations_records r, jsonb_array_elements(r.data->'paymentMethods') m
      where r.shop_id = new.shop_id and r.id = aid and (m->>'enabled')::boolean and m->>'kind' = new.method limit 1;
  end if;
  if checkout is not null then
    update public.checkout_records set data = data || jsonb_build_object('accountId', aid, 'method', new.method, 'methodLabel', label)
      where shop_id = new.shop_id and id = coalesce(new.checkout_id, new.id);
  else
    select id into entry_id from public.business_operations_records where shop_id = new.shop_id and collection = 'accountEntries'
      and data->>'action' = 'assignment' and data->>'transactionId' = 'payment:' || new.id::text limit 1;
    entry_id := coalesce(entry_id, gen_random_uuid());
    insert into public.business_operations_records (shop_id, collection, id, data) values (new.shop_id, 'accountEntries', entry_id,
      jsonb_build_object('id', entry_id, 'action', 'assignment', 'accountId', aid, 'transactionId', 'payment:' || new.id::text,
        'paidOn', new.paid_on, 'amount', 0, 'reason', 'Account routed from payment method', 'modifiedAt', now(), 'modifiedByLabel', 'Automatic method routing'))
      on conflict (shop_id, collection, id) do update set data = excluded.data;
  end if;
  return new;
end $f$;
revoke all on function private.route_owned_payment() from public, anon, authenticated;
commit;
