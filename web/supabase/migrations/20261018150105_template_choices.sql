-- Pricing templates may use several items with a choice of materials. The snapshot lists them as
-- "choices"; a template job with two or more keeps one group per item in materialChoice, and
-- production confirms a material for every group. A material may belong to one such item only.
do $mig$
declare src text; pairs text[][]; i int;
begin
 src:=pg_get_functiondef('private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure);
 pairs:=array[
  array[$a$choice jsonb;fm public.materials%rowtype;$a$, $b$choices jsonb:='[]';ci int;fm public.materials%rowtype;$b$],
  array[$a$   if choice is not null and choice->>'serviceId' is distinct from svc.id::text then raise exception 'A template can use only one item with a choice of materials. Review the template.' using errcode='PT409';end if;
   if choice is null then
    select * into fm from public.materials where shop_id=p_shop and id=svc.material_options[1];
    choice:=jsonb_build_object('serviceId',svc.id,'name',svc.description,'options',to_jsonb(svc.material_options),'confirmStage',coalesce(svc.confirm_stage,'Printing'),'unit',coalesce(fm.measurement_unit,'item'),'work',needed);
   else choice:=jsonb_set(choice,'{work}',to_jsonb((choice->>'work')::numeric+needed));end if;$a$, $b$   ci:=(select (zc.zn-1)::int from jsonb_array_elements(choices) with ordinality zc(zv,zn) where zc.zv->>'serviceId'=svc.id::text);
   if ci is null then
    if exists(select 1 from jsonb_array_elements(choices) zc(zv), jsonb_array_elements_text(zc.zv->'options') zo(zt) where zo.zt::uuid=any(svc.material_options)) then raise exception '% shares a material with another item with a choice of materials in this template. Link each material to one item only.',svc.description using errcode='PT409';end if;
    select * into fm from public.materials where shop_id=p_shop and id=svc.material_options[1];
    choices:=choices||jsonb_build_array(jsonb_build_object('serviceId',svc.id,'name',svc.description,'options',to_jsonb(svc.material_options),'confirmStage',coalesce(svc.confirm_stage,'Printing'),'unit',coalesce(fm.measurement_unit,'item'),'work',needed));
   else choices:=jsonb_set(choices,array[ci::text,'work'],to_jsonb((choices->ci->>'work')::numeric+needed));end if;
   if (choices->coalesce(ci,jsonb_array_length(choices)-1)->>'work')::numeric>1000000000000 then raise exception 'Material usage is outside the supported range.';end if;$b$],
  array[$a$case when choice is null then '{}'::jsonb else jsonb_build_object('choice',choice) end;$a$, $b$case when jsonb_array_length(choices)=0 then '{}'::jsonb else jsonb_build_object('choices',choices) end;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'tpl_price changed (part %); review the template choices migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 src:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$   if line->'templateSnapshot' ? 'choice' then
    if line->'materialChoice' is distinct from private.material_choice(array(select o::uuid from jsonb_array_elements_text(line->'templateSnapshot'->'choice'->'options') o),line->'templateSnapshot'->'choice'->>'confirmStage',(line->'templateSnapshot'->'choice'->>'work')::numeric,line->'materialChoice') then raise exception 'The materials for this template changed. Review checkout.' using errcode='PT409';end if;$a$, $b$   if line->'templateSnapshot' ? 'choices' then
    if line->'materialChoice' is distinct from private.template_material_choice(line->'templateSnapshot'->'choices',line->'materialChoice') then raise exception 'The materials for this template changed. Review checkout.' using errcode='PT409';end if;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_checkout_event changed (part %); review the template choices migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 src:=pg_get_functiondef('public.apply_job_material_event(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$ then raise exception 'Choose the material or materials used';end if;$a$, $b$ then raise exception 'Choose the material or materials used';end if;
 select g->>'name' into label from jsonb_array_elements(coalesce(j.metadata->'materialChoice'->'groups','[]'::jsonb)) g
  where not exists(select 1 from jsonb_array_elements(d->'usages') u where g->'options' ? (u->>'materialId')) limit 1;
 if found then raise exception 'Confirm the material used for %.',label;end if;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_job_material_event changed (part %); review the template choices migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;

-- The materialChoice a template job stores (the app builds the same: templateMaterialChoice).
create or replace function private.template_material_choice(p_choices jsonb, p_given jsonb)
 returns jsonb language sql immutable set search_path to '' as $f$
 select case when jsonb_array_length(p_choices)=1 then
   jsonb_build_object('options',p_choices->0->'options','confirmStage',p_choices->0->'confirmStage','work',p_choices->0->'work')
  else jsonb_build_object(
   'options',(select jsonb_agg(o.v order by c.n,o.n) from jsonb_array_elements(p_choices) with ordinality c(v,n), jsonb_array_elements(c.v->'options') with ordinality o(v,n)),
   'confirmStage',p_choices->0->'confirmStage',
   'work',(select sum((c->>'work')::numeric) from jsonb_array_elements(p_choices) c),
   'groups',(select jsonb_agg(jsonb_build_object('name',c.v->'name','options',c.v->'options','unit',c.v->'unit','work',c.v->'work') order by c.n) from jsonb_array_elements(p_choices) with ordinality c(v,n)))
  end $f$;
revoke all on function private.template_material_choice(jsonb,jsonb) from public;
