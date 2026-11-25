-- Team work: outside vendors (owner, 25 Nov).
--   * A vendor can do a whole stage (e.g. printing outsourced) or a share of it next to the Team:
--     vendor.share counts with the people's shares (percent adding up to 100, or quantities up to
--     the job's).
--   * The vendor is one of the Payees (vendor.payeeId) when chosen from them.
--   * Its cost is recorded as an expense linked to the job (vendor.expenseId, saved by the app in the
--     same sync), so it counts in the job's actual profit and shows as owed to the payee.
-- The app does the same (web/src/DoneByFields.tsx draftWork). Patterns allow for CR LF.

create or replace function private.team_check_work(p_shop uuid, p_job uuid, d jsonb) returns int
language plpgsql stable security definer set search_path to '' as $f$
declare j record; s jsonb; total numeric := 0; others int := 0; unit text := coalesce(d->>'unit', 'percent'); me uuid := auth.uid();
  v jsonb := d->'vendor'; vshare numeric;
begin
  select * into j from public.jobs where shop_id = p_shop and id = p_job;
  if unit not in ('percent', 'quantity') or jsonb_typeof(d->'shares') is distinct from 'array' or jsonb_array_length(d->'shares') > 20 then
    raise exception 'Invalid shares';
  end if;
  if jsonb_array_length(d->'shares') = 0 and jsonb_typeof(v) is distinct from 'object' then
    raise exception 'Choose who did the work, or an outside vendor';
  end if;
  for s in select value from jsonb_array_elements(d->'shares') loop
    if not private.team_person(p_shop, (s->>'personId')::uuid) then raise exception 'Choose people on the Team'; end if;
    if jsonb_typeof(s->'share') is distinct from 'number' or (s->>'share')::numeric <= 0 then raise exception 'Each share must be more than 0'; end if;
    total := total + (s->>'share')::numeric;
    if (s->>'personId')::uuid is distinct from me then others := others + 1; end if;
  end loop;
  if d ? 'vendor' then
    if jsonb_typeof(v) <> 'object' or length(btrim(coalesce(v->>'name', ''))) not between 1 and 120
        or jsonb_typeof(v->'cost') <> 'number' or (v->>'cost')::numeric < 0 or (v->>'cost')::numeric > 100000000000 then
      raise exception 'Enter the vendor''s name and cost';
    end if;
    if v ? 'payeeId' and not exists (select 1 from public.business_operations_records where shop_id = p_shop and collection = 'payees' and id::text = v->>'payeeId') then
      raise exception 'Choose the vendor from Payees';
    end if;
    if v ? 'expenseId' and coalesce(v->>'expenseId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid vendor expense';
    end if;
    if v ? 'share' then
      if jsonb_typeof(v->'share') is distinct from 'number' or (v->>'share')::numeric <= 0 then raise exception 'The vendor''s share must be more than 0'; end if;
      vshare := (v->>'share')::numeric; total := total + vshare;
    elsif jsonb_array_length(d->'shares') > 0 then
      raise exception 'Enter the vendor''s share of the work';
    end if;
  end if;
  if jsonb_array_length(d->'shares') > 0 or vshare is not null then
    if unit = 'percent' and abs(total - 100) > 0.01 then raise exception 'The shares must add up to 100%%'; end if;
    if unit = 'quantity' and coalesce((j.metadata->>'quantity')::numeric, 0) > 0 and total > (j.metadata->>'quantity')::numeric then
      raise exception 'The quantities add up to more than the job''s %', j.metadata->>'quantity';
    end if;
  end if;
  if d ? 'redo' and (jsonb_typeof(d->'redo') <> 'object' or (nullif(d->'redo'->>'responsibleId', '') is not null
      and not private.team_person(p_shop, (d->'redo'->>'responsibleId')::uuid, false)) or length(coalesce(d->'redo'->>'note', '')) > 300) then
    raise exception 'Invalid redo';
  end if;
  return others;
end $f$;
revoke all on function private.team_check_work(uuid, uuid, jsonb) from public, anon, authenticated;

-- What a work record keeps of its vendor.
create or replace function private.team_vendor(v jsonb) returns jsonb
language sql immutable set search_path to '' as $f$
  select jsonb_build_object('name', btrim(v->>'name'), 'cost', round((v->>'cost')::numeric))
    || case when v ? 'payeeId' then jsonb_build_object('payeeId', v->>'payeeId') else '{}' end
    || case when v ? 'expenseId' then jsonb_build_object('expenseId', v->>'expenseId') else '{}' end
    || case when v ? 'share' then jsonb_build_object('share', (v->>'share')::numeric) else '{}' end
$f$;
revoke all on function private.team_vendor(jsonb) from public, anon, authenticated;

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('public.apply_team_event(uuid,jsonb)'::regprocedure);
  if position('team_vendor' in d) = 0 then
    pat := 'jsonb_build_object\(''vendor'', jsonb_build_object\(''name'', btrim\(d->''vendor''->>''name''\), ''cost'', round\(\(d->''vendor''->>''cost''\)::numeric\)\)\)';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_team_event record vendor pattern not found'; end if;
    d := regexp_replace(d, pat, $r$jsonb_build_object('vendor', private.team_vendor(d->'vendor'))$r$);
    pat := 'jsonb_build_object\(''vendor'', jsonb_build_object\(''name'', btrim\(d->''changes''->''vendor''->>''name''\),\s+''cost'', round\(\(d->''changes''->''vendor''->>''cost''\)::numeric\)\)\)';
    if regexp_count(d, pat) <> 1 then raise exception 'apply_team_event correction vendor pattern not found'; end if;
    d := regexp_replace(d, pat, $r$jsonb_build_object('vendor', private.team_vendor(d->'changes'->'vendor'))$r$);
    execute d;
  end if;
end $patch$;
