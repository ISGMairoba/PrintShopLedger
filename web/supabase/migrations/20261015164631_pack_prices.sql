-- Pack prices: a product can be sold in packs (e.g. 25 for ₦1,500) as well as by the piece.
-- A sale is priced as packs plus loose pieces: the largest pack first, then smaller packs, then
-- the remaining pieces (and any fraction) at the single price. The app and the server both price
-- it this way and must agree to the kobo.

alter table public.services add column if not exists pack_prices jsonb not null default '[]'::jsonb;

create or replace function private.valid_pack_prices(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(
  jsonb_typeof(p)='array' and jsonb_array_length(p)<=6
  and not exists(select 1 from jsonb_array_elements(p) e where
   jsonb_typeof(e.value) is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(e.value) k where k not in ('quantity','price'))
   or jsonb_typeof(e.value->'quantity') is distinct from 'number' or jsonb_typeof(e.value->'price') is distinct from 'number'
   or (e.value->>'quantity')::numeric<>trunc((e.value->>'quantity')::numeric) or (e.value->>'quantity')::numeric not between 2 and 1000000
   or (e.value->>'price')::numeric<>trunc((e.value->>'price')::numeric) or (e.value->>'price')::numeric not between 1 and 100000000000)
  and (select count(distinct e.value->'quantity') from jsonb_array_elements(p) e)=jsonb_array_length(p),
 false) $$;

-- The packs used for a quantity, largest first: [{quantity, price, count}].
create or replace function private.pack_breakdown(packs jsonb, q numeric) returns jsonb
language plpgsql immutable set search_path='' as $$
declare left_q numeric:=q;pack record;n numeric;result jsonb:='[]'::jsonb;
begin
 for pack in select (e.value->>'quantity')::numeric pq,(e.value->>'price')::numeric pp from jsonb_array_elements(coalesce(packs,'[]'::jsonb)) e order by 1 desc loop
  n:=floor(left_q/pack.pq);
  if n>0 then
   result:=result||jsonb_build_array(jsonb_build_object('quantity',pack.pq,'price',pack.pp,'count',n));
   left_q:=left_q-n*pack.pq;
  end if;
 end loop;
 return result;
end $$;

-- Price in kobo: packs, then the loose pieces at the single price (rounded once).
create or replace function private.pack_price(unit bigint, packs jsonb, q numeric) returns numeric
language sql immutable set search_path='' as $$
 select coalesce(sum((b->>'price')::numeric*(b->>'count')::numeric),0)
  + round(unit*(q-coalesce(sum((b->>'quantity')::numeric*(b->>'count')::numeric),0)))
 from jsonb_array_elements(private.pack_breakdown(packs,q)) b $$;

do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.apply_service_event(uuid,jsonb)'::regprocedure,array[
   $a$    if not private.valid_costing(v_data->'costing') then$a$,
   $b$    if v_data ? 'packPrices' and not private.valid_pack_prices(v_data->'packPrices') then raise exception 'Enter pack prices as a pack size (2 or more) and a price, with no size twice'; end if;
    if not private.valid_costing(v_data->'costing') then$b$,
   $a$      if v_material.archived and (not v_service_exists or v_material.id is distinct from v_service.material_id) then raise exception 'Choose an active base material' using errcode='P0002'; end if;
    end if;$a$,
   $b$      if v_material.archived and (not v_service_exists or v_material.id is distinct from v_service.material_id) then raise exception 'Choose an active base material' using errcode='P0002'; end if;
    end if;
    if coalesce(v_material.require_size,false) and jsonb_array_length(coalesce(v_data->'packPrices',(select s.pack_prices from public.services s where s.shop_id=p_shop and s.id=v_id),'[]'::jsonb))>0 then raise exception 'Pack prices are for items sold by count, not by size'; end if;$b$,
   $a$insert into public.services(id,shop_id,description,material_id,price,shelf_item,private,costing,created_by$a$,
   $b$insert into public.services(id,shop_id,description,material_id,price,shelf_item,private,costing,pack_prices,created_by$b$,
   $a$nullif(v_data->'costing','null'::jsonb),v_user,v_label,v_user,v_label,v_event);$a$,
   $b$nullif(v_data->'costing','null'::jsonb),coalesce(v_data->'packPrices','[]'::jsonb),v_user,v_label,v_user,v_label,v_event);$b$,
   $a$costing=case when v_data ? 'costing' then nullif(v_data->'costing','null'::jsonb) else costing end,$a$,
   $b$costing=case when v_data ? 'costing' then nullif(v_data->'costing','null'::jsonb) else costing end,pack_prices=coalesce(v_data->'packPrices',pack_prices),$b$
  ]),
  ('public.get_ledger_before_checkout(uuid)'::regprocedure,array[
   $a$'costing',costing,$a$,
   $b$'costing',costing,'packPrices',pack_prices,$b$
  ]),
  ('public.apply_checkout_event(uuid,jsonb)'::regprocedure,array[
   $a$declare
 d jsonb:=p_event->'data';$a$,
   $b$declare
 pk jsonb;d jsonb:=p_event->'data';$b$,
   $a$calculated:=round(svc.price*q*w*h);$a$,
   $b$pk:=case when jsonb_array_length(svc.pack_prices)>0 and not coalesce(mat.require_size,false) then svc.pack_prices else '[]'::jsonb end;
  calculated:=case when jsonb_array_length(pk)>0 then private.pack_price(svc.price,pk,q) else round(svc.price*q*w*h) end;
  if coalesce(line->'packBreakdown','[]'::jsonb) is distinct from private.pack_breakdown(pk,q) then raise exception 'Pack prices changed. Review checkout.' using errcode='PT409';end if;$b$
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
