-- Delta sync: each synced row records the transaction that last wrote it (sync_xid). A device
-- asks for the rows written since its cursor and merges them, instead of downloading the whole
-- business on every sync. The cursor is the oldest transaction still running when the changes
-- were read, so a change committed late is sent next time (a row may be sent twice; never lost).
create or replace function private.touch_sync_xid() returns trigger language plpgsql set search_path to '' as $f$
begin
  new.sync_xid := pg_current_xact_id();
  return new;
end $f$;

-- A payment is sent with its allocations: changing or removing an allocation re-sends the payment.
create or replace function private.touch_payment_sync() returns trigger language plpgsql security definer set search_path to '' as $f$
begin
  update public.payments set sync_xid = pg_current_xact_id()
   where shop_id = coalesce(new.shop_id, old.shop_id) and id = coalesce(new.payment_id, old.payment_id);
  return null;
end $f$;

do $mig$
declare t text;
begin
  foreach t in array array['services','materials','material_stock_changes','customers','jobs','payments',
    'checkout_records','drawer_closings','expenses','expense_changes','sale_adjustments','material_waste',
    'quotations','customer_reminders'] loop
    execute format('alter table public.%I add column if not exists sync_xid xid8 not null default ''0''', t);
    execute format('drop trigger if exists touch_sync_xid on public.%I', t);
    execute format('create trigger touch_sync_xid before insert or update on public.%I for each row execute function private.touch_sync_xid()', t);
  end loop;
end $mig$;
drop trigger if exists touch_payment_sync on public.payment_allocations;
create trigger touch_payment_sync after insert or update or delete on public.payment_allocations
  for each row execute function private.touch_payment_sync();

-- The items of a collection whose id is in the list.
create or replace function private.pick_ids(p_items jsonb, p_ids uuid[]) returns jsonb language sql immutable set search_path to '' as $f$
  select coalesce(jsonb_agg(i order by n), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality x(i, n)
  where (i->>'id')::uuid = any(p_ids)
$f$;

-- The whole ledger (p_since null) or only what changed since a cursor, with the next cursor.
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null)
returns jsonb language plpgsql set search_path to '' as $f$
declare
  cur xid8 := pg_snapshot_xmin(pg_current_snapshot());
  ledger jsonb;
  s xid8;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  ledger := public.get_ledger(p_shop);
  if p_since is null then
    return jsonb_build_object('cursor', cur::text, 'full', true, 'ledger', ledger);
  end if;
  s := p_since::xid8;
  return jsonb_build_object('cursor', cur::text, 'full', false, 'ledger', jsonb_build_object(
    'services', private.pick_ids(ledger->'services', array(select id from public.services where shop_id=p_shop and sync_xid >= s)),
    'materials', private.pick_ids(ledger->'materials', array(select id from public.materials where shop_id=p_shop and sync_xid >= s)),
    'materialHistory', private.pick_ids(ledger->'materialHistory', array(select id from public.material_stock_changes where shop_id=p_shop and sync_xid >= s)),
    'customers', private.pick_ids(ledger->'customers', array(select id from public.customers where shop_id=p_shop and sync_xid >= s)),
    'jobs', private.pick_ids(ledger->'jobs', array(select id from public.jobs where shop_id=p_shop and sync_xid >= s)),
    'payments', private.pick_ids(ledger->'payments', array(
       select id from public.payments where shop_id=p_shop and sync_xid >= s
       union select id from public.checkout_records where shop_id=p_shop and sync_xid >= s
       union select id from public.sale_adjustments where shop_id=p_shop and sync_xid >= s)),
    'checkouts', private.pick_ids(ledger->'checkouts', array(select id from public.checkout_records where shop_id=p_shop and sync_xid >= s)),
    'drawerClosings', private.pick_ids(ledger->'drawerClosings', array(select id from public.drawer_closings where shop_id=p_shop and sync_xid >= s)),
    'expenses', private.pick_ids(ledger->'expenses', array(select id from public.expenses where shop_id=p_shop and sync_xid >= s)),
    'expenseHistory', private.pick_ids(ledger->'expenseHistory', array(select id from public.expense_changes where shop_id=p_shop and sync_xid >= s)),
    'saleAdjustments', private.pick_ids(ledger->'saleAdjustments', array(select id from public.sale_adjustments where shop_id=p_shop and sync_xid >= s)),
    'materialWaste', private.pick_ids(ledger->'materialWaste', array(select id from public.material_waste where shop_id=p_shop and sync_xid >= s)),
    'quotations', private.pick_ids(ledger->'quotations', array(select id from public.quotations where shop_id=p_shop and sync_xid >= s)),
    'reminders', private.pick_ids(ledger->'reminders', array(select id from public.customer_reminders where shop_id=p_shop and sync_xid >= s))
  ));
end $f$;
revoke all on function public.get_ledger_changes(uuid, text) from public, anon;
grant execute on function public.get_ledger_changes(uuid, text) to authenticated;
