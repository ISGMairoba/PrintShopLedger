-- Shelf items: a service sold off the shelf skips production stages. Checkout records its jobs as
-- Collected straight away (and without a deadline). Existing services stay ordinary services.
alter table public.services add column if not exists shelf_item boolean not null default false;

do $migration$
declare
  def text;
  next text;
  swap text[];
  fn regprocedure;
begin
  for fn, swap in
    select * from (values
      ('public.apply_service_event(uuid,jsonb)'::regprocedure, array[
        $a$if not (v_data ? 'materialId') then raise exception 'Select a base material or No material'; end if;$a$,
        $b$if not (v_data ? 'materialId') then raise exception 'Select a base material or No material'; end if;
    if v_data ? 'shelfItem' and jsonb_typeof(v_data->'shelfItem') is distinct from 'boolean' then raise exception 'Choose whether this is sold off the shelf'; end if;$b$,
        $a$insert into public.services(id,shop_id,description,material_id,price,created_by,created_by_label,modified_by,modified_by_label,last_event_id)
        values(v_id,p_shop,btrim(v_data->>'description'),v_material.id,v_price::bigint,v_user,v_label,v_user,v_label,v_event);$a$,
        $b$insert into public.services(id,shop_id,description,material_id,price,shelf_item,created_by,created_by_label,modified_by,modified_by_label,last_event_id)
        values(v_id,p_shop,btrim(v_data->>'description'),v_material.id,v_price::bigint,coalesce((v_data->>'shelfItem')::boolean,false),v_user,v_label,v_user,v_label,v_event);$b$,
        $a$update public.services set description=btrim(v_data->>'description'),material_id=v_material.id,price=v_price::bigint,$a$,
        $b$update public.services set description=btrim(v_data->>'description'),material_id=v_material.id,price=v_price::bigint,shelf_item=coalesce((v_data->>'shelfItem')::boolean,shelf_item),$b$
      ]),
      ('public.get_ledger_before_checkout(uuid)'::regprocedure, array[
        $a$'materialId',material_id,'price',price,$a$,
        $b$'materialId',material_id,'price',price,'shelfItem',shelf_item,$b$
      ]),
      ('public.apply_checkout_event(uuid,jsonb)'::regprocedure, array[
        $a$net,(d->>'createdAt')::timestamptz,line||jsonb_build_object($a$,
        $b$net,(d->>'createdAt')::timestamptz,case when svc.shelf_item then line-'dueAt' else line-'shelfItem' end||jsonb_build_object($b$,
        $a$'productionStatus','Added','version',1),u,label,now(),e);$a$,
        $b$'productionStatus',case when svc.shelf_item then 'Collected' else 'Added' end,'version',1)||case when svc.shelf_item then jsonb_build_object('shelfItem',true) else '{}'::jsonb end,u,label,now(),e);$b$
      ])
    ) as t(f, s)
  loop
    def := pg_get_functiondef(fn);
    next := def;
    for i in 1 .. array_length(swap, 1) / 2 loop
      if position(swap[2 * i - 1] in next) = 0 then
        raise exception 'Expected text not found in %: %', fn, left(swap[2 * i - 1], 80);
      end if;
      next := replace(next, swap[2 * i - 1], swap[2 * i]);
    end loop;
    execute next;
  end loop;
end
$migration$;
