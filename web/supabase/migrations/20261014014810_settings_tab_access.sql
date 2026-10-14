-- Every page can be set separately, and Business Settings can be given to Admin and Manager with
-- a chosen set of tabs. Admin and Manager only change the settings on their tabs; page access and
-- tab access stay Developer only.

create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path='' as $$
 select coalesce(array_agg(k),'{}') from (values
  ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
  ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
  ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
  ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
  ('Dropdowns & workflow','options'),
  ('Jobs & payments','jobs'),('Jobs & payments','terms'),('Jobs & payments','discounts'),('Jobs & payments','periods'),
  ('Pricing templates','pricing'),
  ('Corrections','corrections')
 ) as t(tab,k) where p_tabs ? tab $$;

create or replace function public.save_business_settings(p_shop uuid, p_version integer, p_settings jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
-- Security definer so Admin and Manager can save their tabs; the table policies stay Developer only.
declare result public.business_settings%rowtype;lvl integer;saved jsonb;keys text[];k text;
begin
 select m.access_level into lvl from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid() and not m.archived;
 if auth.uid() is null or lvl is null or lvl<2 then raise exception 'Business settings access required';end if;
 perform 1 from public.shops where id=p_shop for update;
 if lvl<4 then
  -- Admin and Manager: only with Business Settings page access, and only the settings on their tabs.
  select settings into saved from public.business_settings where shop_id=p_shop;
  if saved is null or p_version=0 then raise exception 'Developer maintenance access required';end if;
  if not coalesce(saved->'pageAccess'->lvl::text ? 'Business Settings',false) then raise exception 'Business settings access required';end if;
  keys:=private.settings_tab_keys(coalesce(saved->'settingsTabs'->lvl::text,
   '["Profile & logo","Appearance","Receipts","Dropdowns & workflow","Jobs & payments","Pricing templates","Corrections"]'::jsonb));
  if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'Invalid business settings';end if;
  foreach k in array keys loop
   if p_settings ? k then saved:=jsonb_set(saved,array[k],p_settings->k);end if;
  end loop;
  p_settings:=saved;
 end if;
 if p_version=0 then
  insert into public.business_settings(shop_id,settings,modified_by)values(p_shop,p_settings,auth.uid())on conflict do nothing returning * into result;
 else
  update public.business_settings set settings=p_settings where shop_id=p_shop and version=p_version returning * into result;
 end if;
 if result.shop_id is null then raise exception 'Business settings changed. Reload the saved version before editing.' using errcode='PT409';end if;
 return to_jsonb(result);
end $function$;

create or replace function private.check_dynamic_business_settings() returns trigger
language plpgsql set search_path='' as $function$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;
 known text[]:=array['Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
  'Payment Reminders','Payments','Expenses','Materials','Services','Edit Products','Stock History','Print Settings','Users',
  'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
 tabs text[]:=array['Profile & logo','Appearance','Receipts','Dropdowns & workflow','Jobs & payments','Pricing templates','Corrections'];
begin
 if config ? 'corrections' and (jsonb_typeof(config->'corrections') is distinct from 'object' or jsonb_typeof(config->'corrections'->'recentDays') is distinct from 'number' or (config->'corrections'->>'recentDays')::numeric<>trunc((config->'corrections'->>'recentDays')::numeric) or (config->'corrections'->>'recentDays')::numeric not between 1 and 365) then raise exception 'Choose a correction history window from 1 to 365 days';end if;
 if config ? 'pageAccess' then
  if jsonb_typeof(config->'pageAccess') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3')) then raise exception 'Invalid page access settings';end if;
  foreach rank_key in array array['1','2','3'] loop
   allowed=config->'pageAccess'->rank_key;if rank_key='3' and allowed is null then continue;end if;
   if jsonb_typeof(allowed) is distinct from 'array' or not allowed ? 'My Account' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed)) then raise exception 'Invalid page access settings';end if;
   for page in select value from jsonb_array_elements(allowed) loop
    if jsonb_typeof(page) is distinct from 'string' or not (page#>>'{}')=any(known) or rank_key='1' and page#>>'{}' in ('Dashboard','Reports','Edit Products','Users','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste') then raise exception 'Restricted page access';end if;
   end loop;
  end loop;
 end if;
 if config ? 'pageAccessVersion' and config->'pageAccessVersion' is distinct from '2'::jsonb then raise exception 'Invalid page access settings';end if;
 if config ? 'settingsTabs' then
  if jsonb_typeof(config->'settingsTabs') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'settingsTabs') key where key not in ('2','3')) then raise exception 'Invalid Business Settings tab access';end if;
  for rank_key in select key from jsonb_object_keys(config->'settingsTabs') key loop
   allowed=config->'settingsTabs'->rank_key;
   if jsonb_typeof(allowed) is distinct from 'array' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed))
    or exists(select 1 from jsonb_array_elements(allowed) t where jsonb_typeof(t.value) is distinct from 'string' or not (t.value#>>'{}')=any(tabs)) then
    raise exception 'Invalid Business Settings tab access';
   end if;
  end loop;
 end if;
 return new;
end;$function$;
