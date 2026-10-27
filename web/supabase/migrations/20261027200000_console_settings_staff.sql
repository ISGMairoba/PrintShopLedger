-- Developer console, part 2: change a business's settings and staff from the console.
-- * console_business_settings / console_save_business_settings: the same checks as the Business
--   Settings page (the table's own triggers check every setting); the console acts with all tabs.
-- * Staff: the console acts like the business's Developer (rank 4) in the existing user rules.
-- Every change is written to the console activity log.

create or replace function public.console_business_settings(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return (select jsonb_build_object('settings', b.settings, 'version', b.version, 'modifiedAt', b.modified_at)
          from public.business_settings b where b.shop_id = p_shop);
end $f$;

create or replace function public.console_save_business_settings(p_shop uuid, p_version integer, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare before jsonb; result public.business_settings%rowtype; changed text[];
begin
  perform private.require_console();
  if jsonb_typeof(p_settings) is distinct from 'object' then raise exception 'Invalid business settings'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select settings into before from public.business_settings where shop_id = p_shop;
  if before is null then raise exception 'This business has no saved settings yet. Open it once in the app first.'; end if;
  update public.business_settings set settings = p_settings where shop_id = p_shop and version = p_version returning * into result;
  if result.shop_id is null then raise exception 'Business settings changed. Reload the saved version before editing.' using errcode = 'PT409'; end if;
  select coalesce(array_agg(k order by k), '{}') into changed from (
    select key k from jsonb_each(p_settings) where before->key is distinct from value
    union select key from jsonb_each(before) where not p_settings ? key) x;
  perform private.console_log(p_shop, 'settings.saved', jsonb_build_object('version', result.version, 'changed', to_jsonb(changed)));
  return to_jsonb(result);
end $f$;

-- Staff: the existing rules, with the console acting as the business's Developer.
do $mig$
declare src text; a text; b text;
begin
  src := pg_get_functiondef('public.save_shop_user_internal(uuid,text,jsonb)'::regprocedure);
  a := $x$ if not found then raise exception 'User management access denied'; end if;$x$;
  b := $x$ if not found then
  if private.console_role() is null then raise exception 'User management access denied'; end if;
  -- The developer console acts like the business's Developer.
  v_actor.rank := 4; v_actor.user_id := auth.uid();
 end if;$x$;
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'save_shop_user_internal changed; review the console staff migration'; end if;
  execute replace(src, a, b);
end $mig$;

create or replace function public.console_save_staff(p_shop uuid, p_action text, p_data jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare who text;
begin
  perform private.require_console();
  if p_action = 'create' then raise exception 'Use the console to add staff.'; end if;
  select name into who from public.shop_members where shop_id = p_shop and id = (p_data->>'id')::uuid;
  perform public.save_shop_user_internal(p_shop, p_action, p_data);
  perform private.console_log(p_shop, 'staff.' || p_action, jsonb_build_object('staff', who, 'id', p_data->>'id',
    'role', p_data->>'role', 'name', p_data->>'name', 'username', p_data->>'username'));
end $f$;

-- The console's staff server function checks the target before setting a password or adding staff.
create or replace function public.console_staff_account(p_shop uuid, p_member uuid) returns uuid
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return (select user_id from public.shop_members where shop_id = p_shop and id = p_member);
end $f$;
create or replace function public.console_log_action(p_shop uuid, p_action text, p_details jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console();
  if p_action not in ('staff.created', 'staff.password_reset', 'team.password_reset') then raise exception 'Unknown console action'; end if;
  perform private.console_log(p_shop, p_action, p_details);
end $f$;

-- The business overview now carries each staff member's version (needed to change them).
do $mig$
declare src text; a text := $x$'id', m.id, 'name', m.name,$x$; b text := $x$'id', m.id, 'version', m.version, 'name', m.name,$x$;
begin
  src := pg_get_functiondef('public.console_business(uuid)'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'console_business changed; review the console staff migration'; end if;
  execute replace(src, a, b);
end $mig$;

revoke all on function public.console_business_settings(uuid), public.console_save_business_settings(uuid,integer,jsonb),
  public.console_save_staff(uuid,text,jsonb), public.console_staff_account(uuid,uuid), public.console_log_action(uuid,text,jsonb) from public, anon;
grant execute on function public.console_business_settings(uuid), public.console_save_business_settings(uuid,integer,jsonb),
  public.console_save_staff(uuid,text,jsonb), public.console_staff_account(uuid,uuid), public.console_log_action(uuid,text,jsonb) to authenticated;
