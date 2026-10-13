-- Pricing templates on the Costora model: editable variables, computed variables, expenses and a
-- markup/margin rule with a minimum, a maximum discount and rounding. Costs come from services and
-- products with a template cost; private ones are used only by templates and can never be sold.
-- The server repeats every calculation (exact decimals, 12 places per step) and refuses a sale or
-- quotation whose template price, costs, discount or stock differ. Replaces the component-sum model
-- of 20261013074911 (no shop had saved templates or template jobs when this was written).
begin;

-- ------------------------------------------------------------------ service costs
alter table public.services add column if not exists private boolean not null default false;
alter table public.services add column if not exists costing jsonb;

create or replace function private.valid_costing(c jsonb) returns boolean
language sql immutable set search_path='' as $$
 select c is null or c='null'::jsonb or coalesce((
  jsonb_typeof(c)='object'
  and not exists(select 1 from jsonb_object_keys(c) k where k not in ('key','amount','per','unit'))
  and jsonb_typeof(c->'key')='string' and c->>'key' ~ '^[a-z][a-z0-9_]{0,39}$'
  and c->>'key' not in ('quantity','ceiling','floor','roundup','round','sum','abs','min','max','if')
  and jsonb_typeof(c->'amount')='number' and (c->>'amount')::numeric between 0 and 100000000000 and (c->>'amount')::numeric=trunc((c->>'amount')::numeric)
  and jsonb_typeof(c->'per')='number' and (c->>'per')::numeric>0 and (c->>'per')::numeric<=1000000 and (c->>'per')::numeric=round((c->>'per')::numeric,3)
  and (not c ? 'unit' or (jsonb_typeof(c->'unit')='string' and length(c->>'unit') between 1 and 40 and c->>'unit'=btrim(c->>'unit') and c->>'unit' !~ '[\x00-\x1f\x7f]'))
 ),false) $$;
revoke all on function private.valid_costing(jsonb) from public,anon,authenticated;
alter table public.services add constraint services_costing_valid check (private.valid_costing(costing));
alter table public.services add constraint services_private_costed check (not private or costing is not null);
create unique index if not exists services_costing_key on public.services(shop_id,(costing->>'key')) where costing is not null and not archived;

-- ------------------------------------------------------------------ exact decimal helpers
-- Values carry at most 12 decimal places. Division and steps use integer arithmetic, so results
-- match the app exactly (floor((2n+d)/2d) is round half up).
create or replace function private.tpl_fdiv(n numeric,d numeric) returns numeric
language sql immutable set search_path='' as $$ select case when n>=0 then div(n,d) else -div(-n+d-1,d) end $$;
create or replace function private.tpl_r12(v numeric) returns numeric
language sql immutable set search_path='' as $$ select floor(v*1000000000000+0.5)/1000000000000 $$;
create or replace function private.tpl_div(a numeric,b numeric) returns numeric
language plpgsql immutable set search_path='' as $$
declare x numeric:=round(a*1000000000000);y numeric:=round(b*1000000000000);
begin
 if y=0 then raise exception 'A formula divides by zero.';end if;
 if y<0 then x:=-x;y:=-y;end if;
 return private.tpl_fdiv(2*x*1000000000000+y,2*y)/1000000000000;
end $$;
-- a/b rounded to 9 places: rounding steps ignore smaller leftovers, so 2/3*3 rounds up to 2.
create or replace function private.tpl_snap(a numeric,b numeric) returns numeric
language sql immutable set search_path='' as $$
 select private.tpl_fdiv(2*round(a*1000000000000)*1000000000+round(b*1000000000000),2*round(b*1000000000000))/1000000000 $$;
create or replace function private.tpl_text(v numeric) returns text
language sql immutable set search_path='' as $$ select trim_scale(v)::text $$;

-- ------------------------------------------------------------------ formulas
create or replace function private.tpl_eval(n jsonb,vals jsonb,depth integer default 0) returns numeric
language plpgsql immutable set search_path='' as $$
declare op text:=n->>'op';args jsonb:=n->'args';c integer;v numeric[]:='{}';r numeric;a jsonb;k numeric;s numeric;
begin
 if depth>64 or jsonb_typeof(args) is distinct from 'array' or op is null then raise exception 'Formula is too complex.';end if;
 c:=jsonb_array_length(args);
 if op='number' then
  if c<>1 or jsonb_typeof(args->0) is distinct from 'string' or args->>0 !~ '^\d{1,13}(\.\d{1,12})?$' then raise exception 'Invalid formula number';end if;
  return (args->>0)::numeric;
 elsif op='name' then
  if c<>1 or jsonb_typeof(args->0) is distinct from 'string' or not vals ? (args->>0) then raise exception 'Unknown value "%".',args->>0;end if;
  return (vals->>(args->>0))::numeric;
 elsif op='IF' then
  if c<>3 then raise exception 'IF takes 3 values.';end if;
  if private.tpl_eval(args->0,vals,depth+1)=0 then return private.tpl_eval(args->2,vals,depth+1);end if;
  return private.tpl_eval(args->1,vals,depth+1);
 end if;
 if not ((op in ('+','-','*','/','>','<','>=','<=','==','!=') and c=2) or (op in ('CEILING','FLOOR') and c between 1 and 2)
   or (op in ('ROUNDUP','ROUND') and c=2) or (op='SUM' and c between 1 and 50) or (op='ABS' and c=1) or (op in ('MIN','MAX') and c between 2 and 10)) then
  raise exception 'Unsupported formula: %',op;
 end if;
 for a in select value from jsonb_array_elements(args) loop v:=array_append(v,private.tpl_eval(a,vals,depth+1));end loop;
 case op
  when '+' then r:=v[1]+v[2];
  when '-' then r:=v[1]-v[2];
  when '*' then r:=v[1]*v[2];
  when '/' then r:=private.tpl_div(v[1],v[2]);
  when '>' then r:=case when private.tpl_snap(v[1],1)>private.tpl_snap(v[2],1) then 1 else 0 end;
  when '<' then r:=case when private.tpl_snap(v[1],1)<private.tpl_snap(v[2],1) then 1 else 0 end;
  when '>=' then r:=case when private.tpl_snap(v[1],1)>=private.tpl_snap(v[2],1) then 1 else 0 end;
  when '<=' then r:=case when private.tpl_snap(v[1],1)<=private.tpl_snap(v[2],1) then 1 else 0 end;
  when '==' then r:=case when private.tpl_snap(v[1],1)=private.tpl_snap(v[2],1) then 1 else 0 end;
  when '!=' then r:=case when private.tpl_snap(v[1],1)<>private.tpl_snap(v[2],1) then 1 else 0 end;
  when 'CEILING','FLOOR' then
   s:=coalesce(v[2],1);
   if s<=0 then raise exception '%: the rounding step must be more than zero.',op;end if;
   k:=private.tpl_snap(v[1],s);
   r:=case when op='CEILING' then ceil(k) else floor(k) end*s;
  when 'ROUND','ROUNDUP' then
   if v[2]<>trunc(v[2]) then raise exception '%: decimal places must be a whole number.',op;end if;
   if v[2] not between -6 and 6 then raise exception '%: decimal places must be from -6 to 6.',op;end if;
   k:=private.tpl_snap(abs(v[1])*(10::numeric^v[2]::integer),1);
   r:=case when op='ROUND' then floor(k+0.5) else ceil(k) end/(10::numeric^v[2]::integer);
   if v[1]<0 then r:=-r;end if;
  when 'SUM' then select sum(x) into r from unnest(v) x;
  when 'ABS' then r:=abs(v[1]);
  when 'MIN' then select min(x) into r from unnest(v) x;
  when 'MAX' then select max(x) into r from unnest(v) x;
 end case;
 r:=private.tpl_r12(r);
 if abs(r)>1000000000000 then raise exception 'Calculation exceeds supported limits.';end if;
 return r;
end $$;
create or replace function private.tpl_names(n jsonb,depth integer default 0) returns text[]
language plpgsql immutable set search_path='' as $$
declare a jsonb;out text[]:='{}';
begin
 if depth>64 then raise exception 'Formula is too complex.';end if;
 if n->>'op'='name' then return array[n->'args'->>0];end if;
 if n->>'op'='number' or jsonb_typeof(n->'args') is distinct from 'array' then return '{}';end if;
 for a in select value from jsonb_array_elements(n->'args') loop out:=out||private.tpl_names(a,depth+1);end loop;
 return out;
end $$;
-- Shape check for a stored formula tree; returns its size.
create or replace function private.tpl_check_tree(n jsonb,depth integer default 0) returns integer
language plpgsql immutable set search_path='' as $$
declare op text:=n->>'op';args jsonb:=n->'args';c integer;a jsonb;total integer:=1;
begin
 if depth>64 or jsonb_typeof(n) is distinct from 'object' or jsonb_typeof(args) is distinct from 'array' or op is null then raise exception 'Invalid template formula';end if;
 if exists(select 1 from jsonb_object_keys(n) k where k not in ('op','args')) then raise exception 'Invalid template formula';end if;
 c:=jsonb_array_length(args);
 if op='number' then
  if c<>1 or jsonb_typeof(args->0) is distinct from 'string' or args->>0 !~ '^\d{1,13}(\.\d{1,12})?$' or (args->>0)::numeric>1000000000000 then raise exception 'Invalid formula number';end if;
  return 1;
 elsif op='name' then
  if c<>1 or jsonb_typeof(args->0) is distinct from 'string' or args->>0 !~ '^[a-z][a-z0-9_]{0,39}$' then raise exception 'Invalid formula name';end if;
  return 1;
 elsif not ((op in ('+','-','*','/','>','<','>=','<=','==','!=') and c=2) or (op in ('CEILING','FLOOR') and c between 1 and 2)
   or (op in ('ROUNDUP','ROUND') and c=2) or (op='SUM' and c between 1 and 50) or (op='ABS' and c=1) or (op in ('MIN','MAX') and c between 2 and 10) or (op='IF' and c=3)) then
  raise exception 'Unsupported template formula';
 end if;
 for a in select value from jsonb_array_elements(args) loop total:=total+private.tpl_check_tree(a,depth+1);end loop;
 if total>600 then raise exception 'Template formula is too complex';end if;
 return total;
end $$;

-- ------------------------------------------------------------------ pricing
create or replace function private.tpl_ref(p_shop uuid,svc public.services) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('serviceId',svc.id,'key',svc.costing->>'key','name',svc.description,'version',svc.version,
  'amount',svc.costing->'amount','per',svc.costing->'per','unit',coalesce((select m.measurement_unit from public.materials m where m.shop_id=p_shop and m.id=svc.material_id),'item'),
  'rate',private.tpl_text(private.tpl_div((svc.costing->>'amount')::numeric/100,(svc.costing->>'per')::numeric)))
  ||case when svc.costing ? 'unit' then jsonb_build_object('purchaseUnit',svc.costing->'unit') else '{}'::jsonb end $$;

-- The full template snapshot, exactly as the app builds it. `prior` is the app's snapshot: its stock
-- event ids are reused; for a quotation (p_checkout false) its stock-count ids too, and no rows are locked.
create or replace function private.tpl_price(p_shop uuid,t jsonb,supplied jsonb,q numeric,prior jsonb,p_checkout boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v jsonb;o jsonb;f jsonb;x numeric;raw jsonb;inputs jsonb:='{}';vals jsonb;nm text;tnames text[]:='{}';refs jsonb:='{}';
 svc public.services%rowtype;mat public.materials%rowtype;selected jsonb:='{}';formulas jsonb:='{}';todo text[]:='{}';left_over text[];
 progress boolean;outputs jsonb:='[]';expenses jsonb:='[]';cost numeric:=0;rate numeric;fl numeric;rawp numeric;minp numeric;stp numeric;
 amount numeric;minimum numeric;stock jsonb:='[]';needed numeric;idx integer;sid jsonb;count_id jsonb;
begin
 if jsonb_typeof(supplied) is distinct from 'object' then raise exception 'Invalid template inputs';end if;
 if exists(select 1 from jsonb_object_keys(supplied) k where k='quantity' or not exists(select 1 from jsonb_array_elements(t->'variables') y where y.value->>'key'=k)) then
  raise exception 'Template variables changed. Review the line.' using errcode='PT409';
 end if;
 for v in select value from jsonb_array_elements(t->'variables') loop
  if v->>'key'='quantity' then x:=q;
  else
   raw:=coalesce(supplied->(v->>'key'),v->'default');
   if jsonb_typeof(raw) is distinct from 'number' then raise exception '%: enter a number.',v->>'label';end if;
   x:=(raw#>>'{}')::numeric;
  end if;
  if x is null or x<0 or x>1000000000 or x<>round(x,6) or x<(v->>'min')::numeric or x>(v->>'max')::numeric or ((v->>'integer')::boolean and x<>trunc(x)) then
   raise exception '%: enter a number from % to %.',v->>'label',v->>'min',v->>'max';
  end if;
  if v ? 'options' and not exists(select 1 from jsonb_array_elements(v->'options') y where (y.value->>'value')::numeric=x) then raise exception '%: choose one of the options.',v->>'label';end if;
  if v->>'key'='quantity' then
   if x<=0 or x<>round(x,3) then raise exception 'Invalid template quantity';end if;
  else inputs:=inputs||jsonb_build_object(v->>'key',raw);end if;
  tnames:=array_append(tnames,v->>'key');
 end loop;
 vals:=inputs||jsonb_build_object('quantity',q);
 -- A material selection: the chosen item's cost per unit is <variable>_rate.
 for v in select value from jsonb_array_elements(t->'variables') where value->>'kind'='material' loop
  select value into o from jsonb_array_elements(v->'options') where (value->>'value')::numeric=(inputs->>(v->>'key'))::numeric;
  select * into svc from public.services where shop_id=p_shop and id=(o->>'serviceId')::uuid and not archived and costing is not null;
  if not found then raise exception '%: % is no longer available. Review the template.',v->>'label',o->>'label' using errcode='PT409';end if;
  selected:=selected||jsonb_build_object(v->>'key',svc.id);
  refs:=refs||jsonb_build_object(svc.costing->>'key',private.tpl_ref(p_shop,svc));
  vals:=vals||jsonb_build_object(v->>'key'||'_rate',refs->(svc.costing->>'key')->'rate');
  tnames:=array_append(tnames,v->>'key'||'_rate');
 end loop;
 for f in select value from jsonb_array_elements(t->'computed') union all select value from jsonb_array_elements(t->'expenses') loop
  formulas:=formulas||jsonb_build_object(f->>'key',f);todo:=array_append(todo,f->>'key');tnames:=array_append(tnames,f->>'key');
 end loop;
 -- Every cost a formula names, looked up first (also in unused IF branches).
 for f in select value from jsonb_each(formulas) loop
  foreach nm in array private.tpl_names(f->'expression') loop
   if nm=any(tnames) or vals ? nm then continue;end if;
   select * into svc from public.services where shop_id=p_shop and not archived and costing->>'key'=nm;
   if not found then raise exception 'Unknown value "%". Check the template or the cost on its item.',nm using errcode='PT409';end if;
   refs:=refs||jsonb_build_object(nm,private.tpl_ref(p_shop,svc));
   vals:=vals||jsonb_build_object(nm,refs->nm->'rate');
  end loop;
 end loop;
 -- Evaluate formulas once their template names are known.
 loop
  exit when cardinality(todo)=0;
  progress:=false;left_over:='{}';
  foreach nm in array todo loop
   if exists(select 1 from unnest(private.tpl_names(formulas->nm->'expression')) d where formulas ? d and not vals ? d) then left_over:=array_append(left_over,nm);
   else vals:=vals||jsonb_build_object(nm,private.tpl_eval(formulas->nm->'expression',vals));progress:=true;end if;
  end loop;
  if not progress then raise exception 'Circular calculation: %',left_over[1];end if;
  todo:=left_over;
 end loop;
 for f in select value from jsonb_array_elements(t->'computed') loop
  x:=(vals->>(f->>'key'))::numeric;
  if x<0 then raise exception '% cannot be negative.',f->>'label';end if;
  outputs:=outputs||jsonb_build_array(jsonb_build_object('key',f->'key','label',f->'label','unit',f->'unit','value',private.tpl_text(x)));
 end loop;
 for f in select value from jsonb_array_elements(t->'expenses') loop
  x:=(vals->>(f->>'key'))::numeric;
  if x<0 then raise exception '% cannot be negative. Use a discount instead.',f->>'label';end if;
  expenses:=expenses||jsonb_build_array(jsonb_build_object('key',f->'key','label',f->'label','amount',private.tpl_text(x)));
  cost:=cost+x;
 end loop;
 rate:=(t->'pricing'->>'rate')::numeric/100;fl:=(t->'pricing'->>'floor')::numeric/100;stp:=(t->'pricing'->>'rounding')::numeric;
 if t->'pricing'->>'method'='markup' then rawp:=private.tpl_r12(cost*(1+rate));minp:=private.tpl_r12(cost*(1+fl));
 elsif t->'pricing'->>'method'='margin' and rate<1 and fl<1 then rawp:=private.tpl_div(cost,1-rate);minp:=private.tpl_div(cost,1-fl);
 else raise exception 'Invalid template pricing';end if;
 if stp is null or stp<0.01 then raise exception 'Invalid template rounding';end if;
 amount:=ceil(private.tpl_snap(rawp,stp))*stp*100;minimum:=ceil(private.tpl_snap(minp*100,1));
 if amount>100000000000 or amount<>trunc(amount) then raise exception 'Template price exceeds the supported range.';end if;
 -- Computed variables linked to stock take their quantity out of a material at checkout.
 for f in select value from jsonb_array_elements(t->'computed') where coalesce(value->'stock','null'::jsonb)<>'null'::jsonb loop
  if f->'stock' ? 'variable' then select * into svc from public.services where shop_id=p_shop and id=(selected->>(f->'stock'->>'variable'))::uuid;
  else
   select * into svc from public.services where shop_id=p_shop and id=(f->'stock'->>'serviceId')::uuid and not archived;
   if not found then raise exception '%: its stock item is no longer available. Review the template.',f->>'label' using errcode='PT409';end if;
  end if;
  if svc.material_id is null then continue;end if;
  if p_checkout then select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived for update;
  else select * into mat from public.materials where shop_id=p_shop and id=svc.material_id and not archived;end if;
  if not found then raise exception '%: the material for % is unavailable.',f->>'label',svc.description using errcode='PT409';end if;
  x:=(vals->>(f->>'key'))::numeric;needed:=floor(x*1000+0.5)/1000;
  if needed=0 then continue;end if;
  select ord-1 into idx from jsonb_array_elements(stock) with ordinality s(value,ord) where s.value->>'materialId'=mat.id::text;
  if idx is not null then
   stock:=jsonb_set(stock,array[idx::text,'quantity'],to_jsonb((stock->idx->>'quantity')::numeric+needed));
  else
   select s.value->'stockEventId',s.value->'stockCountEventId' into sid,count_id from jsonb_array_elements(coalesce(prior->'stock','[]')) s where s.value->>'materialId'=mat.id::text limit 1;
   if p_checkout or count_id is null then
    count_id:=coalesce(to_jsonb((select h.id from public.material_stock_changes h where h.shop_id=p_shop and h.material_id=mat.id and h.action='material.stock_set' order by h.created_at desc,h.id desc limit 1)),'null'::jsonb);
   end if;
   stock:=stock||jsonb_build_array(jsonb_build_object('materialId',mat.id,'serviceId',svc.id,'name',mat.name,'unit',mat.measurement_unit,'quantity',needed,
    'stockEventId',coalesce(sid,'null'::jsonb),'stockCountEventId',count_id));
  end if;
  idx:=null;
 end loop;
 return jsonb_build_object('template',t,'inputs',inputs,
  'references',coalesce((select jsonb_agg(value order by key collate "C") from jsonb_each(refs)),'[]'::jsonb),
  'outputs',outputs,'expenses',expenses,
  'price',jsonb_build_object('cost',private.tpl_text(cost),'raw',private.tpl_text(rawp),'amount',amount,'minimum',minimum),
  'stock',stock);
end $$;

-- Checks a line's snapshot against the business's template and today's costs; returns the snapshot.
create or replace function private.price_template_snapshot(p_shop uuid,snapshot jsonb,q numeric,p_checkout boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare pricing jsonb;t jsonb;fresh jsonb;
begin
 select settings->'pricing' into pricing from public.business_settings where shop_id=p_shop;
 select value into t from jsonb_array_elements(coalesce(pricing->'templates','[]')) where value->>'id'=snapshot->'template'->>'id' and value->'archived'='false'::jsonb;
 if not found or pricing->'enabled' is distinct from 'true'::jsonb or t is distinct from snapshot->'template' then raise exception 'Pricing template changed or is unavailable. Review checkout.' using errcode='PT409';end if;
 if q is null or q<=0 or q>1000000 or q<>round(q,3) then raise exception 'Invalid template quantity';end if;
 fresh:=private.tpl_price(p_shop,t,coalesce(snapshot->'inputs','{}'::jsonb),q,snapshot,p_checkout);
 if fresh is distinct from snapshot then raise exception 'Template price, costs, inputs or stock count changed. Review checkout.' using errcode='PT409';end if;
 if exists(select 1 from jsonb_array_elements(snapshot->'stock') s where (s.value->>'stockEventId')::uuid is null)
  or (select count(distinct s.value->>'stockEventId') from jsonb_array_elements(snapshot->'stock') s)<>jsonb_array_length(snapshot->'stock') then
  raise exception 'Invalid template stock identity';
 end if;
 return snapshot;
end $$;
create or replace function private.price_template_snapshot(p_shop uuid,snapshot jsonb,q numeric) returns jsonb
language sql security invoker set search_path='' as $$ select private.price_template_snapshot(p_shop,snapshot,q,true) $$;

create or replace function private.deduct_template_stock(p_shop uuid,snapshot jsonb,job_id uuid,checkout_id uuid,actor uuid,label text) returns void
language plpgsql security invoker set search_path='' as $$
declare s jsonb;mid uuid;sid uuid;
begin
 for s in select value from jsonb_array_elements(coalesce(snapshot->'stock','[]')) loop
  mid:=(s->>'materialId')::uuid;sid:=(s->>'stockEventId')::uuid;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,sid,actor,jsonb_build_object('id',sid,'kind','material.job_used','data',jsonb_build_object('id',mid,'jobId',job_id,'checkoutId',checkout_id,'reason','Checkout '||checkout_id||' / Job '||job_id||' / Template: '||(snapshot->'template'->>'name'))));
  update public.materials set available=available-(s->>'quantity')::numeric,version=version+1,modified_by=actor,modified_by_label=label,modified_at=now(),last_event_id=sid where shop_id=p_shop and id=mid;
 end loop;
end $$;
revoke all on function private.tpl_fdiv(numeric,numeric),private.tpl_r12(numeric),private.tpl_div(numeric,numeric),private.tpl_snap(numeric,numeric),private.tpl_text(numeric),
 private.tpl_eval(jsonb,jsonb,integer),private.tpl_names(jsonb,integer),private.tpl_check_tree(jsonb,integer),private.tpl_ref(uuid,public.services),
 private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean),private.price_template_snapshot(uuid,jsonb,numeric,boolean),private.price_template_snapshot(uuid,jsonb,numeric),
 private.deduct_template_stock(uuid,jsonb,uuid,uuid,uuid,text) from public,anon,authenticated;

-- ------------------------------------------------------------------ saving templates
create or replace function private.check_pricing_templates() returns trigger
language plpgsql security definer set search_path='' as $$
declare p jsonb:=new.settings->'pricing';t jsonb;v jsonb;o jsonb;f jsonb;keys text[];ids text[]:='{}';materials text[];formulas text[];done text[];left_over text[];progress boolean;nm text;pr jsonb;
 num numeric;lo numeric;hi numeric;
begin
 if p is null then return new;end if;
 if jsonb_typeof(p->'enabled') is distinct from 'boolean' or jsonb_typeof(p->'templates') is distinct from 'array' or jsonb_array_length(p->'templates')>30 then raise exception 'Invalid pricing templates';end if;
 for t in select value from jsonb_array_elements(p->'templates') loop
  perform (t->>'id')::uuid;
  if t->>'id' is null or t->>'id'=any(ids) or jsonb_typeof(t->'archived') is distinct from 'boolean' or jsonb_typeof(t->'version') is distinct from 'number'
   or (t->>'version')::numeric<1 or (t->>'version')::numeric<>trunc((t->>'version')::numeric)
   or jsonb_typeof(t->'name') is distinct from 'string' or length(btrim(t->>'name')) not between 1 and 100
   or jsonb_typeof(t->'category') is distinct from 'string' or length(t->>'category')>50 or jsonb_typeof(t->'description') is distinct from 'string' or length(t->>'description')>200 then
   raise exception 'Invalid template identity';
  end if;
  ids:=array_append(ids,t->>'id');
  if jsonb_typeof(t->'variables') is distinct from 'array' or jsonb_array_length(t->'variables') not between 1 and 30
   or jsonb_typeof(t->'computed') is distinct from 'array' or jsonb_array_length(t->'computed')>100
   or jsonb_typeof(t->'expenses') is distinct from 'array' or jsonb_array_length(t->'expenses') not between 1 and 100 then raise exception 'Invalid template fields';end if;
  keys:='{}';materials:='{}';formulas:='{}';
  for v in select value from jsonb_array_elements(t->'variables') loop
   if coalesce(v->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$' or v->>'key'=any(keys) or v->>'key' in ('ceiling','floor','roundup','round','sum','abs','min','max','if')
    or jsonb_typeof(v->'label') is distinct from 'string' or length(btrim(v->>'label')) not between 1 and 80 or v->>'kind' not in ('number','options','material','yesno')
    or jsonb_typeof(v->'unit') is distinct from 'string' or length(v->>'unit')>40 or jsonb_typeof(v->'integer') is distinct from 'boolean' or jsonb_typeof(v->'clientVisible') is distinct from 'boolean'
    or jsonb_typeof(v->'default') is distinct from 'number' or jsonb_typeof(v->'min') is distinct from 'number' or jsonb_typeof(v->'max') is distinct from 'number' then
    raise exception 'Invalid template variable';
   end if;
   num:=(v->>'default')::numeric;lo:=(v->>'min')::numeric;hi:=(v->>'max')::numeric;
   if lo<0 or hi>1000000000 or lo>hi or num<lo or num>hi or num<>round(num,6) then raise exception 'Invalid template variable range';end if;
   if v->>'key'='quantity' and (v->>'kind'<>'number' or lo<=0 or hi>1000000) then raise exception 'Invalid template quantity';end if;
   if v->>'kind' in ('options','material') then
    if jsonb_typeof(v->'options') is distinct from 'array' or jsonb_array_length(v->'options') not between 1 and 100 then raise exception 'Invalid template options';end if;
    for o in select value from jsonb_array_elements(v->'options') loop
     if jsonb_typeof(o->'value') is distinct from 'number' or jsonb_typeof(o->'label') is distinct from 'string' or length(btrim(o->>'label')) not between 1 and 80
      or (v->>'kind'='material' and ((o->>'serviceId')::uuid is null)) then raise exception 'Invalid template option';end if;
    end loop;
   elsif v ? 'options' then raise exception 'Invalid template options';end if;
   keys:=array_append(keys,v->>'key');
   if v->>'kind'='material' then
    if v->>'key'||'_rate'=any(keys) then raise exception 'Invalid template variable';end if;
    keys:=array_append(keys,v->>'key'||'_rate');materials:=array_append(materials,v->>'key');
   end if;
  end loop;
  if not 'quantity'=any(keys) then raise exception 'Template needs a quantity';end if;
  for f in select value from jsonb_array_elements(t->'computed') union all select value from jsonb_array_elements(t->'expenses') loop
   if coalesce(f->>'key','') !~ '^[a-z][a-z0-9_]{0,39}$' or f->>'key'=any(keys) or f->>'key' in ('ceiling','floor','roundup','round','sum','abs','min','max','if')
    or jsonb_typeof(f->'label') is distinct from 'string' or length(btrim(f->>'label')) not between 1 and 80
    or jsonb_typeof(f->'formula') is distinct from 'string' or length(f->>'formula') not between 1 and 1500 then raise exception 'Invalid template formula entry';end if;
   perform private.tpl_check_tree(f->'expression');
   keys:=array_append(keys,f->>'key');formulas:=array_append(formulas,f->>'key');
  end loop;
  for f in select value from jsonb_array_elements(t->'computed') loop
   if jsonb_typeof(f->'unit') is distinct from 'string' or length(btrim(f->>'unit')) not between 1 and 40
    or not (f->'stock'='null'::jsonb or (f->'stock' ? 'variable' and f->'stock'->>'variable'=any(materials)) or (f->'stock'->>'serviceId')::uuid is not null) then
    raise exception 'Invalid computed variable';
   end if;
  end loop;
  for f in select value from jsonb_array_elements(t->'expenses') loop
   if f ? 'calculation' and jsonb_typeof(f->'calculation') is distinct from 'object' then raise exception 'Invalid expense method';end if;
  end loop;
  -- Template formulas must not depend on each other in a loop.
  done:='{}';
  loop
   exit when cardinality(formulas)=0;
   progress:=false;left_over:='{}';
   foreach nm in array formulas loop
    select value into f from (select value from jsonb_array_elements(t->'computed') union all select value from jsonb_array_elements(t->'expenses')) x where x.value->>'key'=nm;
    if exists(select 1 from unnest(private.tpl_names(f->'expression')) d where d=any(formulas) and not d=any(done)) then left_over:=array_append(left_over,nm);
    else done:=array_append(done,nm);progress:=true;end if;
   end loop;
   if not progress then raise exception 'Circular calculation: %',left_over[1];end if;
   formulas:=left_over;
  end loop;
  pr:=t->'pricing';
  if jsonb_typeof(pr) is distinct from 'object' or pr->>'method' not in ('markup','margin')
   or jsonb_typeof(pr->'rate') is distinct from 'number' or jsonb_typeof(pr->'floor') is distinct from 'number' or jsonb_typeof(pr->'maxDiscount') is distinct from 'number' or jsonb_typeof(pr->'rounding') is distinct from 'number'
   or (pr->>'rate')::numeric<>round((pr->>'rate')::numeric,2) or (pr->>'floor')::numeric<>round((pr->>'floor')::numeric,2) or (pr->>'maxDiscount')::numeric<>round((pr->>'maxDiscount')::numeric,2) or (pr->>'rounding')::numeric<>round((pr->>'rounding')::numeric,2)
   or (pr->>'floor')::numeric<0 or (pr->>'rate')::numeric<(pr->>'floor')::numeric or (pr->>'rate')::numeric>1000 or (pr->>'method'='margin' and (pr->>'rate')::numeric>=100)
   or (pr->>'maxDiscount')::numeric not between 0 and 100 or (pr->>'rounding')::numeric not between 0.01 and 100000 then raise exception 'Invalid template pricing';end if;
 end loop;
 return new;
end $$;
revoke all on function private.check_pricing_templates() from public,anon,authenticated;

-- ------------------------------------------------------------------ wiring
do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.apply_service_event(uuid,jsonb)'::regprocedure,array[
   $a$if v_data ? 'shelfItem' and jsonb_typeof(v_data->'shelfItem') is distinct from 'boolean' then raise exception 'Choose whether this is sold off the shelf'; end if;$a$,
   $b$if v_data ? 'shelfItem' and jsonb_typeof(v_data->'shelfItem') is distinct from 'boolean' then raise exception 'Choose whether this is sold off the shelf'; end if;
    if v_data ? 'private' and jsonb_typeof(v_data->'private') is distinct from 'boolean' then raise exception 'Choose whether this is used in templates only'; end if;
    if not private.valid_costing(v_data->'costing') then raise exception 'Enter a valid template cost and formula name'; end if;
    if coalesce((v_data->>'private')::boolean,false) and coalesce(v_data->'costing','null'::jsonb)='null'::jsonb then raise exception 'A templates-only item needs a template cost'; end if;
    if coalesce(v_data->'costing','null'::jsonb)<>'null'::jsonb and exists(select 1 from public.services s where s.shop_id=p_shop and s.id<>v_id and not s.archived and s.costing->>'key'=v_data->'costing'->>'key') then raise exception 'The formula name "%" is already used by another item.',v_data->'costing'->>'key' using errcode='PT409'; end if;$b$,
   $a$insert into public.services(id,shop_id,description,material_id,price,shelf_item,created_by,$a$,
   $b$insert into public.services(id,shop_id,description,material_id,price,shelf_item,private,costing,created_by,$b$,
   $a$v_price::bigint,coalesce((v_data->>'shelfItem')::boolean,false),v_user,$a$,
   $b$v_price::bigint,coalesce((v_data->>'shelfItem')::boolean,false),coalesce((v_data->>'private')::boolean,false),nullif(v_data->'costing','null'::jsonb),v_user,$b$,
   $a$shelf_item=coalesce((v_data->>'shelfItem')::boolean,shelf_item),$a$,
   $b$shelf_item=coalesce((v_data->>'shelfItem')::boolean,shelf_item),private=coalesce((v_data->>'private')::boolean,private),costing=case when v_data ? 'costing' then nullif(v_data->'costing','null'::jsonb) else costing end,$b$,
   $a$if v_service.archived=(v_kind='service.archived') then raise exception 'Service is already in that state'; end if;$a$,
   $b$if v_service.archived=(v_kind='service.archived') then raise exception 'Service is already in that state'; end if;
    if v_kind='service.restored' and v_service.costing is not null and exists(select 1 from public.services s where s.shop_id=p_shop and s.id<>v_id and not s.archived and s.costing->>'key'=v_service.costing->>'key') then raise exception 'Another item now uses the formula name "%". Rename one first.',v_service.costing->>'key' using errcode='PT409'; end if;$b$
  ]),
  ('public.get_ledger_before_checkout(uuid)'::regprocedure,array[
   $a$'shelfItem',shelf_item,$a$,
   $b$'shelfItem',shelf_item,'private',private,'costing',costing,$b$
  ]),
  ('public.apply_checkout_event(uuid,jsonb)'::regprocedure,array[
   $a$   select sum((value->>'amount')::numeric) into calculated from jsonb_array_elements(line->'templateSnapshot'->'components');$a$,
   $b$   if line->>'serviceId' is distinct from line->'templateSnapshot'->'template'->>'id' then raise exception 'Invalid template job';end if;
   calculated:=(line->'templateSnapshot'->'price'->>'amount')::numeric;$b$,
   $a$then raise exception 'Service or price changed. Review checkout.' using errcode='PT409';end if;$a$,
   $b$then raise exception 'Service or price changed. Review checkout.' using errcode='PT409';end if;
  if svc.private then raise exception '% is used in templates only and cannot be sold',svc.description using errcode='PT409';end if;$b$,
   $a$  net:=calculated-disc;$a$,
   $b$  net:=calculated-disc;
  if line ? 'templateSnapshot' and (net<(line->'templateSnapshot'->'price'->>'minimum')::numeric or disc>ceil(calculated*(line->'templateSnapshot'->'template'->'pricing'->>'maxDiscount')::numeric/100)) then raise exception 'This discount is outside the template''s pricing limits. Review the checkout.' using errcode='PT409';end if;$b$
  ]),
  ('public.apply_quotation_event(uuid,jsonb)'::regprocedure,array[
   $a$       perform private.price_template_snapshot(p_shop,line->'templateSnapshot',(line->>'quantity')::numeric);
       if (line->>'grossAmount')::numeric is distinct from (select sum((value->>'amount')::numeric) from jsonb_array_elements(line->'templateSnapshot'->'components')) then raise exception 'Invalid template quotation amount';end if;
      end if;$a$,
   $b$       perform private.price_template_snapshot(p_shop,line->'templateSnapshot',(line->>'quantity')::numeric,false);
       if line->>'serviceId' is distinct from line->'templateSnapshot'->'template'->>'id' or (line->>'grossAmount')::numeric is distinct from (line->'templateSnapshot'->'price'->>'amount')::numeric
        or (line->>'amount')::numeric<(line->'templateSnapshot'->'price'->>'minimum')::numeric
        or (line->>'discountAmount')::numeric>ceil((line->>'grossAmount')::numeric*(line->'templateSnapshot'->'template'->'pricing'->>'maxDiscount')::numeric/100) then raise exception 'Invalid template quotation amount or discount';end if;
      elsif exists(select 1 from public.services s where s.shop_id=p_shop and s.id::text=line->>'serviceId' and s.private) then raise exception 'Templates-only items cannot be quoted';
      end if;$b$
  ]),
  ('private.sync_resource_keys(uuid,jsonb,boolean,text)'::regprocedure,array[
   $a$for component in select value from jsonb_array_elements(coalesce(j->'templateSnapshot'->'components','[]')) loop$a$,
   $b$for component in select value from jsonb_array_elements(coalesce(j->'templateSnapshot'->'references','[]')||coalesce(j->'templateSnapshot'->'stock','[]')) loop$b$
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
