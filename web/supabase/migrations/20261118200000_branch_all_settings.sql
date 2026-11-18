-- Every setting can be a branch's own (settings.branchSettings[branch][group], see web/src/branches.mjs)
-- except the business name, the branches and who works where, page access, the business type and
-- the Developer's items. Whoever may save a tab may save a branch's own version of it.
-- (Includes Appearance → Sign-in page colours, so it can run before or after that change.)
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $function$
 select coalesce(array_agg(distinct k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),('Profile & logo','appIcon'),('Profile & logo','branchSettings'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),('Appearance','tiles'),
 ('Appearance','loginColors'),('Appearance','branchSettings'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),('Receipts','branchSettings'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),('Dropdowns & workflow','branchSettings'),
 ('Jobs & payments','jobs'),('Jobs & payments','drawers'),('Jobs & payments','production'),('Jobs & payments','discounts'),
 ('Jobs & payments','branchSettings'),
 ('Words','terms'),('Words','branchSettings'),('Messages','messages'),('Messages','branchSettings'),
 ('Default time frames','periods'),('Default time frames','branchSettings'),
 ('Pricing templates','pricing'),('Pricing templates','branchSettings'),
 ('Corrections','corrections'),('Corrections','branchSettings'),('Security','security'),('Security','branchSettings'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$function$;

create or replace function private.check_branch_settings() returns trigger
language plpgsql set search_path to '' as $f$
declare s jsonb := new.settings->'branchSettings';
begin
  if s is null then return new; end if;
  if jsonb_typeof(s) <> 'object' or octet_length(s::text) > 3000000
     or exists (select 1 from jsonb_each(s) e where e.key !~ '^b-[a-z0-9]{6,20}$' or jsonb_typeof(e.value) <> 'object'
                or exists (select 1 from jsonb_object_keys(e.value) g where g not in
                  ('profile', 'appearance', 'receipts', 'workflow', 'jobs', 'words', 'messages', 'periods', 'pricing', 'corrections', 'security'))) then
    raise exception 'Invalid branch settings';
  end if;
  return new;
end $f$;
