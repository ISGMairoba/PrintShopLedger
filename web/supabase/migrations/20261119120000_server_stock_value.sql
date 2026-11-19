-- Actual cost, version 2, part A (plans/actual-cost-v2.md): the server keeps the value of stock.
-- Each location (the main branch, each branch) has, per material, its quantity, value and average
-- cost (private.stock_values). Every stock history line gets, when it is written, the cost per unit
-- it moved at (unit_cost) and whether that cost comes from a priced restock or still the estimate
-- (cost_actual). The rules are the ones the app uses today (web/src/actual-cost.mjs), so figures do
-- not change; later parts add splits, returns, transfers, purchases and late bills, and move the app
-- to these figures (one answer on every device, however much history it keeps).
-- Opening values: stock held before any priced restock is at the estimated cost per unit (Pricing
-- Templates → Costs), as agreed. Existing history is worked through once at the end.

alter table public.material_stock_changes add column if not exists unit_cost numeric;
alter table public.material_stock_changes add column if not exists cost_actual boolean;

create table if not exists private.stock_values (
  shop_id uuid not null references public.shops(id) on delete cascade,
  location text not null,
  material_id uuid not null,
  quantity numeric not null default 0,
  value numeric not null default 0,
  average numeric,            -- cost per unit now (null: no estimate and no priced restock yet)
  restocks integer not null default 0,
  no_cost numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (shop_id, location, material_id)
);
revoke all on private.stock_values from public, anon, authenticated;

-- The estimated cost per unit: the first costed item using the material (as profit.mjs materialUnitCost).
create or replace function private.material_estimate(p_shop uuid, p_material uuid) returns numeric
language sql stable security definer set search_path to '' as $f$
  select (s.costing->>'amount')::numeric / coalesce(nullif((s.costing->>'per')::numeric, 0), 1)
    from public.services s
   where s.shop_id = p_shop and s.material_id = p_material and not s.archived
     and jsonb_typeof(s.costing->'amount') = 'number'
   order by s.description, s.id limit 1
$f$;

-- One history line: move the location's stock and value, and stamp the line's cost.
create or replace function private.value_stock_line() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare v private.stock_values%rowtype; loc text := coalesce(new.branch_id, 'main');
  before_q numeric := coalesce(new.before_available, 0); after_q numeric := coalesce(new.after_available, coalesce(new.before_available, 0));
  change numeric; held numeric; landed numeric; unit numeric; cost jsonb := new.after_values->'cost';
begin
  change := round(after_q - before_q, 3);
  select * into v from private.stock_values where shop_id = new.shop_id and location = loc and material_id = new.material_id for update;
  if not found then
    v.shop_id := new.shop_id; v.location := loc; v.material_id := new.material_id;
    v.quantity := 0; v.value := 0; v.restocks := 0; v.no_cost := 0;
    v.average := private.material_estimate(new.shop_id, new.material_id);
  end if;
  -- Pick up from the stock the line says was there (a gap, or the first line), at the average so far.
  if new.before_available is not null and before_q <> v.quantity then
    v.quantity := before_q;
    v.value := case when v.average is null then 0 else greatest(0, before_q) * v.average end;
  end if;
  held := greatest(0, v.quantity);
  if new.action = 'material.transferred' and change > 0 and jsonb_typeof(cost->'unitCost') = 'number' then
    -- Received from another location, at what it cost there.
    unit := (cost->>'unitCost')::numeric;
    if v.average is null then v.value := held * unit; end if;
    v.value := (case when held > 0 then v.value else 0 end) + unit * change;
    v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
    if coalesce((cost->>'actual')::boolean, false) then v.restocks := v.restocks + 1; end if;
    new.cost_actual := coalesce((cost->>'actual')::boolean, false);
  elsif new.action = 'material.stock_added' and change > 0 and jsonb_typeof(cost->'supplierPrice') = 'number' then
    -- A priced restock joins the stock at the average so far.
    landed := (cost->>'supplierPrice')::numeric;
    if v.average is null then v.value := held * (landed / change); end if;
    v.value := (case when held > 0 then v.value else 0 end) + landed;
    v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
    v.restocks := v.restocks + 1;
    unit := landed / change;
    new.cost_actual := true;
  else
    -- Anything else moves at the current average (an addition without a price counts as "no cost").
    if change > 0 and new.action <> 'material.stock_set' and new.before_available is not null then v.no_cost := v.no_cost + change; end if;
    unit := v.average;
    v.value := case when v.average is null then 0 else greatest(0, after_q) * v.average end;
    new.cost_actual := v.restocks > 0;
  end if;
  v.quantity := after_q;
  v.updated_at := now();
  new.unit_cost := unit;
  insert into private.stock_values values (v.*)
    on conflict (shop_id, location, material_id) do update set quantity = excluded.quantity, value = excluded.value,
      average = excluded.average, restocks = excluded.restocks, no_cost = excluded.no_cost, updated_at = excluded.updated_at;
  return new;
end $f$;
drop trigger if exists zz_value_stock on public.material_stock_changes;
create trigger zz_value_stock before insert on public.material_stock_changes
  for each row execute function private.value_stock_line();

-- The history written so far, worked through once in order (lines keep everything else they had).
do $m$
declare h record; v private.stock_values%rowtype; loc text; before_q numeric; after_q numeric; change numeric; held numeric;
  landed numeric; unit numeric; cost jsonb; actual boolean;
begin
  if exists (select 1 from private.stock_values) then return; end if;
  for h in select * from public.material_stock_changes order by shop_id, created_at, id loop
    loc := coalesce(h.branch_id, 'main');
    before_q := coalesce(h.before_available, 0); after_q := coalesce(h.after_available, coalesce(h.before_available, 0));
    change := round(after_q - before_q, 3); cost := h.after_values->'cost';
    select * into v from private.stock_values where shop_id = h.shop_id and location = loc and material_id = h.material_id;
    if not found then
      v.shop_id := h.shop_id; v.location := loc; v.material_id := h.material_id;
      v.quantity := 0; v.value := 0; v.restocks := 0; v.no_cost := 0;
      v.average := private.material_estimate(h.shop_id, h.material_id);
    end if;
    if h.before_available is not null and before_q <> v.quantity then
      v.quantity := before_q;
      v.value := case when v.average is null then 0 else greatest(0, before_q) * v.average end;
    end if;
    held := greatest(0, v.quantity);
    if h.action = 'material.transferred' and change > 0 and jsonb_typeof(cost->'unitCost') = 'number' then
      unit := (cost->>'unitCost')::numeric;
      if v.average is null then v.value := held * unit; end if;
      v.value := (case when held > 0 then v.value else 0 end) + unit * change;
      v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
      if coalesce((cost->>'actual')::boolean, false) then v.restocks := v.restocks + 1; end if;
      actual := coalesce((cost->>'actual')::boolean, false);
    elsif h.action = 'material.stock_added' and change > 0 and jsonb_typeof(cost->'supplierPrice') = 'number' then
      landed := (cost->>'supplierPrice')::numeric;
      if v.average is null then v.value := held * (landed / change); end if;
      v.value := (case when held > 0 then v.value else 0 end) + landed;
      v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
      v.restocks := v.restocks + 1;
      unit := landed / change; actual := true;
    else
      if change > 0 and h.action <> 'material.stock_set' and h.before_available is not null then v.no_cost := v.no_cost + change; end if;
      unit := v.average;
      v.value := case when v.average is null then 0 else greatest(0, after_q) * v.average end;
      actual := v.restocks > 0;
    end if;
    v.quantity := after_q; v.updated_at := now();
    insert into private.stock_values values (v.*)
      on conflict (shop_id, location, material_id) do update set quantity = excluded.quantity, value = excluded.value,
        average = excluded.average, restocks = excluded.restocks, no_cost = excluded.no_cost, updated_at = excluded.updated_at;
    update public.material_stock_changes set unit_cost = unit, cost_actual = actual where id = h.id;
  end loop;
end $m$;
