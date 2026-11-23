-- Actual cost, parts B and C (plans/actual-cost-v2.md): the server's stock valuation follows the
-- agreed rules for every movement. These figures are what a business on the Actual cost method sees;
-- a business on Estimated (the default) uses its cost prices instead and is asked for none of this.
--   * Transfers: stock arrives at the cost it had at the sending location (decision 3). The phone's
--     cost is no longer used.
--   * Returns to stock on a job: at the cost the job took it out at, not today's average (5).
--   * Expenses that buy stock: each stock line can carry its amount; that line is a priced restock (7).
--   * Splits: the pieces take over the roll's value, shared by each piece's own cost per unit (equal
--     per unit when that is unknown), less the waste % given on the split; putting pieces back
--     together gives the roll their value (4, owner 23 Nov).
-- Lines already written keep their figures (decision 9: no past job is rewritten).

-- 1. A cost carried by an expense's stock line counts like a restock's supplier price.
create or replace function private.keep_restock_cost()
returns trigger language plpgsql security definer set search_path to '' as $f$
declare v_cost jsonb;
begin
  if new.action not in ('material.stock_added', 'material.expense_stock_changed') then return new; end if;
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
end $f$;

-- The cost per unit to fall back on for a material with no average yet: its own cost price, else the
-- first cost linked to it (Pricing Templates → Costs).
create or replace function private.material_estimate(p_shop uuid, p_material uuid) returns numeric
language sql stable security definer set search_path to '' as $f$
  select coalesce(
    (select cost_price from public.materials where shop_id = p_shop and id = p_material),
    (select (s.costing->>'amount')::numeric / coalesce(nullif((s.costing->>'per')::numeric, 0), 1)
       from public.services s
      where s.shop_id = p_shop and s.material_id = p_material and not s.archived
        and jsonb_typeof(s.costing->'amount') = 'number'
      order by s.description, s.id limit 1))
$f$;

-- 2. One history line: move the location's stock and value, and stamp the line's cost.
create or replace function private.value_stock_line() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare v private.stock_values%rowtype; loc text := coalesce(new.branch_id, 'main');
  before_q numeric := coalesce(new.before_available, 0); after_q numeric := coalesce(new.after_available, coalesce(new.before_available, 0));
  change numeric; held numeric; landed numeric; unit numeric; cost jsonb := new.after_values->'cost';
  sent jsonb; out_q numeric; out_v numeric; event jsonb; waste numeric; pieces record; weight numeric; total_w numeric;
  share numeric; all_known boolean; given numeric;
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
  if new.action = 'material.transferred' and change > 0 then
    -- Received from another location, at the cost it had there (remembered by the line that sent it
    -- in this same transfer; an older phone's own figure only if the sending line was not seen).
    sent := nullif(current_setting('psl.transfer_cost', true), '')::jsonb;
    if sent is not null and sent->>'material' = new.material_id::text and jsonb_typeof(sent->'unit') = 'number' then
      unit := (sent->>'unit')::numeric; new.cost_actual := (sent->>'actual')::boolean;
    elsif jsonb_typeof(cost->'unitCost') = 'number' then
      unit := (cost->>'unitCost')::numeric; new.cost_actual := coalesce((cost->>'actual')::boolean, false);
    end if;
    perform set_config('psl.transfer_cost', '', true);
    if unit is not null then
      if v.average is null then v.value := held * unit; end if;
      v.value := (case when held > 0 then v.value else 0 end) + unit * change;
      v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
      if new.cost_actual then v.restocks := v.restocks + 1; end if;
    else
      unit := v.average;
      v.value := case when v.average is null then 0 else greatest(0, after_q) * v.average end;
      new.cost_actual := v.restocks > 0;
    end if;
  elsif new.action in ('material.stock_added', 'material.expense_stock_changed') and change > 0
        and jsonb_typeof(cost->'supplierPrice') = 'number' then
    -- A priced restock (or a priced line on an expense) joins the stock at the average so far.
    landed := (cost->>'supplierPrice')::numeric;
    if v.average is null then v.value := held * (landed / change); end if;
    v.value := (case when held > 0 then v.value else 0 end) + landed;
    v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
    v.restocks := v.restocks + 1;
    unit := landed / change;
    new.cost_actual := true;
  elsif change > 0 and new.job_id is not null then
    -- Back to stock from a job: at the cost the job took this material out at, never more than it took.
    select sum(-(h.after_available - h.before_available)), sum(-(h.after_available - h.before_available) * h.unit_cost)
      into out_q, out_v
      from public.material_stock_changes h
     where h.shop_id = new.shop_id and h.job_id = new.job_id and h.material_id = new.material_id
       and h.after_available < h.before_available and h.unit_cost is not null;
    if out_q > 0 then
      unit := out_v / out_q;
      if v.average is null then v.value := held * unit; end if;
      v.value := (case when held > 0 then v.value else 0 end) + unit * change;
      v.average := case when held + change > 0 then v.value / (held + change) else v.average end;
      new.cost_actual := v.restocks > 0;
    else
      unit := v.average;
      v.value := case when v.average is null then 0 else greatest(0, after_q) * v.average end;
      new.cost_actual := v.restocks > 0;
    end if;
  else
    -- Anything else moves at the current average (an addition without a price counts as "no cost").
    if change > 0 and new.action not in ('material.stock_set', 'material.split') and new.before_available is not null then
      v.no_cost := v.no_cost + change;
    end if;
    unit := v.average;
    v.value := case when v.average is null then 0 else greatest(0, after_q) * v.average end;
    new.cost_actual := v.restocks > 0;
    -- A transfer's sending line: the receiving line (next, in the same transfer) arrives at this cost.
    if new.action = 'material.transferred' and change < 0 and unit is not null then
      perform set_config('psl.transfer_cost',
        jsonb_build_object('material', new.material_id, 'unit', round(unit, 4), 'actual', new.cost_actual)::text, true);
    end if;
  end if;
  v.quantity := after_q;
  v.updated_at := now();
  new.unit_cost := unit;
  insert into private.stock_values values (v.*)
    on conflict (shop_id, location, material_id) do update set quantity = excluded.quantity, value = excluded.value,
      average = excluded.average, restocks = excluded.restocks, no_cost = excluded.no_cost, updated_at = excluded.updated_at;

  -- A split (or putting pieces back together): this is the roll's line, written after its pieces'.
  if new.action = 'material.split' then
    select payload into event from public.ledger_events where shop_id = new.shop_id and id = new.id;
    -- (A piece's own line carries splitEventId; only the roll's line doesn't.)
    if (event->'data' ? 'pieces' or event->'data' ? 'toId') and not (event->'data' ? 'splitEventId') then
      waste := least(100, greatest(0, coalesce(nullif(event->'data'->>'wastePercent', '')::numeric, 0)));
      if change < 0 and unit is not null then
        -- The roll's value goes to its pieces (less waste), shared by each piece's cost per unit.
        out_v := -change * unit * (1 - waste / 100);
        total_w := 0; all_known := true;
        for pieces in
          select h.id, h.material_id, coalesce(h.branch_id, 'main') loc, h.after_available - h.before_available q,
                 coalesce(sv.average, private.material_estimate(h.shop_id, h.material_id)) avg
            from public.material_stock_changes h
            join public.ledger_events e on e.shop_id = h.shop_id and e.id = h.id
            left join private.stock_values sv on sv.shop_id = h.shop_id and sv.location = coalesce(h.branch_id, 'main') and sv.material_id = h.material_id
           where h.shop_id = new.shop_id and e.payload->'data'->>'splitEventId' = new.id::text and h.after_available > h.before_available
        loop
          if pieces.avg is null or pieces.avg <= 0 then all_known := false; end if;
          total_w := total_w + pieces.q * coalesce(pieces.avg, 0);
        end loop;
        for pieces in
          select h.id, h.material_id, coalesce(h.branch_id, 'main') loc, h.after_available - h.before_available q,
                 h.unit_cost old_unit, coalesce(sv.average, private.material_estimate(h.shop_id, h.material_id)) avg
            from public.material_stock_changes h
            join public.ledger_events e on e.shop_id = h.shop_id and e.id = h.id
            left join private.stock_values sv on sv.shop_id = h.shop_id and sv.location = coalesce(h.branch_id, 'main') and sv.material_id = h.material_id
           where h.shop_id = new.shop_id and e.payload->'data'->>'splitEventId' = new.id::text and h.after_available > h.before_available
        loop
          weight := case when all_known and total_w > 0 then pieces.q * pieces.avg / total_w
                         else pieces.q / nullif((select sum(h2.after_available - h2.before_available)
                                from public.material_stock_changes h2 join public.ledger_events e2 on e2.shop_id = h2.shop_id and e2.id = h2.id
                               where h2.shop_id = new.shop_id and e2.payload->'data'->>'splitEventId' = new.id::text
                                 and h2.after_available > h2.before_available), 0) end;
          share := out_v * coalesce(weight, 0);
          -- The piece came in at its own average and as "no cost": it now carries its share instead.
          update private.stock_values set
              value = greatest(0, value - pieces.q * coalesce(pieces.old_unit, 0)) + share,
              average = case when quantity > 0 then (greatest(0, value - pieces.q * coalesce(pieces.old_unit, 0)) + share) / quantity else average end,
              updated_at = now()
            where shop_id = new.shop_id and location = pieces.loc and material_id = pieces.material_id;
          update public.material_stock_changes set unit_cost = share / pieces.q, cost_actual = new.cost_actual
            where shop_id = new.shop_id and id = pieces.id;
        end loop;
        if waste > 0 then
          new.after_values := coalesce(new.after_values, '{}'::jsonb)
            || jsonb_build_object('wasteQuantity', round(-change * waste / 100, 3));
        end if;
      elsif change > 0 then
        -- Pieces put back together: the roll takes their value.
        select coalesce(sum(-(h.after_available - h.before_available) * coalesce(h.unit_cost, 0)), 0) into given
          from public.material_stock_changes h
          join public.ledger_events e on e.shop_id = h.shop_id and e.id = h.id
         where h.shop_id = new.shop_id and e.payload->'data'->>'splitEventId' = new.id::text and h.after_available < h.before_available;
        held := greatest(0, before_q);
        update private.stock_values set
            value = (case when held > 0 then greatest(0, value - change * coalesce(unit, 0)) else 0 end) + given,
            average = case when quantity > 0 then ((case when held > 0 then greatest(0, value - change * coalesce(unit, 0)) else 0 end) + given) / quantity else average end,
            updated_at = now()
          where shop_id = new.shop_id and location = loc and material_id = new.material_id;
        new.unit_cost := given / change;
      end if;
    end if;
  end if;
  return new;
end $f$;
CREATE OR REPLACE FUNCTION public.transfer_stock(p_shop uuid, p_material uuid, p_from text, p_to text, p_quantity numeric, p_reason text DEFAULT ''::text, p_unit_cost numeric DEFAULT NULL::numeric, p_actual_cost boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  here text := coalesce(private.request_branch(p_shop), 'main');
  m public.materials;
  ev uuid := gen_random_uuid();
  label text;
  from_before numeric; to_before numeric;
  locs jsonb; cost_json jsonb;
begin
  perform private.assert_pages(p_shop, array['Materials','Stock History']);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'Enter a quantity greater than zero with at most three decimal places';
  end if;
  if p_from = p_to then raise exception 'Choose two different locations'; end if; if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 100000000000) then raise exception 'Invalid cost per unit'; end if; cost_json := case when p_unit_cost is null then '{}'::jsonb else jsonb_build_object('cost', jsonb_build_object('unitCost', round(p_unit_cost, 2), 'actual', coalesce(p_actual_cost, false))) end;
  select b.settings->'branches' into locs from public.business_settings b where b.shop_id = p_shop;
  if not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_to and not coalesce((x->>'archived')::boolean, false))
     or not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_from and not coalesce((x->>'archived')::boolean, false)) then
    raise exception 'Choose open locations';
  end if;
  if not private.may_send_from(p_shop, p_from) then
    raise exception 'You can send stock only from the location this device works in, or (Admin and higher) from a location you work in';
  end if;
  select * into m from public.materials where shop_id = p_shop and id = p_material and not archived for update;
  if not found then raise exception 'Stock item not found'; end if;
  select coalesce(sm.name, '') into label from public.shop_members sm where sm.shop_id = p_shop and sm.user_id = auth.uid();
  from_before := case when p_from = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_from and material_id = m.id for update), 0) end;
  -- The business's below-zero rule applies to transfers as to any other stock change.
  if from_before - p_quantity < 0 and from_before - p_quantity < from_before and exists (select 1 from public.business_settings s
      where s.shop_id = p_shop and s.settings->'jobs'->>'stockBelowZero' = 'block') then
    raise exception 'Not enough %: % % at the sending location, this needs %. Ask an admin to update the stock first.',
      m.name, trim_scale(greatest(from_before, 0)), m.measurement_unit, trim_scale(p_quantity) using errcode = 'PT409';
  end if;
  to_before := case when p_to = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_to and material_id = m.id for update), 0) end;
  insert into public.ledger_events (shop_id, id, actor_id, payload) values (p_shop, ev, auth.uid(), jsonb_build_object(
    'id', ev, 'kind', 'material.transferred', 'data', jsonb_build_object('id', m.id, 'from', p_from, 'to', p_to,
      'quantity', p_quantity, 'reason', left(btrim(coalesce(p_reason, '')), 500), 'modifiedBy', auth.uid(), 'modifiedAt', now())));
  perform set_config('psl.stock_direct', 'on', true);
  -- The sending side first, so the receiving side arrives at the cost it had there (value_stock_line).
  if p_from <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_from, m.id, from_before - p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', from_before, from_before - p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', from_before, 'to', p_to),
      jsonb_build_object('available', from_before - p_quantity), true, p_from);
  end if;
  -- Each side: the main branch through materials (its own history), others in location_stock.
  if p_from = 'main' or p_to = 'main' then
    update public.materials set available = case when p_from = 'main' then available - p_quantity else available + p_quantity end,
      version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = ev
      where shop_id = p_shop and id = m.id;
  else
    -- Devices pick up the change with their next sync (no main-branch history for this).
    perform set_config('psl.loc_hist', ev::text, true);
    update public.materials set last_event_id = ev where shop_id = p_shop and id = m.id;
  end if;
  if p_to <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_to, m.id, to_before + p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', to_before, to_before + p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', to_before, 'from', p_from),
      jsonb_build_object('available', to_before + p_quantity) || cost_json, true, p_to);
  end if;
  -- The main branch's side is recorded by its own history trigger; tag it with the main branch.
  update public.material_stock_changes set branch_id = null where shop_id = p_shop and id = ev; if p_to = 'main' then update public.material_stock_changes set after_values = coalesce(after_values, '{}'::jsonb) || cost_json where shop_id = p_shop and id = ev; end if;
  perform set_config('psl.stock_direct', '', true);
end $function$;

CREATE OR REPLACE FUNCTION public.transfer_stock(p_operation uuid, p_shop uuid, p_material uuid, p_from text, p_to text, p_quantity numeric, p_reason text DEFAULT ''::text, p_unit_cost numeric DEFAULT NULL::numeric, p_actual_cost boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  here text := coalesce(private.request_branch(p_shop), 'main');
  m public.materials;
  ev uuid := p_operation;
  label text;
  from_before numeric; to_before numeric;
  locs jsonb; cost_json jsonb;
begin
  perform private.assert_pages(p_shop, array['Materials','Stock History']);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_operation is null then raise exception 'Invalid transfer'; end if;
  if exists (select 1 from public.ledger_events where shop_id = p_shop and id = p_operation) then
    if exists (select 1 from public.ledger_events where shop_id = p_shop and id = p_operation and actor_id = auth.uid()
               and payload->>'kind' = 'material.transferred' and payload->'data'->>'id' = p_material::text
               and payload->'data'->>'from' = p_from and payload->'data'->>'to' = p_to
               and (payload->'data'->>'quantity')::numeric = p_quantity) then
      return;
    end if;
    raise exception 'Operation ID already used';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'Enter a quantity greater than zero with at most three decimal places';
  end if;
  if p_from = p_to then raise exception 'Choose two different locations'; end if; if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 100000000000) then raise exception 'Invalid cost per unit'; end if; cost_json := case when p_unit_cost is null then '{}'::jsonb else jsonb_build_object('cost', jsonb_build_object('unitCost', round(p_unit_cost, 2), 'actual', coalesce(p_actual_cost, false))) end;
  select b.settings->'branches' into locs from public.business_settings b where b.shop_id = p_shop;
  if not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_to and not coalesce((x->>'archived')::boolean, false))
     or not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_from and not coalesce((x->>'archived')::boolean, false)) then
    raise exception 'Choose open locations';
  end if;
  if not private.may_send_from(p_shop, p_from) then
    raise exception 'You can send stock only from the location this device works in, or (Admin and higher) from a location you work in';
  end if;
  select * into m from public.materials where shop_id = p_shop and id = p_material and not archived for update;
  if not found then raise exception 'Stock item not found'; end if;
  select coalesce(sm.name, '') into label from public.shop_members sm where sm.shop_id = p_shop and sm.user_id = auth.uid();
  from_before := case when p_from = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_from and material_id = m.id for update), 0) end;
  -- The business's below-zero rule applies to transfers as to any other stock change.
  if from_before - p_quantity < 0 and from_before - p_quantity < from_before and exists (select 1 from public.business_settings s
      where s.shop_id = p_shop and s.settings->'jobs'->>'stockBelowZero' = 'block') then
    raise exception 'Not enough %: % % at the sending location, this needs %. Ask an admin to update the stock first.',
      m.name, trim_scale(greatest(from_before, 0)), m.measurement_unit, trim_scale(p_quantity) using errcode = 'PT409';
  end if;
  to_before := case when p_to = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_to and material_id = m.id for update), 0) end;
  insert into public.ledger_events (shop_id, id, actor_id, payload) values (p_shop, ev, auth.uid(), jsonb_build_object(
    'id', ev, 'kind', 'material.transferred', 'data', jsonb_build_object('id', m.id, 'from', p_from, 'to', p_to,
      'quantity', p_quantity, 'reason', left(btrim(coalesce(p_reason, '')), 500), 'modifiedBy', auth.uid(), 'modifiedAt', now())));
  perform set_config('psl.stock_direct', 'on', true);
  -- The sending side first, so the receiving side arrives at the cost it had there (value_stock_line).
  if p_from <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_from, m.id, from_before - p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', from_before, from_before - p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', from_before, 'to', p_to),
      jsonb_build_object('available', from_before - p_quantity), true, p_from);
  end if;
  -- Each side: the main branch through materials (its own history), others in location_stock.
  if p_from = 'main' or p_to = 'main' then
    update public.materials set available = case when p_from = 'main' then available - p_quantity else available + p_quantity end,
      version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = ev
      where shop_id = p_shop and id = m.id;
  else
    -- Devices pick up the change with their next sync (no main-branch history for this).
    perform set_config('psl.loc_hist', ev::text, true);
    update public.materials set last_event_id = ev where shop_id = p_shop and id = m.id;
  end if;
  if p_to <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_to, m.id, to_before + p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', to_before, to_before + p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', to_before, 'from', p_from),
      jsonb_build_object('available', to_before + p_quantity) || cost_json, true, p_to);
  end if;
  -- The main branch's side is recorded by its own history trigger; tag it with the main branch.
  update public.material_stock_changes set branch_id = null where shop_id = p_shop and id = ev; if p_to = 'main' then update public.material_stock_changes set after_values = coalesce(after_values, '{}'::jsonb) || cost_json where shop_id = p_shop and id = ev; end if;
  perform set_config('psl.stock_direct', '', true);
end $function$;

-- 3. Expenses that buy stock: an amount per stock line (decision 7).
CREATE OR REPLACE FUNCTION private.apply_expense_event(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 d jsonb:=p_event->'data';k text:=p_event->>'kind';eid uuid:=(p_event->>'id')::uuid;xid uuid:=(d->>'id')::uuid;u uuid:=auth.uid();
 old jsonb;nxt jsonb;prior jsonb;prior_actor uuid;label text;audit jsonb;
 lines jsonb:='[]';old_lines jsonb:='[]';line jsonb;old_line jsonb;m public.materials%rowtype;
 total numeric;paid numeric;qty numeric;delta numeric;v_available numeric;mid uuid;stockid uuid;reason text;child jsonb;
 payments jsonb:='[]';p jsonb;day date;delta_count integer:=0;stock_ids jsonb:=d->'stockIds';
begin
 if u is null or not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2) then raise exception 'Business administrator access required';end if;
 if eid is null or xid is null then raise exception 'Missing expense identifier';end if;
 if (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Audit identity must match signed-in staff';end if;
 perform 1 from public.shops where id=p_shop for update;
 select payload,actor_id into prior,prior_actor from public.ledger_events where shop_id=p_shop and id=eid;
 if found then if prior<>p_event or prior_actor<>u then raise exception 'Operation ID already used';end if;return;end if;
 if nullif(d->>'payeeId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='payees' and id=(d->>'payeeId')::uuid and (not coalesce((data->>'archived')::boolean,false) or id::text=(select data->>'payeeId' from public.expenses where shop_id=p_shop and id=(d->>'id')::uuid))) then raise exception 'Choose an active payee from this business';end if;
 if nullif(d->'payment'->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->'payment'->>'accountId')::uuid and not (data->>'archived')::boolean and not coalesce((data->>'hidden')::boolean,false) and (d->'payment'->>'paidOn')::date>=(data->>'openingDate')::date) then raise exception 'Choose an active payment account with a valid opening date';end if;

 select data into old from public.expenses where shop_id=p_shop and id=xid for update;
 if k='expense.created' then if old is not null then raise exception 'Expense ID already exists';end if;
 else
  if old is null then raise exception 'Expense not found' using errcode='P0002';end if;
  if (d->>'baseVersion')::integer is distinct from (old->>'version')::integer then raise exception 'Expense changed elsewhere. Review the business version.' using errcode='PT409';end if;
  if (old->>'voided')::boolean then raise exception 'Voided expense cannot be changed' using errcode='PT409';end if;
 end if;
 select coalesce(nullif(btrim(mb.name),''),au.email,u::text) into label from public.shop_members mb join auth.users au on au.id=mb.user_id where mb.shop_id=p_shop and mb.user_id=u;
 audit:=jsonb_build_object('modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now(),'lastEventId',eid);
 old_lines:=coalesce(old->'materials','[]'::jsonb);
 payments:=coalesce(old->'payments','[]'::jsonb);
 if k in ('expense.created','expense.updated') then
  if jsonb_typeof(d->'description') is distinct from 'string' or length(btrim(d->>'description')) not between 1 and 500 then raise exception 'Enter a description up to 500 characters';end if;
  if jsonb_typeof(d->'category') is distinct from 'string' or length(btrim(d->>'category')) not between 1 and 80 then raise exception 'Enter a category up to 80 characters';end if;
  if jsonb_typeof(d->'payee') is distinct from 'string' or length(d->>'payee')>160 or jsonb_typeof(d->'note') is distinct from 'string' or length(d->>'note')>1000 or jsonb_typeof(d->'receiptReference') is distinct from 'string' or length(d->>'receiptReference')>160 then raise exception 'Supplier, note or receipt reference is invalid';end if;
  if jsonb_typeof(d->'amount') is distinct from 'number' then raise exception 'Expense amount must be numeric';end if;
  total:=(d->>'amount')::numeric;
  if total<=0 or total>100000000000 or total<>trunc(total) then raise exception 'Expense amount must be positive integer kobo';end if;
  if coalesce(d->>'incurredOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid incurred date';end if;
  day:=(d->>'incurredOn')::date;
  if jsonb_typeof(d->'materials') is distinct from 'array' or jsonb_array_length(d->'materials')>50 then raise exception 'Choose at most 50 materials';end if;
  if (select count(*) from jsonb_array_elements(d->'materials'))<>(select count(distinct v->>'materialId') from jsonb_array_elements(d->'materials') v) then raise exception 'Choose each material once';end if;
  for line in select value from jsonb_array_elements(d->'materials') loop
   select * into m from public.materials where shop_id=p_shop and id=(line->>'materialId')::uuid;m:=private.at_location(p_shop,m);
   if not found then raise exception 'Choose a material from this business' using errcode='P0002';end if;
   if jsonb_typeof(line->'quantity') is distinct from 'number' then raise exception 'Purchased quantity must be numeric';end if;
   qty:=(line->>'quantity')::numeric;
   if qty<=0 or qty>1000000000000 or qty<>round(qty,3) then raise exception 'Purchased quantity must be positive with at most three decimal places';end if;
   select v into old_line from jsonb_array_elements(old_lines) v where v->>'materialId'=m.id::text;
   if m.archived and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Restore material before changing purchased quantity' using errcode='PT409';end if;
   if line->>'measurementUnit' is distinct from m.measurement_unit and (old_line is null or (old_line->>'quantity')::numeric<>qty) then raise exception 'Material unit changed. Review purchased quantity.' using errcode='PT409';end if;
   -- A line's own amount (Actual cost method): what this material cost on the expense (kobo).
   if line ? 'amount' and (jsonb_typeof(line->'amount') is distinct from 'number' or (line->>'amount')::numeric<0 or (line->>'amount')::numeric>total or (line->>'amount')::numeric<>trunc((line->>'amount')::numeric)) then raise exception 'Each material''s amount must be whole kobo, up to the expense amount';end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('materialId',m.id,'name',coalesce(old_line->>'name',m.name),'measurementUnit',line->>'measurementUnit','quantity',qty)||case when line ? 'amount' then jsonb_build_object('amount',(line->>'amount')::bigint) else '{}'::jsonb end);
  end loop;
  -- Amounts on stock lines: all or none, and together they are the expense amount.
  if exists (select 1 from jsonb_array_elements(lines) v where v ? 'amount') then
   if exists (select 1 from jsonb_array_elements(lines) v where not v ? 'amount') then raise exception 'Give an amount for every material, or for none';end if;
   if (select sum((v->>'amount')::bigint) from jsonb_array_elements(lines) v)<>total then raise exception 'The materials'' amounts must add up to the expense amount';end if;
  end if;
  if k='expense.updated' and d ? 'payment' then raise exception 'Use Record payment for additional payments';end if;
  nxt:=coalesce(old,'{}'::jsonb)||jsonb_build_object('id',xid,'description',btrim(d->>'description'),'category',btrim(d->>'category'),'incurredOn',day,'amount',total::bigint,'payeeId',coalesce(d->'payeeId',old->'payeeId','null'::jsonb),'jobIds',private.expense_job_ids(p_shop,coalesce(d->'jobIds',old->'jobIds'),lines),'restockIds',private.expense_restock_ids(p_shop,coalesce(d->'restockIds',old->'restockIds'),coalesce(d->'jobIds',old->'jobIds'),lines),'covers',private.expense_covers(case when d ? 'covers' then d->'covers' else coalesce(old->'covers','null'::jsonb) end,day),'payee',btrim(d->>'payee'),'note',btrim(d->>'note'),'receiptReference',btrim(d->>'receiptReference'),'materials',lines,'payments',payments,'voided',false,'voidReason','','version',coalesce((old->>'version')::integer,0)+1,'createdBy',coalesce(old->'createdBy',to_jsonb(u)),'createdByLabel',coalesce(old->'createdByLabel',to_jsonb(label)),'createdAt',coalesce(old->'createdAt',to_jsonb(now())))||audit||private.expense_time(d->'incurredAt',day,'incurredAt');
 elsif k='expense.payment_recorded' then
  nxt:=old||audit||jsonb_build_object('version',(old->>'version')::integer+1);lines:=old_lines;
  if not d ? 'payment' then raise exception 'Payment is required';end if;
 elsif k='expense.voided' then
  if jsonb_typeof(d->'reason') is distinct from 'string' or length(btrim(d->>'reason')) not between 1 and 500 then raise exception 'Enter a void reason up to 500 characters';end if;
  nxt:=old||audit||jsonb_build_object('voided',true,'voidReason',btrim(d->>'reason'),'version',(old->>'version')::integer+1);
 elsif k='expense.payment_corrected' then
  nxt:=old||audit||jsonb_build_object('version',(old->>'version')::integer+1);lines:=old_lines;
  child:=private.correct_expense_payment(payments,d,u,label);payments:=child->'payments';
  nxt:=nxt||jsonb_build_object('payments',payments,'removedPayments',coalesce(old->'removedPayments','[]'::jsonb)||(child->'removed'));child:=null;
 else raise exception 'Unknown expense operation';end if;
 if k in ('expense.created','expense.payment_recorded') and d ? 'payment' then
  p:=d->'payment';
  if (p->>'id')::uuid is null or jsonb_typeof(p->'amount') is distinct from 'number' then raise exception 'Payment identity and amount required';end if;
  paid:=(p->>'amount')::numeric;
  if paid<=0 or paid>100000000000 or paid<>trunc(paid) then raise exception 'Payment must be positive integer kobo';end if;
  if coalesce(p->>'paidOn','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid payment date';end if;
  day:=(p->>'paidOn')::date;
  if coalesce(p->>'method','') not in ('Cash','POS','Transfer','Other') or coalesce(p->>'source','') not in ('Business cash','Business bank account','Personal funds','Other') then raise exception 'Choose payment method and source';end if;
  if jsonb_typeof(p->'reference') is distinct from 'string' or length(p->>'reference')>160 then raise exception 'Invalid payment reference';end if;
  if exists(select 1 from jsonb_array_elements(payments) v where v->>'id'=p->>'id') then raise exception 'Payment ID already used';end if;
  if p ? 'methodLabel' and (jsonb_typeof(p->'methodLabel') is distinct from 'string' or length(btrim(p->>'methodLabel')) not between 1 and 80 or p->>'methodLabel' ~ '[\x00-\x1f\x7f]') then raise exception 'Invalid payment method name';end if;
  p:=jsonb_build_object('accountId',p->'accountId','methodLabel',coalesce(p->>'methodLabel',p->>'method'),'id',(p->>'id')::uuid,'amount',paid::bigint,'paidOn',day,'method',p->>'method','source',p->>'source','reference',btrim(p->>'reference'),'createdBy',u,'createdByLabel',label,'createdAt',now())||private.expense_time(p->'paidAt',day,'paidAt');
  payments:=payments||jsonb_build_array(p);nxt:=nxt||jsonb_build_object('payments',payments);
 end if;
 select coalesce(sum((v->>'amount')::bigint),0) into paid from jsonb_array_elements(payments) v;
 if paid>(nxt->>'amount')::bigint then raise exception 'Recorded payments exceed the expense amount';end if;
 if jsonb_typeof(stock_ids) is distinct from 'object' then raise exception 'Stock update identifiers required';end if;
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,eid,u,p_event);
 if old is null then insert into public.expenses(id,shop_id,data) values(xid,p_shop,nxt);
 else update public.expenses set data=nxt where shop_id=p_shop and id=xid;end if;
 if k<>'expense.payment_recorded' then
  for mid in select distinct (v->>'materialId')::uuid from jsonb_array_elements(old_lines||lines) v order by 1 loop
   select coalesce(sum((v->>'quantity')::numeric),0) into qty from jsonb_array_elements(old_lines) v where (v->>'materialId')::uuid=mid;
   select coalesce(sum((v->>'quantity')::numeric),0)-qty into delta from jsonb_array_elements(lines) v where (v->>'materialId')::uuid=mid;
   if delta=0 then continue;end if;
   delta_count:=delta_count+1;stockid:=(stock_ids->>mid::text)::uuid;
   if stockid is null or stockid=eid then raise exception 'Stock identifier invalid';end if;
   select * into m from public.materials where shop_id=p_shop and id=mid for update;m:=private.at_location(p_shop,m);
   if not found then raise exception 'Material not found' using errcode='P0002';end if;
   select v into old_line from jsonb_array_elements(old_lines) v where (v->>'materialId')::uuid=mid;
   if old_line is not null and old_line->>'measurementUnit' is distinct from m.measurement_unit then raise exception 'Material unit changed. Restore original unit before adjusting purchase.' using errcode='PT409';end if;
   v_available:=m.available+delta;
   if abs(v_available)>1000000000000 then raise exception 'Available quantity exceeds supported limit';end if;
   reason:=left((case when k='expense.voided' then 'Voided purchase' when old is null then 'Purchase restocking' else 'Purchase correction' end)||' · EXP-'||upper(left(replace(xid::text,'-',''),8))||case when k='expense.voided' then ' · '||(nxt->>'voidReason') else '' end,500);
   child:=jsonb_build_object('id',stockid,'kind','material.expense_stock_changed','data',jsonb_build_object('id',mid,'expenseId',xid,'expenseEventId',eid,'quantity',delta,'reason',reason,'modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now())
     -- Stock bought with a line amount is a priced restock (the added part, at the line's price per unit).
     ||coalesce((select jsonb_build_object('cost',jsonb_build_object('supplierPrice',round((v->>'amount')::numeric*delta/(v->>'quantity')::numeric)))
        from jsonb_array_elements(lines) v where (v->>'materialId')::uuid=mid and v ? 'amount' and delta>0 and k<>'expense.voided'),'{}'::jsonb));
   insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,stockid,u,child);
   update public.materials set available=v_available,version=version+1,modified_by=u,modified_by_label=label,modified_at=now(),last_event_id=stockid where shop_id=p_shop and id=mid;
  end loop;
 end if;
 if (select count(*) from jsonb_object_keys(stock_ids))<>delta_count or (select count(distinct value) from jsonb_each_text(stock_ids))<>delta_count then raise exception 'Stock identifiers do not match quantity changes';end if;
 insert into public.expense_changes(id,shop_id,expense_id,data) values(eid,p_shop,xid,jsonb_build_object('id',eid,'expenseId',xid,'action',k,'before',old,'after',nxt,'changedBy',u,'changedByLabel',label,'changedAt',now(),'event',p_event));
end;$function$;
