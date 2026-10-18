-- Pricing templates: a component linked to an item with a choice of materials takes no stock at
-- the sale. The snapshot carries it as "choice" (one such item per template); the job stores it as
-- materialChoice and confirms the material(s) used in production, like the item sold alone.
do $mig$
declare src text; pairs text[][]; i int;
begin
 src:=pg_get_functiondef('private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure);
 pairs:=array[
  array[$a$sid jsonb;count_id jsonb;
begin$a$, $b$sid jsonb;count_id jsonb;choice jsonb;fm public.materials%rowtype;
begin$b$],
  array[$a$  if svc.material_id is null then continue;end if;$a$, $b$  if svc.material_id is null then
   if cardinality(svc.material_options)=0 then continue;end if;
   x:=(vals->>(f->>'key'))::numeric;needed:=floor(x*1000+0.5)/1000;
   if needed=0 then continue;end if;
   if needed>1000000000000 then raise exception 'Material usage is outside the supported range.';end if;
   if choice is not null and choice->>'serviceId' is distinct from svc.id::text then raise exception 'A template can use only one item with a choice of materials. Review the template.' using errcode='PT409';end if;
   if choice is null then
    select * into fm from public.materials where shop_id=p_shop and id=svc.material_options[1];
    choice:=jsonb_build_object('serviceId',svc.id,'name',svc.description,'options',to_jsonb(svc.material_options),'confirmStage',coalesce(svc.confirm_stage,'Printing'),'unit',coalesce(fm.measurement_unit,'item'),'work',needed);
   else choice:=jsonb_set(choice,'{work}',to_jsonb((choice->>'work')::numeric+needed));end if;
   continue;
  end if;$b$],
  array[$a$
  'stock',stock);$a$, $b$
  'stock',stock)||case when choice is null then '{}'::jsonb else jsonb_build_object('choice',choice) end;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'tpl_price changed (part %); review the template choice migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 src:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$   line:=line-'templateStockIds';$a$, $b$   line:=line-'templateStockIds';
   if line->'templateSnapshot' ? 'choice' then
    if line->'materialChoice' is distinct from private.material_choice(array(select o::uuid from jsonb_array_elements_text(line->'templateSnapshot'->'choice'->'options') o),line->'templateSnapshot'->'choice'->>'confirmStage',(line->'templateSnapshot'->'choice'->>'work')::numeric,line->'materialChoice') then raise exception 'The materials for this template changed. Review checkout.' using errcode='PT409';end if;
   elsif line ? 'materialChoice' then raise exception 'Invalid material choice';end if;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_checkout_event changed (part %); review the template choice migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;
