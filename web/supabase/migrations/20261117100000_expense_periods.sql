-- Expenses that cover a period (rent for a year, salaries for a month): data.covers = { from, to }
-- (days, both included; null = the day it was incurred). Profit & loss on the device spreads the cost by
-- day over those days (web/src/expense-periods.mjs); cash is not spread.
-- Business Settings → Dropdowns: settings.options.categoryPeriods = { category: months (1, 3, 6, 12) }.

create or replace function private.expense_covers(p_covers jsonb, p_day date)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare f date; t date;
begin
  if p_covers is null or p_covers = 'null'::jsonb then return 'null'::jsonb; end if;
  if jsonb_typeof(p_covers) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(p_covers) k where k not in ('from', 'to'))
     or coalesce(p_covers->>'from', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(p_covers->>'to', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Choose the dates this expense covers';
  end if;
  f := (p_covers->>'from')::date; t := (p_covers->>'to')::date;
  if t < f then raise exception 'The period this expense covers must end on or after its start'; end if;
  if t - f + 1 > 1098 then raise exception 'An expense can cover up to 3 years'; end if;
  if abs(f - p_day) > 1098 then raise exception 'The period it covers must start within 3 years of the expense date'; end if;
  return jsonb_build_object('from', to_char(f, 'YYYY-MM-DD'), 'to', to_char(t, 'YYYY-MM-DD'));
end $$;

do $migration$
declare
  def text := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
  t text := $t$'restockIds',private.expense_restock_ids(p_shop,coalesce(d->'restockIds',old->'restockIds'),coalesce(d->'jobIds',old->'jobIds'),lines),$t$;
  r text := $r$'covers',private.expense_covers(case when d ? 'covers' then d->'covers' else coalesce(old->'covers','null'::jsonb) end,day),$r$;
  cnt integer;
begin
  if position('expense_covers' in def) > 0 then raise notice 'Expenses already keep their period'; return; end if;
  cnt := (length(def) - length(replace(def, t, ''))) / length(t);
  if cnt <> 1 then raise exception 'apply_expense_event: place found % times (run the expenses-for-restocks SQL first)', cnt; end if;
  execute replace(def, t, t || r);
end $migration$;

create or replace function private.check_category_periods() returns trigger
language plpgsql set search_path to '' as $function$
declare v jsonb := new.settings->'options'->'categoryPeriods';
begin
  if v is null then return new; end if;
  if jsonb_typeof(v) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v)) > 30
     or exists (select 1 from jsonb_each(v) x where length(x.key) > 80 or jsonb_typeof(x.value) is distinct from 'number' or (x.value #>> '{}')::numeric not in (1, 3, 6, 12)) then
    raise exception 'Invalid usual periods for expense categories';
  end if;
  return new;
end $function$;
drop trigger if exists check_category_periods on public.business_settings;
create trigger check_category_periods before insert or update on public.business_settings
  for each row execute function private.check_category_periods();
