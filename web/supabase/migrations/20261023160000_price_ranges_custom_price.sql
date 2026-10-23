-- Two more ways to price a service:
-- * Price by quantity range (price_tiers): from a quantity up, a different price per item. The
--   whole quantity is charged at the rate of the range it falls in (private.tier_price).
-- * Price entered at each sale (custom_price): e.g. consultation. The sale carries the price per
--   item that staff typed; the service price is only the suggested amount.
alter table public.services add column if not exists price_tiers jsonb not null default '[]'::jsonb;
alter table public.services add column if not exists custom_price boolean not null default false;

create or replace function private.valid_price_tiers(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(
  jsonb_typeof(p)='array' and jsonb_array_length(p)<=6
  and not exists(select 1 from jsonb_array_elements(p) e where
   jsonb_typeof(e.value) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(e.value) k where k not in ('from','price'))
   or jsonb_typeof(e.value->'from') is distinct from 'number' or jsonb_typeof(e.value->'price') is distinct from 'number'
   or (e.value->>'from')::numeric<>trunc((e.value->>'from')::numeric) or (e.value->>'from')::numeric not between 2 and 1000000
   or (e.value->>'price')::numeric<>trunc((e.value->>'price')::numeric) or (e.value->>'price')::numeric not between 0 and 100000000000)
  and (select count(distinct e.value->'from') from jsonb_array_elements(p) e)=jsonb_array_length(p),
 false) $$;

-- The price per item for a quantity: the rate of its range, else the service price.
create or replace function private.tier_price(base bigint, tiers jsonb, q numeric) returns bigint
language sql immutable set search_path='' as $$
 select coalesce((select (e.value->>'price')::bigint from jsonb_array_elements(coalesce(tiers,'[]'::jsonb)) e
   where (e.value->>'from')::numeric<=q order by (e.value->>'from')::numeric desc limit 1), base) $$;

do $migration$
declare src text; pairs text[][]; i int; fn text;
begin
 -- Saving a service: check and store the ranges and the custom price.
 fn:='public.apply_service_event(uuid,jsonb)';
 src:=pg_get_functiondef(fn::regprocedure);
 pairs:=array[
  array[$a$    if v_data ? 'packPrices' and not private.valid_pack_prices(v_data->'packPrices') then raise exception 'Enter pack prices as a pack size (2 or more) and a price, with no size twice'; end if;$a$,
   $b$    if v_data ? 'packPrices' and not private.valid_pack_prices(v_data->'packPrices') then raise exception 'Enter pack prices as a pack size (2 or more) and a price, with no size twice'; end if;
    if v_data ? 'priceTiers' and not private.valid_price_tiers(v_data->'priceTiers') then raise exception 'Enter quantity ranges as a starting quantity (2 or more) and a price, with no start twice'; end if;
    if v_data ? 'customPrice' and jsonb_typeof(v_data->'customPrice') is distinct from 'boolean' then raise exception 'Choose whether the price is entered at each sale'; end if;
    if jsonb_array_length(coalesce(v_data->'priceTiers',case when v_service_exists then v_service.price_tiers end,'[]'::jsonb))>0
       and jsonb_array_length(coalesce(v_data->'packPrices',case when v_service_exists then v_service.pack_prices end,'[]'::jsonb))>0 then
      raise exception 'Use pack prices or quantity ranges, not both';
    end if;
    if coalesce((v_data->>'customPrice')::boolean,case when v_service_exists then v_service.custom_price end,false) and (
       jsonb_array_length(coalesce(v_data->'priceTiers',case when v_service_exists then v_service.price_tiers end,'[]'::jsonb))>0
       or jsonb_array_length(coalesce(v_data->'packPrices',case when v_service_exists then v_service.pack_prices end,'[]'::jsonb))>0
       or coalesce((v_data->>'shelfItem')::boolean,false) or coalesce((v_data->>'private')::boolean,false)
       or jsonb_array_length(coalesce(v_data->'materialOptions',case when v_service_exists then to_jsonb(v_service.material_options) end,'[]'::jsonb))>0) then
      raise exception 'A service priced at each sale cannot have pack prices, quantity ranges or a choice of materials, or be sold off the shelf or in templates only';
    end if;$b$],
  array[$a$costing,pack_prices,variant_group,$a$, $b$costing,pack_prices,price_tiers,custom_price,variant_group,$b$],
  array[$a$coalesce(v_data->'packPrices','[]'::jsonb),nullif(v_data->>'variantGroup','')::uuid$a$, $b$coalesce(v_data->'packPrices','[]'::jsonb),coalesce(v_data->'priceTiers','[]'::jsonb),coalesce((v_data->>'customPrice')::boolean,false),nullif(v_data->>'variantGroup','')::uuid$b$],
  array[$a$pack_prices=coalesce(v_data->'packPrices',pack_prices),$a$, $b$pack_prices=coalesce(v_data->'packPrices',pack_prices),price_tiers=coalesce(v_data->'priceTiers',price_tiers),custom_price=coalesce((v_data->>'customPrice')::boolean,custom_price),$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception '% changed (part %); review the price ranges migration',fn,i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 -- Devices receive the new fields with each service.
 fn:='public.get_ledger_before_checkout(uuid)';
 src:=pg_get_functiondef(fn::regprocedure);
 pairs:=array[
  array[$a$'packPrices',pack_prices,$a$, $b$'packPrices',pack_prices,'priceTiers',price_tiers,'customPrice',custom_price,$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception '% changed (part %); review the price ranges migration',fn,i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 -- A sale: the price per item is the range rate, or the price typed for a custom-price service.
 fn:='public.apply_checkout_event(uuid,jsonb)';
 src:=pg_get_functiondef(fn::regprocedure);
 pairs:=array[
  array[$a$  if not found or svc.price is distinct from (line->>'unitPrice')::bigint or svc.version$a$,
   $b$  if found and svc.custom_price and (jsonb_typeof(line->'unitPrice') is distinct from 'number' or (line->>'unitPrice')::numeric<0 or (line->>'unitPrice')::numeric>100000000000 or (line->>'unitPrice')::numeric<>trunc((line->>'unitPrice')::numeric)) then raise exception 'Enter the price for %',svc.description;end if;
  if not found or (case when svc.custom_price then (line->>'unitPrice')::bigint else private.tier_price(svc.price,svc.price_tiers,(line->>'quantity')::numeric) end) is distinct from (line->>'unitPrice')::bigint or svc.version$b$],
  array[$a$then private.pack_price(svc.price,pk,q) else round(svc.price*q*w*h) end;$a$, $b$then private.pack_price(svc.price,pk,q) else round((line->>'unitPrice')::numeric*q*w*h) end;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception '% changed (part %); review the price ranges migration',fn,i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $migration$;
