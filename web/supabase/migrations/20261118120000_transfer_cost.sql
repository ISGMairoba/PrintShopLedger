-- Stock moved between locations arrives at what it cost where it left: the sending device sends that
-- location's average cost per unit (p_unit_cost, kobo; p_actual_cost: from real restock prices, not
-- the estimate), stored on the receiving location's stock line as after_values.cost.

do $m$
declare def text; n integer;
  t_head text := 'p_reason text DEFAULT ''''::text)';
  t_decl text := 'locs jsonb;';
  t_check text := 'if p_from = p_to then raise exception ''Choose two different locations''; end if;';
  t_to text := 'jsonb_build_object(''available'', to_before + p_quantity), true, p_to);';
  t_main text := 'update public.material_stock_changes set branch_id = null where shop_id = p_shop and id = ev;';
begin
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.proname = 'transfer_stock' and p.pronargs = 8) then
    return;
  end if;
  def := pg_get_functiondef('public.transfer_stock(uuid,uuid,text,text,numeric,text)'::regprocedure);
  foreach n in array array[
      (length(def) - length(replace(def, t_head, ''))) / length(t_head),
      (length(def) - length(replace(def, t_decl, ''))) / length(t_decl),
      (length(def) - length(replace(def, t_check, ''))) / length(t_check),
      (length(def) - length(replace(def, t_to, ''))) / length(t_to),
      (length(def) - length(replace(def, t_main, ''))) / length(t_main)] loop
    if n <> 1 then raise exception 'transfer_stock: expected text found % times', n; end if;
  end loop;
  def := replace(def, t_head, 'p_reason text DEFAULT ''''::text, p_unit_cost numeric DEFAULT NULL::numeric, p_actual_cost boolean DEFAULT false)');
  def := replace(def, t_decl, 'locs jsonb; cost_json jsonb;');
  def := replace(def, t_check, t_check
    || ' if p_unit_cost is not null and (p_unit_cost < 0 or p_unit_cost > 100000000000) then raise exception ''Invalid cost per unit''; end if;'
    || ' cost_json := case when p_unit_cost is null then ''{}''::jsonb else jsonb_build_object(''cost'', jsonb_build_object(''unitCost'', round(p_unit_cost, 2), ''actual'', coalesce(p_actual_cost, false))) end;');
  def := replace(def, t_to, 'jsonb_build_object(''available'', to_before + p_quantity) || cost_json, true, p_to);');
  def := replace(def, t_main, t_main
    || ' if p_to = ''main'' then update public.material_stock_changes set after_values = coalesce(after_values, ''{}''::jsonb) || cost_json where shop_id = p_shop and id = ev; end if;');
  execute def;
  drop function public.transfer_stock(uuid, uuid, text, text, numeric, text);

  def := pg_get_functiondef('public.answer_stock_request(uuid,uuid,boolean,numeric,text)'::regprocedure);
  if position('p_reply text DEFAULT ''''::text)' in def) = 0 or position('else '''' end);' in def) = 0 then
    raise exception 'answer_stock_request: expected text not found';
  end if;
  def := replace(def, 'p_reply text DEFAULT ''''::text)', 'p_reply text DEFAULT ''''::text, p_unit_cost numeric DEFAULT NULL::numeric, p_actual_cost boolean DEFAULT false)');
  def := replace(def, 'else '''' end);', 'else '''' end, p_unit_cost, p_actual_cost);');
  execute def;
  drop function public.answer_stock_request(uuid, uuid, boolean, numeric, text);
end $m$;

revoke all on function public.transfer_stock(uuid, uuid, text, text, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.transfer_stock(uuid, uuid, text, text, numeric, text, numeric, boolean) to authenticated;
revoke all on function public.answer_stock_request(uuid, uuid, boolean, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.answer_stock_request(uuid, uuid, boolean, numeric, text, numeric, boolean) to authenticated;
