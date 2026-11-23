-- Lock screen (plans/lock-screen.md): the new Security choices are accepted, an Admin or above can
-- clear someone's PIN, and using up the PIN tries sends a notice to Admins and above.

-- 1. Business settings: the lock screen choices (only kept when changed from their defaults).
CREATE OR REPLACE FUNCTION private.check_dynamic_business_settings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;
 known text[]:=array['Dashboard','Reports','Point of Service','Quotations','Pricing Templates','My Sales','Jobs','Customers',
  'Payment Reminders','Payments','Expenses','Payees','Accounts','Materials','Services','Edit Products','Stock History','Print Settings','Users',
  'My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
 tabs text[]:=array['Profile & logo','Appearance','Receipts','Payment methods','Dropdowns & workflow','Jobs & payments','Default time frames','Words','Messages','Pricing templates','Corrections','Security','Branches'];
begin
 if config ? 'security' and (jsonb_typeof(config->'security') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(config->'security') key where key not in ('autoLockMinutes','syncMinutes','historyKeep','lockOnOpen','limitsBlockActions','minPinLength','pinTries','requirePin','rememberPeople','rememberDays','rememberMax','allowBiometric'))
   or jsonb_typeof(config->'security'->'autoLockMinutes') is distinct from 'number'
   or (config->'security'->>'autoLockMinutes')::numeric<>trunc((config->'security'->>'autoLockMinutes')::numeric)
   or (config->'security'->>'autoLockMinutes')::numeric not between 0 and 240) then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;
 if config->'security' ? 'limitsBlockActions' and jsonb_typeof(config->'security'->'limitsBlockActions') is distinct from 'boolean' then raise exception 'Choose whether page limits also block their actions';end if;
 -- Lock screen choices (plans/lock-screen.md); left out when at their defaults.
 if config->'security' ? 'minPinLength' and (jsonb_typeof(config->'security'->'minPinLength') is distinct from 'number' or (config->'security'->>'minPinLength') not in ('4','5','6')) then raise exception 'Choose a minimum PIN length of 4, 5 or 6 digits';end if;
 if config->'security' ? 'pinTries' and (jsonb_typeof(config->'security'->'pinTries') is distinct from 'number' or (config->'security'->>'pinTries') not in ('3','5','10')) then raise exception 'Choose 3, 5 or 10 PIN tries';end if;
 if config->'security' ? 'requirePin' and jsonb_typeof(config->'security'->'requirePin') is distinct from 'boolean' then raise exception 'Choose whether staff must have a PIN';end if;
 if config->'security' ? 'rememberPeople' and jsonb_typeof(config->'security'->'rememberPeople') is distinct from 'boolean' then raise exception 'Choose whether devices remember the people who sign in';end if;
 if config->'security' ? 'rememberDays' and (jsonb_typeof(config->'security'->'rememberDays') is distinct from 'number' or (config->'security'->>'rememberDays') !~ '^[0-9]+$' or (config->'security'->>'rememberDays')::int not between 1 and 90) then raise exception 'Choose how long a device remembers someone: 1 to 90 days';end if;
 if config->'security' ? 'rememberMax' and (jsonb_typeof(config->'security'->'rememberMax') is distinct from 'number' or (config->'security'->>'rememberMax') !~ '^[0-9]+$' or (config->'security'->>'rememberMax')::int not between 2 and 20) then raise exception 'Choose how many people a device remembers: 2 to 20';end if;
 if config->'security' ? 'allowBiometric' and jsonb_typeof(config->'security'->'allowBiometric') is distinct from 'boolean' then raise exception 'Choose whether face/fingerprint unlock is allowed';end if;
 if config->'security' ? 'lockOnOpen' and jsonb_typeof(config->'security'->'lockOnOpen') is distinct from 'boolean' then raise exception 'Choose whether the app locks when opened';end if;
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

-- 2. Clear someone's PIN (Users page): Admins and above, for someone of lower rank (a Developer for
-- anyone). They then set a new one at their next sign-in; their face/fingerprint unlock goes with it.
create or replace function public.clear_member_pin(p_shop uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me record; them record;
begin
  select rank, access_level into me from public.shop_members
   where shop_id = p_shop and user_id = auth.uid() and not archived and access_level > 0;
  if me is null or me.access_level < 2 then raise exception 'Only Admins and above can clear a PIN' using errcode = '42501'; end if;
  select rank into them from public.shop_members where shop_id = p_shop and user_id = p_user;
  if them is null then raise exception 'Person not found'; end if;
  if p_user = auth.uid() then raise exception 'Change your own PIN in My Account'; end if;
  if me.rank < 5 and them.rank >= me.rank then raise exception 'You can only clear the PIN of someone below your rank' using errcode = '42501'; end if;
  delete from private.member_pins where shop_id = p_shop and user_id = p_user;
end $$;
revoke all on function public.clear_member_pin(uuid, uuid) from public, anon;
grant execute on function public.clear_member_pin(uuid, uuid) to authenticated;

-- 3. Wrong PIN tries used up: a notice for Admins and above (at most one per person per 10 minutes).
-- Sent by whoever is signed in on that device next time it is online.
create or replace function public.report_pin_lockout(p_shop uuid, p_user uuid, p_device text)
returns void language plpgsql security definer set search_path = '' as $$
declare me record; who text; v_title text;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  select coalesce(nullif(btrim(name), ''), username) into who from public.shop_members where shop_id = p_shop and user_id = p_user;
  if who is null then return; end if;
  v_title := left('Wrong PIN tries: ' || who, 120);
  if exists (select 1 from public.notices where shop_id = p_shop and title = v_title and created_at > now() - interval '10 minutes')
     or (select count(*) from public.notices where shop_id = p_shop and not archived) >= 200 then return; end if;
  insert into public.notices (id, shop_id, title, body, pinned, min_level, created_by, created_by_label, branch_id)
  values (gen_random_uuid(), p_shop, v_title,
    left(who || ' used up their PIN tries on ' || coalesce(nullif(btrim(p_device), ''), 'a device') || ' at '
      || to_char(now() at time zone 'Africa/Lagos', 'HH24:MI, DD Mon') || '. They now need their password to sign in.', 4000),
    false, 2, auth.uid(), me.label, '*');
end $$;
revoke all on function public.report_pin_lockout(uuid, uuid, text) from public, anon;
grant execute on function public.report_pin_lockout(uuid, uuid, text) to authenticated;
