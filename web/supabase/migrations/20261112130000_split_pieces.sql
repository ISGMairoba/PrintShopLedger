-- Materials → Split into several pieces: one A2 into 1 A3 + 1 A4 + 1 A6 + 2 A7, or a 10 ft roll
-- into a 7 ft and a 3 ft roll. The event carries "pieces" (each: toId, toBaseVersion, toEventId,
-- yield = how many one item makes). The pieces don't have to add up to the whole (offcuts).
-- An event with a single toId/yield (from an older app) is read as one piece. Each piece's stock
-- change gets its own history entry under its toEventId. The app applies the same rules
-- (materials.mjs splitPlan).

do $patch$
declare d text; pat text; s integer; e integer;
begin
  d := pg_get_functiondef('public.apply_material_event(uuid,jsonb)'::regprocedure);
  pat := 'v_join\s+boolean;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event declare pattern not found'; end if;
  d := regexp_replace(d, pat, 'v_join boolean;
  v_pieces jsonb;
  v_piece jsonb;
  v_seen uuid[];');

  pat := 'elsif\s+v_kind\s*=\s*''material\.split''\s+then';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event split branch not found'; end if;
  s := regexp_instr(d, pat);
  pat := 'else\s+raise\s+exception\s+''Unknown material operation'';\s*end\s+if;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event unknown-operation pattern not found'; end if;
  e := regexp_instr(d, pat);
  if e <= s then raise exception 'apply_material_event split branch out of order'; end if;

  d := substr(d, 1, s - 1) || $$elsif v_kind = 'material.split' then
    if v_material.archived then raise exception 'Restore both materials before splitting stock'; end if;
    if not v_material.can_split then raise exception 'Turn on "Can be split" for % first', v_material.name; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' then raise exception 'Enter how many to split'; end if;
    v_qty := (v_data ->> 'quantity')::numeric;
    if v_qty <= 0 or v_qty > 1000000000 or v_qty <> round(v_qty, 3) then
      raise exception 'Enter quantities greater than zero, with at most three decimal places';
    end if;
    if v_data ? 'join' and jsonb_typeof(v_data -> 'join') is distinct from 'boolean' then raise exception 'Invalid split'; end if;
    v_join := coalesce((v_data ->> 'join')::boolean, false);
    if length(coalesce(v_data ->> 'reason', '')) > 500 then raise exception 'Stock note is too long'; end if;
    if v_data ? 'pieces' then
      v_pieces := v_data -> 'pieces';
      if jsonb_typeof(v_pieces) is distinct from 'array' or jsonb_array_length(v_pieces) < 1 or jsonb_array_length(v_pieces) > 20 then
        raise exception 'Add between 1 and 20 pieces';
      end if;
    else
      v_pieces := jsonb_build_array(jsonb_build_object('toId', v_data -> 'toId', 'toBaseVersion', v_data -> 'toBaseVersion',
        'toEventId', v_data -> 'toEventId', 'yield', v_data -> 'yield'));
    end if;
    if abs(v_material.available + case when v_join then v_qty else -v_qty end) > 1000000000000 then
      raise exception 'Available quantity is too large';
    end if;
    v_seen := array[v_id];
    for v_piece in select value from jsonb_array_elements(v_pieces) loop
      if jsonb_typeof(v_piece -> 'yield') is distinct from 'number' then raise exception 'Enter how many one item makes'; end if;
      v_yield := (v_piece ->> 'yield')::numeric;
      if v_yield <= 0 or v_yield > 1000000000 or v_yield <> round(v_yield, 3) then
        raise exception 'Enter quantities greater than zero, with at most three decimal places';
      end if;
      if coalesce(v_piece ->> 'toId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(v_piece ->> 'toEventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Choose the other material';
      end if;
      if (v_piece ->> 'toId')::uuid = any (v_seen) then raise exception 'Choose each smaller material once, and not the one being split'; end if;
      v_seen := v_seen || (v_piece ->> 'toId')::uuid;
      select * into v_to from public.materials where id = (v_piece ->> 'toId')::uuid and shop_id = p_shop for update;
      if not found then raise exception 'Material not found'; end if;
      v_to := private.at_location(p_shop, v_to);
      if v_to.archived then raise exception 'Restore both materials before splitting stock'; end if;
      if (v_piece ->> 'toBaseVersion')::integer is distinct from v_to.version then
        raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = 'PT409';
      end if;
      v_to_event := (v_piece ->> 'toEventId')::uuid;
      if v_to_event = v_event or exists (select 1 from public.ledger_events where shop_id = p_shop and id = v_to_event) then
        raise exception 'Operation ID already used';
      end if;
      v_change := round(v_qty * v_yield, 3);
      if abs(v_to.available + case when v_join then -v_change else v_change end) > 1000000000000 then
        raise exception 'Available quantity is too large';
      end if;
      insert into public.ledger_events(shop_id, id, actor_id, payload)
      values (p_shop, v_to_event, v_user, jsonb_build_object('id', v_to_event, 'kind', 'material.split',
        'data', (v_data - 'pieces') || v_piece || jsonb_build_object('id', v_to.id, 'fromId', v_id, 'splitEventId', v_event)));
      update public.materials set available = v_to.available + case when v_join then -v_change else v_change end,
        modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_to_event
        where id = v_to.id and shop_id = p_shop;
    end loop;
    update public.materials set available = v_material.available + case when v_join then v_qty else -v_qty end,
      modified_by = v_user, modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  $$ || substr(d, e);
  execute d;
end $patch$;
