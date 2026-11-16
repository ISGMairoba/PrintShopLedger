-- Actual profit, part 1: restocks with a supplier price (plans/actual-profit.md).
-- "Add to stock" can carry what the supplier charged for that quantity: data.cost =
-- { supplierPrice (kobo, for the whole quantity), supplier, included (extras already in the price) }.
-- The stock history line keeps it (after_values.cost), so every device works out the same average
-- actual cost per material by replaying the history in order (web/src/actual-cost.mjs).
-- Works for both kinds of history line (the main stock and a branch's own stock).

create or replace function private.keep_restock_cost()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_cost jsonb;
begin
  if new.action is distinct from 'material.stock_added' then return new; end if;
  select payload->'data'->'cost' into v_cost from public.ledger_events where shop_id = new.shop_id and id = new.id;
  if v_cost is null or v_cost = 'null'::jsonb then return new; end if;
  if jsonb_typeof(v_cost) is distinct from 'object'
     or jsonb_typeof(v_cost->'supplierPrice') is distinct from 'number'
     or (v_cost->>'supplierPrice')::numeric < 0 or (v_cost->>'supplierPrice')::numeric > 100000000000
     or (v_cost->>'supplierPrice')::numeric <> trunc((v_cost->>'supplierPrice')::numeric)
     or (v_cost ? 'supplier' and (jsonb_typeof(v_cost->'supplier') is distinct from 'string' or length(v_cost->>'supplier') > 80 or v_cost->>'supplier' ~ '[[:cntrl:]]'))
     or (v_cost ? 'included' and (jsonb_typeof(v_cost->'included') is distinct from 'string' or length(v_cost->>'included') > 200 or v_cost->>'included' ~ '[[:cntrl:]]'))
     or exists (select 1 from jsonb_object_keys(v_cost) k where k not in ('supplierPrice', 'supplier', 'included')) then
    raise exception 'Invalid restock cost';
  end if;
  new.after_values := coalesce(new.after_values, '{}'::jsonb) || jsonb_build_object('cost', v_cost);
  return new;
end $$;

drop trigger if exists keep_restock_cost on public.material_stock_changes;
create trigger keep_restock_cost before insert on public.material_stock_changes
  for each row execute function private.keep_restock_cost();
