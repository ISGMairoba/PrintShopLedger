-- Branches, stage 1 (plan: project doc plans/branches.md).
-- * Business settings gain a Branches tab: settings.branches (beyond the main one) and
--   settings.branchAccess ({ userId: ['main', 'b-…'] or ['*'] }).
-- * Every device works in one branch and says so with each request (header x-psl-branch). New
--   records are tagged with that branch (branch_id; null = the main branch), so a business that
--   adds a branch later has every record in the right place. Nothing changes for one-branch
--   businesses: they send no header and every record stays in the main branch.
-- * Also: the server's page lists now include Payees and Accounts (added on 31 Oct), so saving
--   Page access or turning those pages off from the console works.

-- Settings: the Branches tab and its keys.
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $f$
 select coalesce(array_agg(k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
 ('Dropdowns & workflow','options'),
 ('Jobs & payments','jobs'),('Jobs & payments','terms'),('Jobs & payments','discounts'),('Jobs & payments','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess')
 ) as t(tab,k) where p_tabs ? tab
$f$;

do $mig$
declare src text; n integer;
begin
  -- Page access knows Payees and Accounts; settings tabs know Branches.
  src := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  n := (length(src) - length(replace(src, $x$'Payments','Expenses','Materials'$x$, ''))) / length($x$'Payments','Expenses','Materials'$x$);
  if n <> 1 then raise exception 'check_dynamic_business_settings changed (pages); review the branches migration'; end if;
  src := replace(src, $x$'Payments','Expenses','Materials'$x$, $x$'Payments','Expenses','Payees','Accounts','Materials'$x$);
  n := (length(src) - length(replace(src, $x$'Corrections','Security'];$x$, ''))) / length($x$'Corrections','Security'];$x$);
  if n <> 1 then raise exception 'check_dynamic_business_settings changed (tabs); review the branches migration'; end if;
  src := replace(src, $x$'Corrections','Security'];$x$, $x$'Corrections','Security','Branches'];$x$);
  execute src;
  -- The console's page lists (subscription and trial: pages turned off).
  foreach src in array array[pg_get_functiondef('public.console_save_subscription(uuid,jsonb)'::regprocedure),
                              pg_get_functiondef('public.console_save_trial_settings(jsonb)'::regprocedure)] loop
    n := (length(src) - length(replace(src, $x$'Payments','Expenses','Materials'$x$, ''))) / length($x$'Payments','Expenses','Materials'$x$);
    if n <> 1 then raise exception 'console page list changed; review the branches migration'; end if;
    execute replace(src, $x$'Payments','Expenses','Materials'$x$, $x$'Payments','Expenses','Payees','Accounts','Materials'$x$);
  end loop;
end $mig$;

-- The branch this request works in: the x-psl-branch header, when it names an active branch of the
-- business that this staff member may use. Anything else (no header, 'main', a removed branch) is
-- the main branch (null). Checked once per request.
create or replace function private.request_branch(p_shop uuid) returns text
language plpgsql security definer set search_path to '' as $f$
declare
  wanted text := nullif(btrim(coalesce(current_setting('request.headers', true)::json->>'x-psl-branch', '')), '');
  cached text := current_setting('psl.branch', true);
  ok boolean;
begin
  if wanted is null or wanted = 'main' then return null; end if;
  if cached = p_shop::text || ':' || coalesce(auth.uid()::text, '') || ':' || wanted then return wanted; end if;
  if cached = p_shop::text || ':' || coalesce(auth.uid()::text, '') || ':!' || wanted then return null; end if;
  select exists (
      select 1 from public.business_settings b
      cross join lateral jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) br
      where b.shop_id = p_shop and br->>'id' = wanted and not coalesce((br->>'archived')::boolean, false))
    and (
      exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4)
      or exists (select 1 from public.business_settings b where b.shop_id = p_shop
        and (b.settings->'branchAccess'->(auth.uid()::text) ? wanted or b.settings->'branchAccess'->(auth.uid()::text) ? '*')))
    into ok;
  perform set_config('psl.branch', p_shop::text || ':' || coalesce(auth.uid()::text, '') || ':' || case when ok then '' else '!' end || wanted, true);
  return case when ok then wanted end;
end $f$;

create or replace function private.tag_branch() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if tg_op = 'INSERT' and new.branch_id is null then new.branch_id := private.request_branch(new.shop_id); end if;
  -- A device's branch follows its latest report.
  if tg_table_name = 'devices' and tg_op = 'UPDATE' then new.branch_id := private.request_branch(new.shop_id); end if;
  return new;
end $f$;

do $mig$
declare t text;
begin
  foreach t in array array['ledger_events','checkout_records','jobs','payments','expenses','drawer_closings','sale_adjustments',
                           'quotations','customer_reminders','material_stock_changes','material_waste','devices'] loop
    execute format('alter table public.%I add column if not exists branch_id text', t);
    execute format('drop trigger if exists tag_branch on public.%I', t);
    execute format('create trigger tag_branch before insert%s on public.%I for each row execute function private.tag_branch()',
      case when t = 'devices' then ' or update' else '' end, t);
  end loop;
end $mig$;

revoke all on function private.request_branch(uuid), private.tag_branch() from public, anon, authenticated;
