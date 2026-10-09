-- Only Developers may maintain business configuration; all staff still read branding needed by the app.
alter policy business_settings_insert on public.business_settings with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level=4));
alter policy business_settings_update on public.business_settings using(exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level=4)) with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level=4));
alter policy business_history_read on public.business_settings_history using(exists(select 1 from public.shop_members m where m.shop_id=business_settings_history.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level=4));
alter policy business_history_insert on public.business_settings_history with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings_history.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level=4));
alter policy manager_business_name on public.shops using(exists(select 1 from public.shop_members m where m.shop_id=shops.id and m.user_id=auth.uid() and not m.archived and m.access_level=4)) with check(exists(select 1 from public.shop_members m where m.shop_id=shops.id and m.user_id=auth.uid() and not m.archived and m.access_level=4));
do $migration$
declare definition text;
begin
 definition=pg_get_functiondef('public.save_business_settings(uuid,integer,jsonb)'::regprocedure);
 definition=replace(definition,'m.access_level>=3','m.access_level=4');
 definition=replace(definition,'Manager or Developer access required','Developer maintenance access required');
 execute definition;
 definition=pg_get_functiondef('private.apply_supervised_event(uuid,jsonb)'::regprocedure);
 definition=replace(definition,'if role_access=2 and configured','if role_access in (2,3) and configured');
 execute definition;
end;$migration$;
create or replace function private.check_dynamic_business_settings() returns trigger language plpgsql security invoker set search_path='' as $$
declare config jsonb:=new.settings;rank_key text;allowed jsonb;page jsonb;known text[]:=array['Point of Service','My Sales','Jobs','Customers','Payments','Expenses','Materials','Services','Stock History','Print Settings','Users','My Account','Business Settings','Conflict Inbox','Sale Adjustments','Material Waste'];
begin
 if config ? 'corrections' and (jsonb_typeof(config->'corrections') is distinct from 'object' or jsonb_typeof(config->'corrections'->'recentDays') is distinct from 'number' or (config->'corrections'->>'recentDays')::numeric<>trunc((config->'corrections'->>'recentDays')::numeric) or (config->'corrections'->>'recentDays')::numeric not between 1 and 365) then raise exception 'Choose a correction history window from 1 to 365 days';end if;
 if config ? 'pageAccess' then
  if jsonb_typeof(config->'pageAccess') is distinct from 'object' or exists(select 1 from jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3')) then raise exception 'Invalid page access settings';end if;
  foreach rank_key in array array['1','2','3'] loop
   allowed=config->'pageAccess'->rank_key;if rank_key='3' and allowed is null then continue;end if;
   if jsonb_typeof(allowed) is distinct from 'array' or not allowed ? 'My Account' or jsonb_array_length(allowed)<>(select count(distinct value) from jsonb_array_elements(allowed)) then raise exception 'Invalid page access settings';end if;
   for page in select value from jsonb_array_elements(allowed) loop
    if jsonb_typeof(page) is distinct from 'string' or not (page#>>'{}')=any(known) or page#>>'{}'='Business Settings' or rank_key='1' and page#>>'{}' in ('Users','Conflict Inbox','Sale Adjustments','Material Waste') then raise exception 'Restricted page access';end if;
   end loop;
  end loop;
 end if;
 return new;
end;$$;
