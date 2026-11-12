-- Materials → Split: cut stock of one material into a smaller one (1 A4 makes 2 A5), or put it
-- back together to fix a mistaken split ("join"). Both stock levels change in one step; each gets
-- its own history entry (the second under the event's toEventId). The app applies the same rules
-- (materials.mjs splitPlan).

alter table public.material_stock_changes drop constraint material_stock_changes_action_check;
alter table public.material_stock_changes add constraint material_stock_changes_action_check check (action = any (array[
  'material.created','material.updated','material.stock_added','material.stock_set','material.archived','material.restored',
  'material.job_used','material.expense_stock_changed','material.wasted','material.sale_returned','material.job_corrected',
  'material.transferred','material.split']));

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('public.apply_material_event(uuid,jsonb)'::regprocedure);
  pat := 'v_minimum\s+numeric;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event declare pattern not found'; end if;
  d := regexp_replace(d, pat, 'v_minimum numeric;
  v_to public.materials%rowtype;
  v_to_event uuid;
  v_qty numeric;
  v_yield numeric;
  v_change numeric;
  v_join boolean;');
  pat := 'else\s+raise\s+exception\s+''Unknown material operation'';\s*end\s+if;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event unknown-operation pattern not found'; end if;
  d := regexp_replace(d, pat, $$elsif v_kind = 'material.split' then
    if v_material.archived then raise exception 'Restore both materials before splitting stock'; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' or jsonb_typeof(v_data -> 'yield') is distinct from 'number' then raise exception 'Enter how many to split and how many one item makes'; end if;
    v_qty := (v_data ->> 'quantity')::numeric; v_yield := (v_data ->> 'yield')::numeric;
    if v_qty <= 0 or v_qty > 1000000000 or v_qty <> round(v_qty, 3) or v_yield <= 0 or v_yield > 1000000000 or v_yield <> round(v_yield, 3) then
      raise exception 'Enter quantities greater than zero, with at most three decimal places';
    end if;
    if v_data ? 'join' and jsonb_typeof(v_data -> 'join') is distinct from 'boolean' then raise exception 'Invalid split'; end if;
    v_join := coalesce((v_data ->> 'join')::boolean, false);
    if length(coalesce(v_data ->> 'reason', '')) > 500 then raise exception 'Stock note is too long'; end if;
    if coalesce(v_data ->> 'toId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_data ->> 'toEventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Choose the other material';
    end if;
    if (v_data ->> 'toId')::uuid = v_id then raise exception 'Choose the other material'; end if;
    select * into v_to from public.materials where id = (v_data ->> 'toId')::uuid and shop_id = p_shop for update;
    if not found then raise exception 'Material not found'; end if;
    v_to := private.at_location(p_shop, v_to);
    if v_to.archived then raise exception 'Restore both materials before splitting stock'; end if;
    if (v_data ->> 'toBaseVersion')::integer is distinct from v_to.version then
      raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = 'PT409';
    end if;
    v_to_event := (v_data ->> 'toEventId')::uuid;
    if exists (select 1 from public.ledger_events where shop_id = p_shop and id = v_to_event) then raise exception 'Operation ID already used'; end if;
    v_change := round(v_qty * v_yield, 3);
    insert into public.ledger_events(shop_id, id, actor_id, payload)
    values (p_shop, v_to_event, v_user, jsonb_build_object('id', v_to_event, 'kind', 'material.split',
      'data', v_data || jsonb_build_object('id', v_to.id, 'fromId', v_id, 'splitEventId', v_event)));
    if abs(v_material.available + case when v_join then v_qty else -v_qty end) > 1000000000000
       or abs(v_to.available + case when v_join then -v_change else v_change end) > 1000000000000 then
      raise exception 'Available quantity is too large';
    end if;
    update public.materials set available = v_material.available + case when v_join then v_qty else -v_qty end,
      modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
    update public.materials set available = v_to.available + case when v_join then -v_change else v_change end,
      modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_to_event
      where id = v_to.id and shop_id = p_shop;
  else raise exception 'Unknown material operation'; end if;$$);
  execute d;

  d := pg_get_functiondef('private.submit_sync_conflict(uuid,jsonb,text)'::regprocedure);
  pat := $$'material.stock_set',$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'submit_sync_conflict pattern not found'; end if;
  execute replace(d, pat, $$'material.stock_set','material.split',$$);
end $patch$;
