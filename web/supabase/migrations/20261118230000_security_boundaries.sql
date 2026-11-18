-- Security boundaries (plans/audit-1-review.md: AUD-14, 15, 16, 17):
-- 1. The business copy is read only through get_ledger / get_ledger_changes. The inner layers and
--    the tables behind them answer only while one of those is running (psl.ledger = 'on'), so a
--    direct call or table read cannot skip the branch, own-customer or other filters.
-- 2. The old apply_ledger_event no longer creates jobs or payments (checkout does, with its checks).
-- 3. A branch's own settings are saved group by group: someone allowed only the Receipts tab
--    changes only branches' receipts. Each group holds only its own settings.
-- 4. Job actions (status, materials, checks, hold, handovers) at a branch are refused for a job of
--    another branch.
-- 5. Staff of a branch only (not the main branch) no longer see the main branch's records by
--    leaving out which branch they are working at.

-- 1. The ledger is read only through its front doors -------------------------------------------

create or replace function private.ledger_layer() returns boolean
language plpgsql stable set search_path to '' as $f$
begin
  if coalesce(current_setting('psl.ledger', true), '') <> 'on' then
    raise exception 'Download the business with get_ledger.' using errcode = '42501';
  end if;
  return true;
end $f$;
grant execute on function private.ledger_layer() to authenticated;

do $m$ begin
  if not exists (select 1 from pg_proc where proname = 'get_ledger_before_guard' and pronamespace = 'public'::regnamespace) then
    alter function public.get_ledger(uuid) rename to get_ledger_before_guard;
  end if;
  if not exists (select 1 from pg_proc where proname = 'get_ledger_changes_before_guard' and pronamespace = 'public'::regnamespace) then
    alter function public.get_ledger_changes(uuid, text, boolean) rename to get_ledger_changes_before_guard;
  end if;
  if not exists (select 1 from pg_proc where proname = 'operations_transactions_core' and pronamespace = 'private'::regnamespace) then
    alter function private.operations_transactions(uuid) rename to operations_transactions_core;
  end if;
end $m$;

create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); r jsonb;
begin
  perform set_config('psl.ledger', 'on', true);
  r := public.get_ledger_before_guard(p_shop);
  perform set_config('psl.ledger', prev, true);
  return r;
end $f$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;

create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null, p_slim boolean default false) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); r jsonb;
begin
  perform set_config('psl.ledger', 'on', true);
  r := public.get_ledger_changes_before_guard(p_shop, p_since, p_slim);
  perform set_config('psl.ledger', prev, true);
  return r;
end $f$;
revoke all on function public.get_ledger_changes(uuid, text, boolean) from public, anon;
grant execute on function public.get_ledger_changes(uuid, text, boolean) to authenticated;

-- Account balances read the payments behind them the same way.
create or replace function private.operations_transactions(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); r jsonb;
begin
  perform set_config('psl.ledger', 'on', true);
  r := private.operations_transactions_core(p_shop);
  perform set_config('psl.ledger', prev, true);
  return r;
end $f$;

-- Every inner layer refuses when called on its own.
do $m$
declare f regprocedure; d text;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname ~ '^get_ledger_(before|changes_before)' loop
    d := pg_get_functiondef(f);
    continue when position('private.ledger_layer()' in d) > 0;
    if d ~* 'AS \$function\$\s*declare\s' then
      d := regexp_replace(d, '(AS \$function\$\s*declare\s)', '\1 psl_guard boolean := private.ledger_layer(); ', 'i');
    elsif d ~* 'AS \$function\$\s*begin\s' then
      d := regexp_replace(d, '(AS \$function\$\s*)(begin\s)', '\1declare psl_guard boolean := private.ledger_layer(); \2', 'i');
    else
      raise exception 'Unexpected start of %', f;
    end if;
    execute d;
  end loop;
end $m$;

-- Tables are read by members only while the business copy is being made.
do $m$
declare p record;
begin
  for p in select tablename, policyname, qual from pg_policies
           where schemaname = 'public' and cmd = 'SELECT' and tablename in (
             'business_operations_records', 'checkout_records', 'customer_reminders', 'customers', 'drawer_closings',
             'expense_changes', 'expenses', 'jobs', 'ledger_events', 'material_stock_changes', 'material_waste',
             'materials', 'payment_allocations', 'payments', 'quotations', 'sale_adjustments', 'services') loop
    continue when position('psl.ledger' in p.qual) > 0;
    execute format('alter policy %I on public.%I using ((%s) and current_setting(''psl.ledger'', true) = ''on'')',
                   p.policyname, p.tablename, p.qual);
  end loop;
end $m$;

-- The business-settings check reads accounts; it runs as the owner like the save that calls it.
alter function private.check_business_options() security definer;

-- 2. The old ledger route no longer records sales --------------------------------------------------

do $m$ begin
  if not exists (select 1 from pg_proc where proname = 'apply_ledger_event_core' and pronamespace = 'private'::regnamespace) then
    alter function public.apply_ledger_event(uuid, jsonb) rename to apply_ledger_event_core;
    alter function public.apply_ledger_event_core(uuid, jsonb) set schema private;
  end if;
end $m$;
revoke all on function private.apply_ledger_event_core(uuid, jsonb) from public, anon, authenticated;
create or replace function public.apply_ledger_event(p_shop uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
begin
  if p_event->>'kind' in ('job.created', 'payment.recorded') then
    raise exception 'Sales and payments are recorded through checkout. Update the app and try again.' using errcode = '42501';
  end if;
  return private.apply_ledger_event_core(p_shop, p_event);
end $f$;
revoke all on function public.apply_ledger_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_ledger_event(uuid, jsonb) to authenticated;

-- 5. Which branch's records someone sees --------------------------------------------------------

create or replace function private.branch_view(p_shop uuid, out has_branches boolean, out keep_branch text)
language plpgsql security definer set search_path to '' as $f$
declare s jsonb; acc jsonb;
begin
  select b.settings->'branches', b.settings->'branchAccess'->(auth.uid()::text) into s, acc
    from public.business_settings b where b.shop_id = p_shop;
  has_branches := coalesce(jsonb_typeof(s) = 'array' and jsonb_array_length(s) > 1, false);
  if not has_branches then keep_branch := null; return; end if;
  if coalesce(acc ? '*', false)
     or exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4) then
    keep_branch := null;
    return;
  end if;
  keep_branch := coalesce(private.request_branch(p_shop), 'main');
  -- Someone who works only at other branches sees no branch's records without naming theirs.
  if keep_branch = 'main' and jsonb_typeof(acc) = 'array' and jsonb_array_length(acc) > 0 and not acc ? 'main' then
    keep_branch := '!none';
  end if;
end $f$;

-- 4. Job actions at the job's own branch ----------------------------------------------------------

create or replace function private.assert_job_branch(p_shop uuid, p_job text) returns void
language plpgsql security definer set search_path to '' as $f$
declare bv record; b text;
begin
  select * into bv from private.branch_view(p_shop);
  if not bv.has_branches or bv.keep_branch is null or p_job !~* '^[0-9a-f-]{36}$' then return; end if;
  select coalesce(branch_id, 'main') into b from public.jobs where shop_id = p_shop and id = p_job::uuid;
  if found and b <> bv.keep_branch then
    raise exception 'This job belongs to another branch. Open it at that branch.' using errcode = '42501';
  end if;
end $f$;
revoke all on function private.assert_job_branch(uuid, text) from public, anon, authenticated;

do $m$
declare n text; w text;
begin
  foreach n in array array['apply_job_status_event', 'apply_job_material_event', 'apply_job_extra_materials_event',
                           'apply_job_check_event', 'apply_job_hold_event', 'apply_job_handover_event'] loop
    if not exists (select 1 from pg_proc where proname = n || '_core' and pronamespace = 'private'::regnamespace) then
      execute format('alter function public.%I(uuid, jsonb) rename to %I', n, n || '_core');
      execute format('alter function public.%I(uuid, jsonb) set schema private', n || '_core');
    end if;
    execute format('revoke all on function private.%I(uuid, jsonb) from public, anon, authenticated', n || '_core');
    w := format($w$
      create or replace function public.%1$I(p_shop uuid, p_event jsonb) returns jsonb
      language plpgsql security definer set search_path to '' as $f$
      begin
        perform private.assert_job_branch(p_shop, p_event->'data'->>'id');
        return private.%2$I(p_shop, p_event);
      end $f$;$w$, n, n || '_core');
    execute w;
    execute format('revoke all on function public.%I(uuid, jsonb) from public, anon', n);
    execute format('grant execute on function public.%I(uuid, jsonb) to authenticated', n);
  end loop;
end $m$;

-- 3. A branch's own settings, group by group ----------------------------------------------------

-- The settings each group holds (web/src/branches.mjs BRANCH_SETTING_GROUPS) and the tab that saves it.
create or replace function private.branch_setting_groups() returns table (grp text, tab text, keys text[])
language sql immutable set search_path to '' as $f$
  values ('profile', 'Profile & logo', array['address','phones','email','website','socials','logo','logoVariants','logoUsage']),
         ('appearance', 'Appearance', array['primary','accent','theme','backgrounds','tiles']),
         ('receipts', 'Receipts', array['receipt','receiptPage','documents']),
         ('workflow', 'Dropdowns & workflow', array['options']),
         ('jobs', 'Jobs & payments', array['jobs','drawers','production','discounts']),
         ('words', 'Words', array['terms']),
         ('messages', 'Messages', array['messages']),
         ('periods', 'Default time frames', array['periods']),
         ('pricing', 'Pricing templates', array['pricing']),
         ('corrections', 'Corrections', array['corrections']),
         ('security', 'Security', array['security'])
$f$;

-- Saved branch settings with only the groups of the given tabs taken from the new ones.
create or replace function private.merge_branch_settings(p_old jsonb, p_new jsonb, p_tabs jsonb) returns jsonb
language sql stable set search_path to '' as $f$
  with allowed as (select coalesce(array_agg(g.grp), '{}') a from private.branch_setting_groups() g where p_tabs ? g.tab),
  o as (select case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end v),
  n as (select case when jsonb_typeof(p_new) = 'object' then p_new else '{}'::jsonb end v),
  b as (select k from o, jsonb_object_keys(o.v) k union select k from n, jsonb_object_keys(n.v) k),
  merged as (
    select b.k,
      coalesce((select jsonb_object_agg(e.key, e.value) from o, allowed,
                jsonb_each(case when jsonb_typeof(o.v->b.k) = 'object' then o.v->b.k else '{}'::jsonb end) e
                where not (e.key = any(allowed.a))), '{}'::jsonb)
      || coalesce((select jsonb_object_agg(e.key, e.value) from n, allowed,
                jsonb_each(case when jsonb_typeof(n.v->b.k) = 'object' then n.v->b.k else '{}'::jsonb end) e
                where e.key = any(allowed.a)), '{}'::jsonb) v
    from b)
  select coalesce(jsonb_object_agg(k, v) filter (where v <> '{}'::jsonb), '{}'::jsonb) from merged
$f$;

do $m$
declare d text := pg_get_functiondef('public.save_business_settings(uuid,integer,jsonb)'::regprocedure);
  t text := 'else saved:=jsonb_set(saved,array[k],p_settings->k);end if;';
begin
  if position('merge_branch_settings' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'save_business_settings: pattern not found'; end if;
  execute replace(d, t, 'elsif k=''branchSettings'' then saved:=jsonb_set(saved,''{branchSettings}'',private.merge_branch_settings(saved->''branchSettings'',p_settings->''branchSettings'',tabs));'
                        || 'else saved:=jsonb_set(saved,array[k],p_settings->k);end if;');
end $m$;

-- Each group holds only its own settings (so a branch cannot set the business name).
create or replace function private.check_branch_settings() returns trigger
language plpgsql set search_path to '' as $f$
declare s jsonb := new.settings->'branchSettings';
begin
  if s is null then return new; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 3000000
     or exists (select 1 from jsonb_each(s) e where e.key !~ '^b-[a-z0-9]{6,20}$' or jsonb_typeof(e.value) <> 'object'
                or exists (select 1 from jsonb_each(e.value) g
                           left join private.branch_setting_groups() bg on bg.grp = g.key
                           where bg.grp is null or jsonb_typeof(g.value) <> 'object'
                              or exists (select 1 from jsonb_object_keys(g.value) k where not (k = any(bg.keys)))))
  then
    raise exception 'Invalid branch settings';
  end if;
  return new;
end $f$;
