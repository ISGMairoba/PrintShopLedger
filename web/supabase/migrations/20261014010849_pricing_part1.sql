-- Pricing templates, part 1:
-- * A service can be used in templates with only a formula name; its cost is optional (private
--   items still need one). `<name>_price` in a formula is the service's selling price per unit.
-- * The number of active templates is a business setting (pricing.maxTemplates, default 100, at most
--   500); at most 500 templates in all, archived included.
begin;
create or replace function private.valid_costing(c jsonb) returns boolean
language sql immutable set search_path='' as $$
 select c is null or c='null'::jsonb or coalesce((
  jsonb_typeof(c)='object'
  and not exists(select 1 from jsonb_object_keys(c) k where k not in ('key','amount','per','unit'))
  and jsonb_typeof(c->'key')='string' and c->>'key' ~ '^[a-z][a-z0-9_]{0,39}$' and c->>'key' !~ '_price$'
  and c->>'key' not in ('quantity','ceiling','floor','roundup','round','sum','abs','min','max','if')
  and (not c ? 'amount' or (jsonb_typeof(c->'amount')='number' and (c->>'amount')::numeric between 0 and 100000000000 and (c->>'amount')::numeric=trunc((c->>'amount')::numeric)
   and jsonb_typeof(c->'per')='number' and (c->>'per')::numeric>0 and (c->>'per')::numeric<=1000000 and (c->>'per')::numeric=round((c->>'per')::numeric,3)))
  and (c ? 'amount' or not (c ? 'per' or c ? 'unit'))
  and (not c ? 'unit' or (jsonb_typeof(c->'unit')='string' and length(c->>'unit') between 1 and 40 and c->>'unit'=btrim(c->>'unit') and c->>'unit' !~ '[\x00-\x1f\x7f]'))
 ),false) $$;

do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.apply_service_event(uuid,jsonb)'::regprocedure,array[
   $a$if coalesce((v_data->>'private')::boolean,false) and coalesce(v_data->'costing','null'::jsonb)='null'::jsonb then$a$,
   $b$if coalesce((v_data->>'private')::boolean,false) and not coalesce(v_data->'costing' ? 'amount',false) then$b$
  ]),
  ('private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure,array[
   $a$and id=(o->>'serviceId')::uuid and not archived and costing is not null;$a$,
   $b$and id=(o->>'serviceId')::uuid and not archived and costing ? 'amount';$b$,
   $a$   select * into svc from public.services where shop_id=p_shop and not archived and costing->>'key'=nm;
   if not found then raise exception 'Unknown value "%". Check the template or the cost on its item.',nm using errcode='PT409';end if;
   refs:=refs||jsonb_build_object(nm,private.tpl_ref(p_shop,svc));$a$,
   $b$   select * into svc from public.services where shop_id=p_shop and not archived and costing->>'key'=nm;
   if found then
    if not svc.costing ? 'amount' then raise exception '% has no template cost. Use %_price for its selling price.',svc.description,nm using errcode='PT409';end if;
    refs:=refs||jsonb_build_object(nm,private.tpl_ref(p_shop,svc));
   else
    -- <formula name>_price: the service's selling price per unit, in naira.
    if nm ~ '_price$' then select * into svc from public.services where shop_id=p_shop and not archived and costing->>'key'=left(nm,-6);end if;
    if nm !~ '_price$' or not found then raise exception 'Unknown value "%". Check the template or the formula name on its item.',nm using errcode='PT409';end if;
    refs:=refs||jsonb_build_object(nm,jsonb_build_object('serviceId',svc.id,'key',nm,'name',svc.description,'version',svc.version,'amount',svc.price,'per',1,
     'unit',coalesce((select m.measurement_unit from public.materials m where m.shop_id=p_shop and m.id=svc.material_id),'item'),
     'rate',private.tpl_text(svc.price/100.0),'kind','price'));
   end if;$b$
  ]),
  ('private.check_pricing_templates()'::regprocedure,array[
   $a$or jsonb_array_length(p->'templates')>30 then raise exception 'Invalid pricing templates';end if;$a$,
   $b$or jsonb_array_length(p->'templates')>500
  or (p ? 'maxTemplates' and (jsonb_typeof(p->'maxTemplates') is distinct from 'number' or (p->>'maxTemplates')::numeric not between 1 and 500 or (p->>'maxTemplates')::numeric<>trunc((p->>'maxTemplates')::numeric)))
  then raise exception 'Invalid pricing templates';end if;
 if (select count(*) from jsonb_array_elements(p->'templates') x where x.value->'archived'='false'::jsonb)>coalesce((p->>'maxTemplates')::numeric,100) then
  raise exception 'Your limit is % active templates. Archive one or raise the limit in Business Settings.',coalesce((p->>'maxTemplates')::numeric,100);
 end if;$b$
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
commit;
