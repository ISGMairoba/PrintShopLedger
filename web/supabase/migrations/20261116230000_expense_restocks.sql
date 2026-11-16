-- Actual profit, part 2: an expense can be for restocks (Expenses → For restocks), e.g. delivery for
-- two materials. Its cost joins those restocks' cost (shared by their supplier price) instead of being
-- an operating expense; a cost linked after some of that stock was used goes, for the used part, to a
-- "late cost adjustment" in profit & loss (worked out on the device: web/src/actual-cost.mjs).
-- data.restockIds: up to 20 stock-history ids of restocks with a supplier price. Not with orders
-- (jobIds) or with stock lines on the same expense.

create or replace function private.expense_restock_ids(p_shop uuid, p_ids jsonb, p_job_ids jsonb, p_lines jsonb)
returns jsonb language plpgsql stable set search_path to '' as $$
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
    where h.shop_id = p_shop and h.action = 'material.stock_added' and h.after_values ? 'cost'
      and h.id::text in (select jsonb_array_elements_text(p_ids));
  if n <> jsonb_array_length(p_ids) then raise exception 'A linked restock was not found (only restocks with a supplier price can be linked)'; end if;
  return p_ids;
end $$;

do $migration$
declare
  def text := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
  t text := $t$'jobIds',private.expense_job_ids(p_shop,coalesce(d->'jobIds',old->'jobIds'),lines),$t$;
  r text := $r$'jobIds',private.expense_job_ids(p_shop,coalesce(d->'jobIds',old->'jobIds'),lines),'restockIds',private.expense_restock_ids(p_shop,coalesce(d->'restockIds',old->'restockIds'),coalesce(d->'jobIds',old->'jobIds'),lines),$r$;
  cnt integer;
begin
  if position('expense_restock_ids' in def) > 0 then raise notice 'Expenses already take restocks'; return; end if;
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 1 then raise exception 'apply_expense_event: place found % times', cnt; end if;
  execute replace(def, t, r);
end $migration$;
