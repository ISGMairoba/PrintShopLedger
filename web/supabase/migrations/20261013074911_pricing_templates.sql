-- Optional selling-price templates; settings remain Developer-only. No new public RPC or tables.
-- Formulas are stored as bounded arithmetic trees, never executed as SQL or JavaScript.
begin;
create or replace function private.template_number(n jsonb,t jsonb,inputs jsonb,q numeric,path text[] default '{}',depth integer default 0) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare op text:=n->>'op';args jsonb:=n->'args';key text;i jsonb;d jsonb;a numeric;b numeric;v numeric;
begin
 if depth>80 or jsonb_typeof(args) is distinct from 'array' or op is null then raise exception 'Invalid template formula';end if;
 if op='number' then
  if jsonb_typeof(args->0) is distinct from 'number' or jsonb_array_length(args)<>1 then raise exception 'Invalid formula number';end if;
  v:=(args->>0)::numeric;
 elsif op='variable' then
  key:=args->>0;
  if jsonb_array_length(args)<>1 or key is null then raise exception 'Invalid formula variable';end if;
  if key='quantity' then return q;end if;
  if key=any(path) then raise exception 'Circular template calculation';end if;
  select value into i from jsonb_array_elements(t->'inputs') where value->>'key'=key;
  if found then return (inputs->>key)::numeric;end if;
  select value into d from jsonb_array_elements(t->'derived') where value->>'key'=key;
  if not found then raise exception 'Unknown template variable: %',key;end if;
  return private.template_number(d->'expression',t,inputs,q,array_append(path,key),depth+1);
 else
  if op not in ('+','-','*','/','ceil','floor','round','min','max') or jsonb_array_length(args)<>(case when op in ('ceil','floor','round') then 1 else 2 end) then raise exception 'Unsupported template formula';end if;
  a:=private.template_number(args->0,t,inputs,q,path,depth+1);
  if jsonb_array_length(args)=2 then b:=private.template_number(args->1,t,inputs,q,path,depth+1);end if;
  case op when '+' then v:=a+b;when '-' then v:=a-b;when '*' then v:=a*b;when '/' then if b=0 then raise exception 'Template divides by zero';end if;v:=a/b;
   when 'ceil' then v:=ceil(a);when 'floor' then v:=floor(a);when 'round' then v:=floor(a+0.5);when 'min' then v:=least(a,b);when 'max' then v:=greatest(a,b);end case;
 end if;
 if v is null or abs(v)>1000000000000 then raise exception 'Template calculation is outside the supported range';end if;
 return floor(v*1000000000000+0.5)/1000000000000;
end $$;
revoke all on function private.template_number(jsonb,jsonb,jsonb,numeric,text[],integer) from public,anon,authenticated;

create or replace function private.template_inputs(t jsonb,supplied jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare i jsonb;v numeric;result jsonb:='{}';
begin
 if jsonb_typeof(supplied) is distinct from 'object' or jsonb_typeof(t->'inputs') is distinct from 'array' or jsonb_array_length(t->'inputs')>20 then raise exception 'Invalid template inputs';end if;
 for i in select value from jsonb_array_elements(t->'inputs') loop
  if jsonb_typeof(coalesce(supplied->(i->>'key'),i->'default')) is distinct from 'number' then raise exception 'Template inputs must be numeric';end if;
  v:=coalesce((supplied->>(i->>'key'))::numeric,(i->>'default')::numeric);
  if v is null or v<0 or v>1000000 or v<>round(v,3) or v<(i->>'min')::numeric or v>(i->>'max')::numeric then raise exception 'Template input is out of range';end if;
  if i->>'kind'='choice' and not exists(select 1 from jsonb_array_elements(i->'options') o where (o->>'value')::numeric=v) then raise exception 'Choose a valid template option';end if;
  result:=result||jsonb_build_object(i->>'key',v);
 end loop;
 if exists(select 1 from jsonb_object_keys(supplied) k where not (result ? k)) then raise exception 'Template inputs changed. Review the job.' using errcode='PT409';end if;
 return result;
end $$;
revoke all on function private.template_inputs(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.check_pricing_templates() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb:=new.settings->'pricing';t jsonb;i jsonb;c jsonb;d jsonb;keys text[];ids text[]:='{}';inputs jsonb;v numeric;
begin
 if p is null then return new;end if;
 if jsonb_typeof(p->'enabled') is distinct from 'boolean' or jsonb_typeof(p->'templates') is distinct from 'array' or jsonb_array_length(p->'templates')>30 then raise exception 'Invalid pricing templates';end if;
 for t in select value from jsonb_array_elements(p->'templates') loop
  perform (t->>'id')::uuid;
  if t->>'id' is null or t->>'id'=any(ids) or jsonb_typeof(t->'archived') is distinct from 'boolean' or length(btrim(t->>'name')) not between 1 and 160 or (t->>'version')::numeric<1 or (t->>'version')::numeric<>trunc((t->>'version')::numeric) then raise exception 'Invalid template identity';end if;
  ids:=array_append(ids,t->>'id');keys:=array['quantity'];
  if jsonb_typeof(t->'inputs') is distinct from 'array' or jsonb_array_length(t->'inputs')>20 or jsonb_typeof(t->'derived') is distinct from 'array' or jsonb_array_length(t->'derived')>20 or jsonb_typeof(t->'components') is distinct from 'array' or jsonb_array_length(t->'components') not between 1 and 20 then raise exception 'Invalid template fields';end if;
  for i in select value from jsonb_array_elements(t->'inputs') union all select value from jsonb_array_elements(t->'derived') loop
   if coalesce(i->>'key','') !~ '^[a-zA-Z][a-zA-Z0-9_]{0,39}$' or i->>'key'=any(keys) or i->>'key' in ('ceil','floor','round','min','max') or coalesce(length(btrim(i->>'label')),0) not between 1 and 80 then raise exception 'Invalid template variable';end if;
   keys:=array_append(keys,i->>'key');
  end loop;
  for i in select value from jsonb_array_elements(t->'inputs') loop
   if i->>'kind' not in ('number','choice') or jsonb_typeof(i->'min') is distinct from 'number' or jsonb_typeof(i->'max') is distinct from 'number' or (i->>'min')::numeric<0 or (i->>'max')::numeric>1000000 or (i->>'min')::numeric>(i->>'max')::numeric then raise exception 'Invalid template input';end if;
   if i->>'kind'='choice' and (jsonb_typeof(i->'options') is distinct from 'array' or jsonb_array_length(i->'options') not between 1 and 20) then raise exception 'Invalid template choices';end if;
  end loop;
  inputs:=private.template_inputs(t,'{}');
  for d in select value from jsonb_array_elements(t->'derived') loop perform private.template_number(d->'expression',t,inputs,1,array[d->>'key']);end loop;
  keys:='{}';
  for c in select value from jsonb_array_elements(t->'components') loop
   perform (c->>'id')::uuid;perform (c->>'serviceId')::uuid;
   if c->>'id' is null or c->>'serviceId' is null or c->>'id'=any(keys) or coalesce(length(btrim(c->>'label')),0) not between 1 and 80 then raise exception 'Invalid template component';end if;
   keys:=array_append(keys,c->>'id');
   perform private.template_number(c->'quantityExpression',t,inputs,1);
   if c ? 'widthExpression' then perform private.template_number(c->'widthExpression',t,inputs,1);end if;
   if c ? 'heightExpression' then perform private.template_number(c->'heightExpression',t,inputs,1);end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function private.check_pricing_templates() from public,anon,authenticated;
create trigger check_pricing_templates before insert or update on public.business_settings for each row execute function private.check_pricing_templates();
-- The settings RPC is invoker; its trigger needs permission to run these pure validators.
grant execute on function private.template_number(jsonb,jsonb,jsonb,numeric,text[],integer),private.template_inputs(jsonb,jsonb) to authenticated;

create or replace function private.price_template_snapshot(p_shop uuid,snapshot jsonb,q numeric) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare pricing jsonb;t jsonb;inputs jsonb;c jsonb;s jsonb;components jsonb:='[]';svc public.services%rowtype;mat public.materials%rowtype;qty numeric;w numeric;h numeric;needed numeric;price numeric;count_id uuid;canonical jsonb;event_ids uuid[]:='{}';sid uuid;
begin
 select settings->'pricing' into pricing from public.business_settings where shop_id=p_shop;
 select value into t from jsonb_array_elements(coalesce(pricing->'templates','[]')) where value->>'id'=snapshot->'template'->>'id' and value->'archived'='false'::jsonb;
 if not found or pricing->'enabled' is distinct from 'true'::jsonb or t is distinct from snapshot->'template' then raise exception 'Pricing template changed or is unavailable. Review checkout.' using errcode='PT409';end if;
 if q is null or q<=0 or q>1000000 or q<>round(q,3) then raise exception 'Invalid template quantity';end if;
 inputs:=private.template_inputs(t,snapshot->'inputs');
 if jsonb_typeof(snapshot->'components') is distinct from 'array' or jsonb_array_length(snapshot->'components')<>jsonb_array_length(t->'components') then raise exception 'Template components changed' using errcode='PT409';end if;
 for c in select value from jsonb_array_elements(t->'components') loop
  select value into s from jsonb_array_elements(snapshot->'components') where value->>'id'=c->>'id';
  if not found then raise exception 'Missing template component';end if;
  select * into svc from public.services where shop_id=p_shop and id=(c->>'serviceId')::uuid and not archived;
  if not found then raise exception 'Template item or service is unavailable' using errcode='PT409';end if;
  mat:=null;count_id:=null;
  if svc.material_id is not null then
   select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived for update;
   if not found then raise exception 'Template material is unavailable' using errcode='PT409';end if;
   select id into count_id from public.material_stock_changes where shop_id=p_shop and material_id=mat.id and action='material.stock_set' order by created_at desc,id desc limit 1;
  end if;
  qty:=round(private.template_number(c->'quantityExpression',t,inputs,q),3);
  w:=case when mat.require_size then round(private.template_number(c->'widthExpression',t,inputs,q),3) else 1 end;
  h:=case when mat.require_size then round(private.template_number(c->'heightExpression',t,inputs,q),3) else 1 end;
  if qty<0 or qty>1000000 or w<=0 or w>1000000 or h<=0 or h>1000000 then raise exception 'Invalid template component quantity or dimensions';end if;
  needed:=case when svc.material_id is null then 0 else round(qty*w*h,3) end;price:=round(svc.price*qty*w*h);
  if needed>1000000000000 or (svc.material_id is not null and needed=0 and qty>0) or price>100000000000 then raise exception 'Template calculation exceeds supported range';end if;
  sid:=(s->>'stockEventId')::uuid;if sid is null or sid=any(event_ids) then raise exception 'Invalid template stock identity';end if;event_ids:=array_append(event_ids,sid);
  canonical:=jsonb_build_object('id',c->'id','label',c->'label','stockEventId',sid,'serviceId',svc.id,'service',svc.description,'serviceVersion',svc.version,'unitPrice',svc.price,'quantity',qty,'width',case when mat.require_size then w else null end,'height',case when mat.require_size then h else null end,'amount',price,'materialId',svc.material_id,'materialNeeded',needed,'requireSize',coalesce(mat.require_size,false),'measurementUnit',coalesce(mat.measurement_unit,'item'),'stockCountEventId',count_id);
  if canonical is distinct from s then raise exception 'Template component price, quantity or stock count changed. Review checkout.' using errcode='PT409';end if;
  components:=components||jsonb_build_array(canonical);
 end loop;
 return jsonb_build_object('template',t,'inputs',inputs,'components',components);
end $$;
revoke all on function private.price_template_snapshot(uuid,jsonb,numeric) from public,anon,authenticated;

create or replace function private.deduct_template_stock(p_shop uuid,snapshot jsonb,job_id uuid,checkout_id uuid,actor uuid,label text) returns void
language plpgsql security invoker set search_path='' as $$
declare c jsonb;mid uuid;sid uuid;
begin
 for c in select value from jsonb_array_elements(snapshot->'components') loop
  mid:=(c->>'materialId')::uuid;if mid is null or (c->>'materialNeeded')::numeric=0 then continue;end if;
  sid:=(c->>'stockEventId')::uuid;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,actor,jsonb_build_object('id',sid,'kind','material.job_used','data',jsonb_build_object('id',mid,'jobId',job_id,'checkoutId',checkout_id,'reason','Checkout '||checkout_id||' / Job '||job_id||' / '||(c->>'label'))));
  update public.materials set available=available-(c->>'materialNeeded')::numeric,version=version+1,modified_by=actor,modified_by_label=label,modified_at=now(),last_event_id=sid where shop_id=p_shop and id=mid;
 end loop;
end $$;
revoke all on function private.deduct_template_stock(uuid,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

-- Extend the existing authoritative checkout transaction, preserving wallet/discount/audit rules.
do $migration$
declare def text;start_at integer;end_at integer;old text;next text;
begin
 def:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 start_at:=strpos(def,'  select * into svc from public.services');end_at:=strpos(def,'  if jsonb_typeof(line->''description'')');
 if start_at=0 or end_at<=start_at then raise exception 'Checkout implementation changed; review template integration';end if;
 old:=substr(def,start_at,end_at-start_at);
 next:=$block$  if line ? 'templateSnapshot' then
   if counted ? item_id::text then raise exception 'Template component stock must be reviewed separately';end if;
   line:=jsonb_set(line,'{templateSnapshot}',private.price_template_snapshot(p_shop,line->'templateSnapshot',(line->>'quantity')::numeric));
   q:=(line->>'quantity')::numeric;needed:=0;
   select sum((value->>'amount')::numeric) into calculated from jsonb_array_elements(line->'templateSnapshot'->'components');
   svc:=null;mat:=null;svc.id:=(line->'templateSnapshot'->'template'->>'id')::uuid;svc.description:=line->'templateSnapshot'->'template'->>'name';svc.version:=(line->'templateSnapshot'->'template'->>'version')::integer;svc.price:=round(calculated/q);svc.shelf_item:=false;
   if svc.id is distinct from (line->>'serviceId')::uuid or svc.version is distinct from (line->>'serviceVersion')::integer or svc.price is distinct from (line->>'unitPrice')::bigint or calculated is distinct from coalesce((line->>'grossAmount')::numeric,(line->>'amount')::numeric) or calculated>100000000000 or line->'materialId' is distinct from 'null'::jsonb or line->'requireSize' is distinct from 'false'::jsonb or line->'width' is distinct from 'null'::jsonb or line->'height' is distinct from 'null'::jsonb or (line->>'materialNeeded')::numeric is distinct from 0::numeric then raise exception 'Invalid template job calculation';end if;
  else
$block$||old||E'  end if;\n';
 def:=replace(def,old,next);
 old:=E' end loop;\n if total>100000000000';
 if strpos(def,old)=0 then raise exception 'Checkout loop implementation changed';end if;
 def:=replace(def,old,E'  if line ? ''templateSnapshot'' then perform private.deduct_template_stock(p_shop,line->''templateSnapshot'',item_id,e,u,label);end if;\n end loop;\n if total>100000000000');
 execute def;
 -- Quotations validate template prices without posting jobs, stock or payments.
 def:=pg_get_functiondef('public.apply_quotation_event(uuid,jsonb)'::regprocedure);
 old:='    for line in select value from jsonb_array_elements(d->''lines'') loop';
 if strpos(def,old)=0 then raise exception 'Quotation implementation changed';end if;
 def:=replace(def,old,old||E'\n      if line ? ''templateSnapshot'' then\n       perform private.price_template_snapshot(p_shop,line->''templateSnapshot'',(line->>''quantity'')::numeric);\n       if (line->>''grossAmount'')::numeric is distinct from (select sum((value->>''amount'')::numeric) from jsonb_array_elements(line->''templateSnapshot''->''components'')) then raise exception ''Invalid template quotation amount'';end if;\n      end if;');
 execute def;
 -- Template component resources participate in held-conflict dependency checks.
 def:=pg_get_functiondef('private.sync_resource_keys(uuid,jsonb,boolean,text)'::regprocedure);
 def:=replace(def,'j jsonb;m uuid;', 'j jsonb;component jsonb;m uuid;');
 old:='   select material_id into m from public.services where shop_id=p_shop and id::text=j->>''serviceId'';';
 if strpos(def,old)=0 then raise exception 'Dependency implementation changed';end if;
 def:=replace(def,old,E'   for component in select value from jsonb_array_elements(coalesce(j->''templateSnapshot''->''components'',''[]'')) loop keys:=array_append(keys,''material:''||(component->>''materialId''));keys:=array_append(keys,''service:''||(component->>''serviceId''));end loop;\n'||old);
 execute def;
 -- Existing quantity corrections assume one material: do not allow them to corrupt a bundle.
 def:=pg_get_functiondef('private.apply_supervised_event(uuid,jsonb)'::regprocedure);
 def:=regexp_replace(def,'\mbegin\M',$guard$begin
 if p_event->>'kind' in ('sale.details_corrected','sale.combined_corrected') and exists(select 1 from public.jobs where shop_id=p_shop and id::text=p_event->'data'->>'jobId' and metadata ? 'templateSnapshot') then raise exception 'Template components cannot be changed after checkout. Cancel and create a replacement job; adjust returned materials separately.';end if;
$guard$,'i');
 execute def;
end $migration$;
commit;
