-- Extra costs of a split (plans/actual-cost-v2.md, decision 4, owner's addition): cutting or
-- transport for a split, recorded as an expense linked to the split (from the split screen, or later
-- from Expenses like a late delivery bill). Its amount goes to the pieces' value, shared by each
-- piece's value (equally per unit when unknown). The part for pieces still in stock joins their value;
-- the part for pieces already used is a late cost. Editing or voiding the expense moves the difference.

-- Linkable: restocks with a supplier price, and splits (the roll's line of a split, not of a join).
create or replace function private.expense_restock_ids(p_shop uuid, p_ids jsonb, p_job_ids jsonb, p_lines jsonb)
returns jsonb language plpgsql stable set search_path to '' as $f$
declare n integer;
begin
  if p_ids is null or p_ids = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) > 20 then raise exception 'Link the expense to up to 20 restocks'; end if;
  if jsonb_array_length(p_ids) = 0 then return p_ids; end if;
  if exists (select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x) <> 'string'
             or x #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'A linked restock was not found';
  end if;
  if (select count(distinct x) from jsonb_array_elements_text(p_ids) x) <> jsonb_array_length(p_ids) then raise exception 'Link each restock once'; end if;
  if jsonb_array_length(coalesce(p_job_ids, '[]'::jsonb)) > 0 then raise exception 'Link an expense to orders or to restocks, not both'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then raise exception 'A stock purchase is not linked to restocks'; end if;
  select count(*) into n from public.material_stock_changes h
    where h.shop_id = p_shop and h.id::text in (select jsonb_array_elements_text(p_ids))
      and ((h.action = 'material.stock_added' and h.after_values ? 'cost')
        or (h.action = 'material.split' and h.after_available < h.before_available));
  if n <> jsonb_array_length(p_ids) then
    raise exception 'A linked restock was not found (only restocks with a supplier price, or splits, can be linked)';
  end if;
  return p_ids;
end $f$;

create or replace function private.split_extra_to_pieces(p_shop uuid, p_expense uuid, p_split uuid, p_delta numeric)
returns void language plpgsql security definer set search_path to '' as $f$
declare p record; total_w numeric := 0; total_q numeric := 0; all_known boolean := true; part numeric; held numeric; joined numeric;
begin
  for p in
    select h.after_available - h.before_available q, h.unit_cost u
      from public.material_stock_changes h join public.ledger_events e on e.shop_id = h.shop_id and e.id = h.id
     where h.shop_id = p_shop and e.payload->'data'->>'splitEventId' = p_split::text and h.after_available > h.before_available
  loop
    if p.u is null or p.u <= 0 then all_known := false; end if;
    total_w := total_w + p.q * coalesce(p.u, 0);
    total_q := total_q + p.q;
  end loop;
  if total_q <= 0 then
    -- No pieces found: the whole amount is a late cost on the roll.
    insert into private.late_costs(shop_id, expense_id, restock_id, material_id, location, amount)
    select p_shop, p_expense, p_split, material_id, coalesce(branch_id, 'main'), p_delta
      from public.material_stock_changes where shop_id = p_shop and id = p_split;
    return;
  end if;
  for p in
    select h.material_id, coalesce(h.branch_id, 'main') loc, h.after_available - h.before_available q, h.unit_cost u
      from public.material_stock_changes h join public.ledger_events e on e.shop_id = h.shop_id and e.id = h.id
     where h.shop_id = p_shop and e.payload->'data'->>'splitEventId' = p_split::text and h.after_available > h.before_available
  loop
    part := p_delta * case when all_known and total_w > 0 then p.q * p.u / total_w else p.q / total_q end;
    select greatest(0, quantity) into held from private.stock_values where shop_id = p_shop and location = p.loc and material_id = p.material_id;
    joined := part * least(1, coalesce(held, 0) / p.q);
    update private.stock_values set value = greatest(0, value + joined),
        average = case when quantity > 0 then greatest(0, value + joined) / quantity else average end, updated_at = now()
      where shop_id = p_shop and location = p.loc and material_id = p.material_id;
    if round(part - joined, 4) <> 0 then
      insert into private.late_costs(shop_id, expense_id, restock_id, material_id, location, amount)
      values (p_shop, p_expense, p_split, p.material_id, p.loc, part - joined);
    end if;
  end loop;
end $f$;
revoke all on function private.split_extra_to_pieces(uuid, uuid, uuid, numeric) from public, anon, authenticated;

create or replace function private.apply_restock_extras(p_shop uuid, p_expense uuid, p_data jsonb)
returns void language plpgsql security definer set search_path to '' as $f$
declare h record; want numeric; had numeric; delta numeric; received numeric; held numeric; joined numeric;
  total numeric; n integer; linked uuid[];
begin
  linked := case when coalesce((p_data->>'voided')::boolean, false) or jsonb_typeof(p_data->'restockIds') is distinct from 'array'
    then '{}'::uuid[] else array(select value::uuid from jsonb_array_elements_text(p_data->'restockIds')) end;
  -- Shared by supplier price; equally when none has one (a split has none).
  select coalesce(sum((after_values->'cost'->>'supplierPrice')::numeric), 0), count(*) into total, n
    from public.material_stock_changes where shop_id = p_shop and id = any (linked);
  for h in
    select l.id, l.action, l.material_id, coalesce(l.branch_id, 'main') loc, l.after_available - l.before_available got,
           coalesce((l.after_values->'cost'->>'supplierPrice')::numeric, 0) price
      from public.material_stock_changes l
     where l.shop_id = p_shop and (l.id = any (linked) or l.id in (select restock_id from private.restock_extras where shop_id = p_shop and expense_id = p_expense))
  loop
    want := case when not h.id = any (linked) or n = 0 then 0
                 when total > 0 then (p_data->>'amount')::numeric * h.price / total
                 else (p_data->>'amount')::numeric / n end;
    select amount into had from private.restock_extras where shop_id = p_shop and expense_id = p_expense and restock_id = h.id;
    delta := want - coalesce(had, 0);
    if delta = 0 then continue; end if;
    -- An extra cost of a split (cutting, transport): it goes to the pieces, shared by their value
    -- (equally per unit when unknown); each piece's part still held joins its stock, the rest is late.
    if h.action = 'material.split' then
      perform private.split_extra_to_pieces(p_shop, p_expense, h.id, delta);
      insert into private.restock_extras values (p_shop, p_expense, h.id, want)
        on conflict (shop_id, expense_id, restock_id) do update set amount = excluded.amount;
      continue;
    end if;
    -- The newest stock counts as used last: the units of this delivery still held are the stock held,
    -- up to what it brought.
    select greatest(0, quantity) into held from private.stock_values where shop_id = p_shop and location = h.loc and material_id = h.material_id;
    received := greatest(0, h.got);
    joined := case when received > 0 then delta * least(1, coalesce(held, 0) / received) else 0 end;
    update private.stock_values set value = greatest(0, value + joined),
        average = case when quantity > 0 then greatest(0, value + joined) / quantity else average end, updated_at = now()
      where shop_id = p_shop and location = h.loc and material_id = h.material_id;
    if round(delta - joined, 4) <> 0 then
      insert into private.late_costs(shop_id, expense_id, restock_id, material_id, location, amount)
      values (p_shop, p_expense, h.id, h.material_id, h.loc, delta - joined);
    end if;
    insert into private.restock_extras values (p_shop, p_expense, h.id, want)
      on conflict (shop_id, expense_id, restock_id) do update set amount = excluded.amount;
  end loop;
end $f$;
revoke all on function private.apply_restock_extras(uuid, uuid, jsonb) from public, anon, authenticated;
