-- A pricing template item can take stock from a product with variants (stock: {variantGroup}).
-- The variant picked at checkout travels in the snapshot (variantPicks: computed key -> variant
-- item id) and is taken from stock like any item; without a pick, the job confirms which
-- variant(s) were used in production, like an item with a choice of materials.
do $mig$
declare src text; pairs text[][]; i int;
begin
 src:=pg_get_functiondef('private.check_pricing_templates()'::regprocedure);
 pairs:=array[
  array[$a$or (f->'stock'->>'serviceId')::uuid is not null) then$a$, $b$or (f->'stock'->>'serviceId')::uuid is not null or (f->'stock'->>'variantGroup')::uuid is not null) then$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'check_pricing_templates changed (part %); review the template variants migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 src:=pg_get_functiondef('private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure);
 pairs:=array[
  array[$a$choices jsonb:='[]';ci int;fm public.materials%rowtype;$a$, $b$choices jsonb:='[]';ci int;fm public.materials%rowtype;picks jsonb:=coalesce(prior->'variantPicks','{}'::jsonb);vpicks jsonb:='{}';grp uuid;opts uuid[];$b$],
  array[$a$ if jsonb_typeof(supplied) is distinct from 'object' then raise exception 'Invalid template inputs';end if;$a$, $b$ if jsonb_typeof(supplied) is distinct from 'object' then raise exception 'Invalid template inputs';end if;
 if jsonb_typeof(picks) is distinct from 'object' or exists(select 1 from jsonb_each(picks) zp where jsonb_typeof(zp.value) is distinct from 'string'
   or not exists(select 1 from jsonb_array_elements(t->'computed') zc where zc.value->>'key'=zp.key and zc.value->'stock' ? 'variantGroup')) then
  raise exception 'Template variables changed. Review the line.' using errcode='PT409';
 end if;$b$],
  array[$a$  if f->'stock' ? 'variable' then select * into svc from public.services where shop_id=p_shop and id=(selected->>(f->'stock'->>'variable'))::uuid;
  else
$a$, $b$  if f->'stock' ? 'variable' then select * into svc from public.services where shop_id=p_shop and id=(selected->>(f->'stock'->>'variable'))::uuid;
  elsif f->'stock' ? 'variantGroup' then
   grp:=(f->'stock'->>'variantGroup')::uuid;
   opts:=array(select zs.id from public.services zs join public.materials zm on zm.shop_id=zs.shop_id and zm.id=zs.material_id and not zm.archived
     where zs.shop_id=p_shop and zs.variant_group=grp and not zs.archived order by zs.id);
   if cardinality(opts)=0 then raise exception '%: its product is no longer available. Review the template.',f->>'label' using errcode='PT409';end if;
   if picks ? (f->>'key') then
    if not (picks->>(f->>'key'))::uuid=any(opts) then raise exception '%: choose an available variant.',f->>'label' using errcode='PT409';end if;
    select * into svc from public.services where shop_id=p_shop and id=(picks->>(f->>'key'))::uuid;
    vpicks:=vpicks||jsonb_build_object(f->>'key',svc.id);
   else
    x:=(vals->>(f->>'key'))::numeric;needed:=floor(x*1000+0.5)/1000;
    if needed=0 then continue;end if;
    if needed>1000000000000 then raise exception 'Material usage is outside the supported range.';end if;
    ci:=(select (zc.zn-1)::int from jsonb_array_elements(choices) with ordinality zc(zv,zn) where zc.zv->>'serviceId'=grp::text);
    if ci is null then
     select * into svc from public.services where shop_id=p_shop and id=opts[1];
     select * into fm from public.materials where shop_id=p_shop and id=svc.material_id;
     choices:=choices||jsonb_build_array(jsonb_build_object('serviceId',grp,
      'name',case when coalesce(svc.variant_name,'')<>'' and right(svc.description,length(' — '||svc.variant_name))=' — '||svc.variant_name
        then left(svc.description,length(svc.description)-length(' — '||svc.variant_name)) else svc.description end,
      'options',to_jsonb(array(select zs.material_id from public.services zs where zs.shop_id=p_shop and zs.id=any(opts) order by zs.id)),
      'confirmStage',coalesce(svc.confirm_stage,'Printing'),'unit',coalesce(fm.measurement_unit,'item'),'work',needed));
    else choices:=jsonb_set(choices,array[ci::text,'work'],to_jsonb((choices->ci->>'work')::numeric+needed));end if;
    if (choices->coalesce(ci,jsonb_array_length(choices)-1)->>'work')::numeric>1000000000000 then raise exception 'Material usage is outside the supported range.';end if;
    continue;
   end if;
  else
$b$],
  array[$a$'stock',stock)||case when jsonb_array_length(choices)=0 then '{}'::jsonb else jsonb_build_object('choices',choices) end;$a$, $b$'stock',stock)||case when jsonb_array_length(choices)=0 then '{}'::jsonb else jsonb_build_object('choices',choices) end
  ||case when vpicks='{}'::jsonb then '{}'::jsonb else jsonb_build_object('variantPicks',vpicks) end;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'tpl_price changed (part %); review the template variants migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;
