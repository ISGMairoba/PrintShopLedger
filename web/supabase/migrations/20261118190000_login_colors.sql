-- Appearance → Sign-in page colours (settings.loginColors): saved with the Appearance tab.
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $function$
 select coalesce(array_agg(distinct k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),('Profile & logo','appIcon'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),('Appearance','tiles'),
 ('Appearance','loginColors'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),('Receipts','branchSettings'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),('Dropdowns & workflow','branchSettings'),
 ('Jobs & payments','jobs'),('Jobs & payments','drawers'),('Jobs & payments','production'),('Jobs & payments','branchSettings'),
 ('Words','terms'),('Messages','messages'),('Jobs & payments','discounts'),('Default time frames','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$function$;

-- Sign-in colours: two #rrggbb colours, or none (PrintShopLedger's own).
create or replace function private.check_login_colors() returns trigger
language plpgsql set search_path to '' as $f$
declare c jsonb := new.settings->'loginColors';
begin
  if c is null or jsonb_typeof(c) = 'null' then return new; end if;
  if jsonb_typeof(c) <> 'object' or coalesce(c->>'primary', '') !~* '^#[0-9a-f]{6}$' or coalesce(c->>'accent', '') !~* '^#[0-9a-f]{6}$'
     or exists (select 1 from jsonb_object_keys(c) k where k not in ('primary', 'accent')) then
    raise exception 'Choose valid sign-in colours';
  end if;
  return new;
end $f$;
drop trigger if exists check_login_colors on public.business_settings;
create trigger check_login_colors before insert or update on public.business_settings
  for each row execute function private.check_login_colors();
