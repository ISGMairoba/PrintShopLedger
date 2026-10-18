-- Items with a choice of materials may share a material within one template. Each line of a
-- confirmation on a job with several items names its item ("group"); the same material may be
-- used once per item, and every item needs at least one line.
do $mig$
declare src text; pairs text[][]; i int;
begin
 src:=pg_get_functiondef('private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure);
 pairs:=array[
  array[$a$    if exists(select 1 from jsonb_array_elements(choices) zc(zv), jsonb_array_elements_text(zc.zv->'options') zo(zt) where zo.zt::uuid=any(svc.material_options)) then raise exception '% shares a material with another item with a choice of materials in this template. Link each material to one item only.',svc.description using errcode='PT409';end if;
$a$, '']
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'tpl_price changed (part %); review the shared choice materials migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;

 src:=pg_get_functiondef('public.apply_job_material_event(uuid,jsonb)'::regprocedure);
 pairs:=array[
  array[$a$mats uuid[]:='{}';opts jsonb;$a$, $b$mats uuid[]:='{}';opts jsonb;grps jsonb;gk text[]:='{}';gi int;$b$],
  array[$a$ if jsonb_typeof(d->'usages') is distinct from 'array' or jsonb_array_length(d->'usages') not between 1 and jsonb_array_length(opts) then raise exception 'Choose the material or materials used';end if;
 select g->>'name' into label from jsonb_array_elements(coalesce(j.metadata->'materialChoice'->'groups','[]'::jsonb)) g
  where not exists(select 1 from jsonb_array_elements(d->'usages') u where g->'options' ? (u->>'materialId')) limit 1;
 if found then raise exception 'Confirm the material used for %.',label;end if;$a$, $b$ grps:=j.metadata->'materialChoice'->'groups';
 if jsonb_typeof(d->'usages') is distinct from 'array' or jsonb_array_length(d->'usages') not between 1 and (case when grps is null then jsonb_array_length(opts) else (select sum(jsonb_array_length(x->'options'))::int from jsonb_array_elements(grps) x) end) then raise exception 'Choose the material or materials used';end if;$b$],
  array[$a$k not in ('id','materialId','quantity')$a$, $b$k not in ('id','materialId','quantity','group')$b$],
  array[$a$  if not opts ? (usage->>'materialId') or (usage->>'materialId')::uuid=any(mats) then raise exception 'Choose each material linked to this service at most once';end if;$a$, $b$  if grps is null then
   if usage ? 'group' or not opts ? (usage->>'materialId') or (usage->>'materialId')::uuid=any(mats) then raise exception 'Choose each material linked to this service at most once';end if;
  else
   if jsonb_typeof(usage->'group') is distinct from 'number' then raise exception 'Choose a material linked to each item';end if;
   if (usage->>'group')::numeric<>trunc((usage->>'group')::numeric) or (usage->>'group')::numeric<0 or (usage->>'group')::numeric>=jsonb_array_length(grps) then raise exception 'Choose a material linked to each item';end if;
   if not grps->((usage->>'group')::int)->'options' ? (usage->>'materialId') then raise exception 'Choose a material linked to each item';end if;
   if ((usage->>'group')::int)::text||':'||(usage->>'materialId')=any(gk) then raise exception 'Choose each material once per item. To use more of one, raise its amount.';end if;
   gk:=array_append(gk,((usage->>'group')::int)::text||':'||(usage->>'materialId'));
  end if;$b$],
  array[$a$ update public.jobs set metadata=metadata||jsonb_build_object('materialUsed'$a$, $b$ if grps is not null then
  select (g.n-1)::int into gi from jsonb_array_elements(grps) with ordinality g(v,n)
   where not exists(select 1 from jsonb_array_elements(d->'usages') u where (u->>'group')::int=g.n-1) limit 1;
  if found then raise exception 'Confirm the material used for %.',grps->gi->>'name';end if;
 end if;
 update public.jobs set metadata=metadata||jsonb_build_object('materialUsed'$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  pairs[i][1]:=replace(pairs[i][1],chr(13),'');pairs[i][2]:=replace(pairs[i][2],chr(13),'');
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'apply_job_material_event changed (part %); review the shared choice materials migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;

-- A material shared by two items is listed once in the job's options.
create or replace function private.template_material_choice(p_choices jsonb, p_given jsonb)
 returns jsonb language sql immutable set search_path to '' as $f$
 select case when jsonb_array_length(p_choices)=1 then
   jsonb_build_object('options',p_choices->0->'options','confirmStage',p_choices->0->'confirmStage','work',p_choices->0->'work')
  else jsonb_build_object(
   'options',(select jsonb_agg(x.v order by x.p) from (select o.v, min(c.n*100000+o.n) p from jsonb_array_elements(p_choices) with ordinality c(v,n), jsonb_array_elements(c.v->'options') with ordinality o(v,n) group by o.v) x),
   'confirmStage',p_choices->0->'confirmStage',
   'work',(select sum((c->>'work')::numeric) from jsonb_array_elements(p_choices) c),
   'groups',(select jsonb_agg(jsonb_build_object('name',c.v->'name','options',c.v->'options','unit',c.v->'unit','work',c.v->'work') order by c.n) from jsonb_array_elements(p_choices) with ordinality c(v,n)))
  end $f$;
revoke all on function private.template_material_choice(jsonb,jsonb) from public;
