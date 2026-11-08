-- Pricing templates: PRICE(item, count) gives the selling price of that many of an item as a sale
-- charges it (the biggest packs first, then single pieces; or the price of the quantity range the
-- count falls in). It is stored as PRICE(<name>_price, count). <name>_price alone stays the single
-- price. Items without a fixed selling price (private, priced at the sale, or ₦0) are refused
-- instead of counting as ₦0. The app does the same (pricing-formulas.mjs, pricing-templates.mjs).

-- Names a formula counts with PRICE.
create or replace function private.tpl_priced(n jsonb, depth integer default 0) returns text[]
language plpgsql immutable set search_path to '' as $f$
declare a jsonb; out text[] := '{}';
begin
  if depth > 64 then raise exception 'Formula is too complex.'; end if;
  if n->>'op' in ('name', 'number') or jsonb_typeof(n->'args') is distinct from 'array' then return '{}'; end if;
  if n->>'op' = 'PRICE' then out := array[n->'args'->0->'args'->>0]; end if;
  for a in select value from jsonb_array_elements(n->'args') loop out := out || private.tpl_priced(a, depth + 1); end loop;
  return out;
end $f$;

-- The selling price (naira) of cnt of an item: { amount (kobo), packPrices?, priceTiers? }.
create or replace function private.tpl_item_total(item jsonb, cnt numeric) returns numeric
language plpgsql immutable set search_path to '' as $f$
declare p jsonb; sz numeric; k numeric; left_over numeric := cnt; kobo numeric := 0; unit numeric := (item->>'amount')::numeric;
begin
  if cnt < 0 then raise exception 'PRICE: the count cannot be negative.'; end if;
  if jsonb_array_length(coalesce(item->'packPrices', '[]')) > 0 then
    for p in select value from jsonb_array_elements(item->'packPrices') with ordinality x(value, i)
             order by (value->>'quantity')::numeric desc, i loop
      sz := (p->>'quantity')::numeric;
      k := floor(left_over / sz);
      if k * sz > left_over then k := k - 1; end if;
      if (k + 1) * sz <= left_over then k := k + 1; end if;
      kobo := kobo + k * (p->>'price')::numeric;
      left_over := left_over - k * sz;
    end loop;
    kobo := kobo + left_over * unit;
  else
    for p in select value from jsonb_array_elements(coalesce(item->'priceTiers', '[]')) with ordinality x(value, i)
             order by (value->>'from')::numeric, i loop
      if cnt >= (p->>'from')::numeric then unit := (p->>'price')::numeric; end if;
    end loop;
    kobo := cnt * unit;
  end if;
  return kobo / 100;
end $f$;

create or replace function private.tpl_check_tree(n jsonb, depth integer default 0) returns integer
language plpgsql immutable set search_path to '' as $function$
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
 elsif op='PRICE' and (c<>2 or args->0->>'op' is distinct from 'name' or args->0->'args'->>0 !~ '_price$') then
  raise exception 'Unsupported template formula';
 elsif not ((op in ('+','-','*','/','>','<','>=','<=','==','!=') and c=2) or (op in ('CEILING','FLOOR') and c between 1 and 2)
   or (op in ('ROUNDUP','ROUND') and c=2) or (op='SUM' and c between 1 and 50) or (op='ABS' and c=1) or (op in ('MIN','MAX') and c between 2 and 10) or (op='IF' and c=3) or (op='PRICE' and c=2)) then
  raise exception 'Unsupported template formula';
 end if;
 for a in select value from jsonb_array_elements(args) loop total:=total+private.tpl_check_tree(a,depth+1);end loop;
 if total>600 then raise exception 'Template formula is too complex';end if;
 return total;
end $function$;

create or replace function private.tpl_eval(n jsonb, vals jsonb, depth integer default 0) returns numeric
language plpgsql immutable set search_path to '' as $function$
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
 elsif op='PRICE' then
  -- The item's prices are kept under "$<name>_price" (names never start with $).
  if c<>2 or args->0->>'op' is distinct from 'name' or not vals ? ('$'||(args->0->'args'->>0)) then raise exception 'Unknown value "%".',args->0->'args'->>0;end if;
  r:=private.tpl_r12(private.tpl_item_total(vals->('$'||(args->0->'args'->>0)),private.tpl_eval(args->1,vals,depth+1)));
  if abs(r)>1000000000000 then raise exception 'Calculation exceeds supported limits.';end if;
  return r;
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
end $function$;

do $patch$
declare d text; pat text;
  procedure_sig regprocedure := 'private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'::regprocedure;
begin
  d := pg_get_functiondef(procedure_sig);
  pat := $$declare v jsonb;$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'tpl_price declare pattern not found'; end if;
  d := replace(d, pat, $$declare counted text[]:='{}';v jsonb;$$);

  pat := $$for f in select value from jsonb_each(formulas) loop$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'tpl_price names pattern not found'; end if;
  d := replace(d, pat, $$for f in select value from jsonb_each(formulas) loop counted:=counted||private.tpl_priced(f->'expression');end loop;
 $$ || pat);

  pat := $$Check the template or the formula name on its item.',nm using errcode='PT409';end if;$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'tpl_price unknown pattern not found'; end if;
  d := replace(d, pat, pat || $$
    if svc.private then raise exception '% is private (not sold), so it has no selling price. Use its cost: %.',svc.description,left(nm,-6) using errcode='PT409';end if;
    if svc.custom_price then raise exception '% is priced at the sale, so it has no fixed selling price. Give it a template cost and use %.',svc.description,left(nm,-6) using errcode='PT409';end if;
    if coalesce(svc.price,0)<=0 then raise exception '% has no selling price. Set its price, or give it a template cost and use %.',svc.description,left(nm,-6) using errcode='PT409';end if;$$);

  pat := $$'rate',private.tpl_text(svc.price/100.0),'kind','price'));$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'tpl_price price pattern not found'; end if;
  execute replace(d, pat, $$'rate',private.tpl_text(svc.price/100.0),'kind','price')
     || case when nm=any(counted) and jsonb_array_length(coalesce(svc.pack_prices,'[]'))>0 then jsonb_build_object('packPrices',svc.pack_prices) else '{}'::jsonb end
     || case when nm=any(counted) and jsonb_array_length(coalesce(svc.price_tiers,'[]'))>0 then jsonb_build_object('priceTiers',svc.price_tiers) else '{}'::jsonb end);
    vals:=vals||jsonb_build_object('$'||nm,refs->nm);$$);
end $patch$;

revoke all on function private.tpl_priced(jsonb, integer) from public, anon;
revoke all on function private.tpl_item_total(jsonb, numeric) from public, anon;
grant execute on function private.tpl_priced(jsonb, integer) to authenticated;
grant execute on function private.tpl_item_total(jsonb, numeric) to authenticated;
