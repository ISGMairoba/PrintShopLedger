-- Materials → "Can be split": only materials with it turned on can be split into a smaller one
-- (or put back together). Off for every material until turned on in its settings.

alter table public.materials add column if not exists can_split boolean not null default false;

do $patch$
declare d text; pat text;
begin
  -- Devices receive it with each material.
  d := pg_get_functiondef('public.get_ledger_before_checkout(uuid)'::regprocedure);
  pat := $$'requireSize', require_size,$$;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'get_ledger_before_checkout pattern not found'; end if;
  execute replace(d, pat, $$'requireSize', require_size, 'canSplit', can_split,$$);

  d := pg_get_functiondef('public.apply_material_event(uuid,jsonb)'::regprocedure);
  -- Set when a material is added or edited (kept as it is when the app doesn't send it).
  pat := 'if\s+jsonb_typeof\(v_data\s*->\s*''requireSize''\)\s+is\s+distinct\s+from\s+''boolean''\s+then\s+raise\s+exception\s+''Require Size must be boolean'';\s*end\s+if;';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event requireSize pattern not found'; end if;
  d := regexp_replace(d, pat, $$if jsonb_typeof(v_data -> 'requireSize') is distinct from 'boolean' then raise exception 'Require Size must be boolean'; end if;
    if v_data ? 'canSplit' and jsonb_typeof(v_data -> 'canSplit') is distinct from 'boolean' then raise exception 'Can be split must be yes or no'; end if;$$);
  pat := 'require_size,\s+minimum_stock,\s+created_by,';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event insert columns pattern not found'; end if;
  d := regexp_replace(d, pat, 'require_size, minimum_stock, can_split, created_by,');
  pat := '\(v_data\s*->>\s*''requireSize''\)::boolean,\s+v_minimum,\s+v_user,';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event insert values pattern not found'; end if;
  d := regexp_replace(d, pat, $$(v_data ->> 'requireSize')::boolean, v_minimum, coalesce((v_data ->> 'canSplit')::boolean, false), v_user,$$);
  pat := 'minimum_stock\s*=\s*v_minimum,';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event update pattern not found'; end if;
  d := regexp_replace(d, pat, $$minimum_stock = v_minimum, can_split = coalesce((v_data ->> 'canSplit')::boolean, can_split),$$);
  -- Splitting needs it on.
  pat := 'raise\s+exception\s+''Restore both materials before splitting stock'';\s*end\s+if;\s*if\s+jsonb_typeof\(v_data\s*->\s*''quantity''\)';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_material_event split pattern not found'; end if;
  d := regexp_replace(d, pat, $$raise exception 'Restore both materials before splitting stock'; end if;
    if not v_material.can_split then raise exception 'Turn on "Can be split" for % first', v_material.name; end if;
    if jsonb_typeof(v_data -> 'quantity')$$);
  execute d;
end $patch$;
