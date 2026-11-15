-- Installed app icon (Business Settings → Profile & logo): settings.appIcon holds the chosen logo
-- layout, the background color and the 512 px PNG the app draws from them. The app-icon function
-- hands the PNG and a matching manifest out publicly, so keep it to a small, plain PNG.
-- 1. Admins and managers with the Profile & logo tab may save it.
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $function$
 select coalesce(array_agg(k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),('Profile & logo','appIcon'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),
 ('Jobs & payments','jobs'),('Jobs & payments','drawers'),('Jobs & payments','production'),('Words','terms'),('Jobs & payments','discounts'),('Default time frames','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$function$;

-- 2. Its shape: { layout, background, png } with a PNG data URL of up to 400,000 characters.
create or replace function private.check_app_icon() returns trigger
language plpgsql set search_path to '' as $function$
declare a jsonb := new.settings->'appIcon';
begin
  if a is null then return new; end if;
  if jsonb_typeof(a) <> 'object' or exists (select 1 from jsonb_object_keys(a) k where k not in ('layout', 'background', 'png'))
     or coalesce(a->>'layout', '') not in ('none', 'complete', 'stacked', 'horizontal', 'wordmark', 'icon')
     or coalesce(a->>'background', '') !~* '^#[0-9a-f]{6}$'
     or jsonb_typeof(a->'png') is distinct from 'string' or length(a->>'png') > 400000
     or (a->>'png' <> '' and a->>'png' !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'Invalid app icon';
  end if;
  return new;
end $function$;
drop trigger if exists check_app_icon on public.business_settings;
create trigger check_app_icon before insert or update on public.business_settings
  for each row execute function private.check_app_icon();
