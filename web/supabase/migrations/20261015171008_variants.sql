-- Product variants (colours, sizes…): each variant is its own sellable item with its own stock,
-- grouped under one product. Variants share the product's price and pack prices (the app keeps
-- them in step); each variant is priced on its own, so pieces of different variants never make a pack.

alter table public.services add column if not exists variant_group uuid;
alter table public.services add column if not exists variant_name text;

do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.apply_service_event(uuid,jsonb)'::regprocedure,array[
   $a$    if not private.valid_costing(v_data->'costing') then$a$,
   $b$    if (v_data ? 'variantGroup' and v_data->'variantGroup'<>'null'::jsonb and (jsonb_typeof(v_data->'variantGroup') is distinct from 'string' or (v_data->>'variantGroup') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
     or (v_data ? 'variantName' and v_data->'variantName'<>'null'::jsonb and (jsonb_typeof(v_data->'variantName') is distinct from 'string' or length(btrim(v_data->>'variantName')) not between 1 and 60 or v_data->>'variantName' ~ '[\x00-\x1f\x7f]'))
     or ((coalesce(v_data->'variantGroup','null'::jsonb)='null'::jsonb) <> (coalesce(v_data->'variantName','null'::jsonb)='null'::jsonb)) then
     raise exception 'Give each variant a name of up to 60 characters';
    end if;
    if not private.valid_costing(v_data->'costing') then$b$,
   $a$insert into public.services(id,shop_id,description,material_id,price,shelf_item,private,costing,pack_prices,created_by$a$,
   $b$insert into public.services(id,shop_id,description,material_id,price,shelf_item,private,costing,pack_prices,variant_group,variant_name,created_by$b$,
   $a$coalesce(v_data->'packPrices','[]'::jsonb),v_user,v_label,v_user,v_label,v_event);$a$,
   $b$coalesce(v_data->'packPrices','[]'::jsonb),nullif(v_data->>'variantGroup','')::uuid,nullif(btrim(coalesce(v_data->>'variantName','')),''),v_user,v_label,v_user,v_label,v_event);$b$,
   $a$pack_prices=coalesce(v_data->'packPrices',pack_prices),$a$,
   $b$pack_prices=coalesce(v_data->'packPrices',pack_prices),variant_group=case when v_data ? 'variantGroup' then nullif(v_data->>'variantGroup','')::uuid else variant_group end,variant_name=case when v_data ? 'variantName' then nullif(btrim(coalesce(v_data->>'variantName','')),'') else variant_name end,$b$
  ]),
  ('public.get_ledger_before_checkout(uuid)'::regprocedure,array[
   $a$'packPrices',pack_prices,$a$,
   $b$'packPrices',pack_prices,'variantGroup',variant_group,'variantName',variant_name,$b$
  ])
 ) as x(f,s) loop
  def:=pg_get_functiondef(fn);next:=def;
  for i in 1..array_length(swap,1)/2 loop
   if position(swap[2*i-1] in next)=0 then raise exception 'Expected text not found in %: %',fn,left(swap[2*i-1],90);end if;
   next:=replace(next,swap[2*i-1],swap[2*i]);
  end loop;
  execute next;
 end loop;
end $migration$;
