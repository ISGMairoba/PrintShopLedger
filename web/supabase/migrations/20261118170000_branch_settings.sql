-- Settings a branch keeps for itself (settings.branchSettings, see web/src/branches.mjs):
-- receipts & documents, dropdowns & workflow, and job settings. Whoever may save the Receipts,
-- Dropdowns & workflow or Jobs & payments tab may save a branch's own version of it.
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $function$
 select coalesce(array_agg(distinct k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),('Profile & logo','appIcon'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),('Appearance','tiles'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),('Receipts','branchSettings'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),('Dropdowns & workflow','branchSettings'),
 ('Jobs & payments','jobs'),('Jobs & payments','drawers'),('Jobs & payments','production'),('Jobs & payments','branchSettings'),
 ('Words','terms'),('Messages','messages'),('Jobs & payments','discounts'),('Default time frames','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$function$;

-- Light shape check (the app checks each group's values like the business's own).
create or replace function private.check_branch_settings() returns trigger
language plpgsql set search_path to '' as $f$
declare s jsonb := new.settings->'branchSettings';
begin
  if s is null then return new; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 1500000
     or exists (select 1 from jsonb_each(s) e where e.key !~ '^b-[a-z0-9]{6,20}$' or jsonb_typeof(e.value) <> 'object'
                or exists (select 1 from jsonb_object_keys(e.value) g where g not in ('receipts', 'workflow', 'jobs'))) then
    raise exception 'Invalid branch settings';
  end if;
  return new;
end $f$;
drop trigger if exists check_branch_settings on public.business_settings;
create trigger check_branch_settings before insert or update on public.business_settings
  for each row execute function private.check_branch_settings();
