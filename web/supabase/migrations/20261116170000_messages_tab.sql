-- Business Settings → Messages: the wording and sending of every message the app sends
-- (settings.messages). A tab of its own that Admins and Managers can be given; ranks that had
-- Jobs & payments (where the "order ready" wording used to be) get it automatically.

-- 1. The Messages tab saves settings.messages.
create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $function$
 select coalesce(array_agg(k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),('Profile & logo','appIcon'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),
 ('Jobs & payments','jobs'),('Jobs & payments','drawers'),('Jobs & payments','production'),('Words','terms'),('Messages','messages'),('Jobs & payments','discounts'),('Default time frames','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$function$;

-- 2. Saving: ranks with Jobs & payments get Messages until the business saves tab access again
--    (settingsTabsVersion 4).
create or replace function public.save_business_settings(p_shop uuid, p_version integer, p_settings jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
-- Security definer so Admin and Manager can save their tabs; the table policies stay Developer only.
declare result public.business_settings%rowtype;lvl integer;saved jsonb;keys text[];k text;tabs jsonb;
begin
 select m.access_level into lvl from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid() and not m.archived;
 if auth.uid() is null or lvl is null or lvl<2 then raise exception 'Business settings access required';end if;
 perform 1 from public.shops where id=p_shop for update;
 if lvl<5 then
  -- Admin and Manager: only with Business Settings page access, and only the settings on their tabs.
  select settings into saved from public.business_settings where shop_id=p_shop;
  if saved is null or p_version=0 then raise exception 'Developer maintenance access required';end if;
  if not coalesce(coalesce(saved->'pageAccess'->lvl::text, case when lvl=4 then saved->'pageAccess'->'3' end) ? 'Business Settings',false) then raise exception 'Business settings access required';end if;
  tabs:=coalesce(coalesce(saved->'settingsTabs'->lvl::text, case when lvl=4 then saved->'settingsTabs'->'3' end),'["Profile & logo","Appearance","Receipts","Payment methods","Dropdowns & workflow","Jobs & payments","Pricing templates","Corrections","Security","Branches"]'::jsonb);
  if coalesce((saved->>'settingsTabsVersion')::int,0)<1 and tabs ? 'Dropdowns & workflow' and not tabs ? 'Payment methods' then tabs:=tabs||'"Payment methods"'::jsonb;end if;
  if coalesce((saved->>'settingsTabsVersion')::int,0)<2 and tabs ? 'Jobs & payments' then tabs:=tabs||'["Default time frames","Words"]'::jsonb;end if;
  if coalesce((saved->>'settingsTabsVersion')::int,0)<4 and tabs ? 'Jobs & payments' and not tabs ? 'Messages' then tabs:=tabs||'"Messages"'::jsonb;end if;
  keys:=private.settings_tab_keys(tabs);
  if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'Invalid business settings';end if;
  foreach k in array keys loop
   continue when k='branchAccess' and lvl<4;
   if p_settings ? k then
    if k='options' and not (tabs ? 'Dropdowns & workflow') then
     saved:=jsonb_set(saved,'{options}',(saved->'options')||jsonb_build_object('paymentMethods',p_settings->'options'->'paymentMethods'));
    elsif k='options' and not (tabs ? 'Payment methods') then
     saved:=jsonb_set(saved,'{options}',(p_settings->'options')||jsonb_build_object('paymentMethods',saved->'options'->'paymentMethods'));
    else saved:=jsonb_set(saved,array[k],p_settings->k);end if;
   end if;
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

-- 3. Checks: Messages is a tab that can be given; settings.messages is a small object of wordings.
create or replace function private.check_messages() returns trigger
language plpgsql set search_path to '' as $function$
declare m jsonb := new.settings->'messages'; item record;
begin
  if m is null then return new; end if;
  if jsonb_typeof(m) <> 'object' or octet_length(m::text) > 20000
     or coalesce(m->>'send', 'whatsapp') not in ('whatsapp', 'share')
     or (m ? 'items' and jsonb_typeof(m->'items') <> 'object') then
    raise exception 'Invalid message settings';
  end if;
  for item in select key, value from jsonb_each(coalesce(m->'items', '{}')) loop
    if item.key not in ('ready', 'receipt', 'quotation', 'reminder', 'statement', 'delivery', 'options', 'reorder')
       or jsonb_typeof(item.value) <> 'object'
       or (item.value ? 'text' and (jsonb_typeof(item.value->'text') <> 'string' or length(item.value->>'text') > 1000))
       or coalesce(item.value->>'send', 'default') not in ('default', 'whatsapp', 'share') then
      raise exception 'Invalid message settings';
    end if;
  end loop;
  return new;
end $function$;
drop trigger if exists check_messages on public.business_settings;
create trigger check_messages before insert or update on public.business_settings
  for each row execute function private.check_messages();

-- 4. Tab access may include Messages (same function, one more tab name).
create or replace function private.check_dynamic_business_settings() returns trigger
language plpgsql set search_path to '' as $function$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;
 known text[]:=array['Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
  'Payment Reminders','Payments','Expenses','Payees','Accounts','Materials','Services','Edit Products','Stock History','Print Settings','Users',
  'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
 tabs text[]:=array['Profile & logo','Appearance','Receipts','Payment methods','Dropdowns & workflow','Jobs & payments','Default time frames','Words','Messages','Pricing templates','Corrections','Security','Branches'];
begin
 if config ? 'security' and (jsonb_typeof(config->'security') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(config->'security') key where key not in ('autoLockMinutes','syncMinutes','historyKeep'))
   or jsonb_typeof(config->'security'->'autoLockMinutes') is distinct from 'number'
   or (config->'security'->>'autoLockMinutes')::numeric<>trunc((config->'security'->>'autoLockMinutes')::numeric)
   or (config->'security'->>'autoLockMinutes')::numeric not between 0 and 240) then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;
 if config->'security' ? 'syncMinutes' and (jsonb_typeof(config->'security'->'syncMinutes') is distinct from 'number'
   or (config->'security'->>'syncMinutes')::numeric<>trunc((config->'security'->>'syncMinutes')::numeric)
   or (config->'security'->>'syncMinutes')::numeric not between 1 and 60) then raise exception 'Choose a sync check time from 1 to 60 minutes';end if;
 if config->'security' ? 'historyKeep' and coalesce(config->'security'->>'historyKeep','') not in ('7d','14d','30d','3m','6m','12m')
   then raise exception 'Choose how much history devices keep';end if;
 if config ? 'corrections' and (jsonb_typeof(config->'corrections') is distinct from 'object' or jsonb_typeof(config->'corrections'->'recentDays') is distinct from 'number' or (config->'corrections'->>'recentDays')::numeric<>trunc((config->'corrections'->>'recentDays')::numeric) or (config->'corrections'->>'recentDays')::numeric not between 1 and 365) then raise exception 'Choose a correction history window from 1 to 365 days';end if;
 if config ? 'pageAccess' then
  if jsonb_typeof(config->'pageAccess') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3','4')) then raise exception 'Invalid page access settings';end if;
  foreach rank_key in array array['1','2','3','4'] loop
   allowed=config->'pageAccess'->rank_key;if rank_key in ('3','4') and allowed is null then continue;end if;
   if jsonb_typeof(allowed) is distinct from 'array' or not allowed ? 'My Account' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed)) then raise exception 'Invalid page access settings';end if;
   for page in select value from jsonb_array_elements(allowed) loop
    if jsonb_typeof(page) is distinct from 'string' or not (page#>>'{}')=any(known) or rank_key='1' and page#>>'{}' in ('Dashboard','Reports','Edit Products','Users','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste') then raise exception 'Restricted page access';end if;
   end loop;
  end loop;
 end if;
 if config ? 'pageAccessVersion' and config->'pageAccessVersion' not in ('2'::jsonb,'3'::jsonb) then raise exception 'Invalid page access settings';end if;
 if config ? 'settingsTabs' then
  if jsonb_typeof(config->'settingsTabs') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'settingsTabs') key where key not in ('2','3','4')) then raise exception 'Invalid Business Settings tab access';end if;
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
