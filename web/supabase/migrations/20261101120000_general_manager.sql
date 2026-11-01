-- Ranks: 1 Cashier, 2 Admin, 3 Manager, 4 General Manager, 5 Developer.
-- * The General Manager is the business account (the person who registered the business). It is
--   given at registration and cannot be created, given or removed on the Users page. A GM can do
--   everything in the business a Developer could (every branch, who works where, managing staff
--   below them, Managers included); only a Developer can change or turn off the GM.
-- * Pages and Business Settings tabs: the GM is set like a Manager (Developer chooses what Admin,
--   Manager and GM may open). Page access, Account setup and Installer credit stay Developer only.
-- * Existing businesses: the business account becomes GM, Developer Maintenance moves to 5, and the
--   GM uses the Manager's page and settings access until Developer sets the GM's own (nothing
--   changes for today's owners).
-- * Also: "Who works where" (Branches → branchAccess) can only be changed by the GM or Developer;
--   changing due dates needs Admin or higher.

-- 1. Settings may carry the GM's own page and settings-tab access (key '4').
do $mig$
declare src text; fixes text[][] := array[
  array[$x$jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3')$x$, $x$jsonb_object_keys(config->'pageAccess') key where key not in ('1','2','3','4')$x$],
  array[$x$foreach rank_key in array array['1','2','3'] loop$x$, $x$foreach rank_key in array array['1','2','3','4'] loop$x$],
  array[$x$if rank_key='3' and allowed is null then continue;$x$, $x$if rank_key in ('3','4') and allowed is null then continue;$x$],
  array[$x$jsonb_object_keys(config->'settingsTabs') key where key not in ('2','3')$x$, $x$jsonb_object_keys(config->'settingsTabs') key where key not in ('2','3','4')$x$]
]; i integer;
begin
  src := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  for i in 1 .. array_length(fixes, 1) loop
    if (length(src) - length(replace(src, fixes[i][1], ''))) / length(fixes[i][1]) <> 1 then
      raise exception 'check_dynamic_business_settings changed (%); review the general manager migration', left(fixes[i][1], 50);
    end if;
    src := replace(src, fixes[i][1], fixes[i][2]);
  end loop;
  execute src;
end $mig$;

-- 2. Roles and ranks.
alter table public.shop_members drop constraint if exists shop_members_role_check;
alter table public.shop_members drop constraint if exists staff_rank;
update public.shop_members set rank = 5, access_level = case when access_level > 0 then 5 else 0 end, version = version + 1
  where role = 'developer' and rank = 4;
update public.shop_members m set role = 'general_manager', rank = 4, access_level = case when m.access_level > 0 then 4 else 0 end, version = m.version + 1
  from public.business_accounts b where b.shop_id = m.shop_id and b.user_id = m.user_id and m.role <> 'developer';
alter table public.shop_members add constraint shop_members_role_check
  check (role = any (array['cashier', 'admin', 'manager', 'general_manager', 'developer']));
alter table public.shop_members add constraint staff_rank check (rank between 1 and 5 and rank = case role
  when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 when 'general_manager' then 4 else 5 end);

-- 3. Functions.
do $mig$
declare
  fixes text[][] := array[
    array['public.activate_registered_developer(uuid)', 'rank = 4', 'rank = 5'],
    array['public.activate_registered_developer(uuid)', 'access_level = 4', 'access_level = 5'],
    array['public.finish_developer_activation(text,uuid,boolean)', 'access_level=4', 'access_level=5'],
    array['public.finish_developer_activation(text,uuid,boolean)', 'rank=4', 'rank=5'],
    array['private.complete_business_registration(uuid,uuid,text,text,text,text)',
      $x$(v_shop,p_owner,'manager',btrim(p_owner_name),'manager',3,3,p_owner,p_owner)$x$,
      $x$(v_shop,p_owner,'general_manager',btrim(p_owner_name),'manager',4,4,p_owner,p_owner)$x$],
    array['private.complete_business_registration(uuid,uuid,text,text,text,text)',
      $x$'developer','Developer Maintenance','developer',4,0$x$, $x$'developer','Developer Maintenance','developer',5,0$x$],
    array['public.apply_service_event(uuid,jsonb)', $x$role in ('admin','manager','developer')$x$, $x$role in ('admin','manager','general_manager','developer')$x$],
    array['public.authorize_staff_password_reset(uuid,uuid,integer)', 'a.rank=4 or', 'a.rank=5 or'],
    array['private.apply_operations_event(uuid,jsonb)', 'lvl<>4', 'lvl<>5'],
    array['private.apply_operations_event(uuid,jsonb)', $x$(k<>'job.due_changed' and lvl<2)$x$, 'lvl<2'],
    array['private.apply_reviewed_operation(uuid,jsonb,uuid)', 'access_level=4', 'access_level=5'],
    array['private.apply_supervised_event(uuid,jsonb)', $x$select settings->'pageAccess'->role_access::text into configured$x$,
      $x$select coalesce(settings->'pageAccess'->role_access::text, case when role_access=4 then settings->'pageAccess'->'3' end) into configured$x$],
    array['private.apply_supervised_event(uuid,jsonb)', 'if role_access in (2,3) and configured', 'if role_access in (2,3,4) and configured'],
    array['public.save_business_settings(uuid,integer,jsonb)', 'if lvl<4 then', 'if lvl<5 then'],
    array['public.save_business_settings(uuid,integer,jsonb)', $x$saved->'pageAccess'->lvl::text$x$,
      $x$coalesce(saved->'pageAccess'->lvl::text, case when lvl=4 then saved->'pageAccess'->'3' end)$x$],
    array['public.save_business_settings(uuid,integer,jsonb)', $x$saved->'settingsTabs'->lvl::text$x$,
      $x$coalesce(saved->'settingsTabs'->lvl::text, case when lvl=4 then saved->'settingsTabs'->'3' end)$x$],
    array['public.save_business_settings(uuid,integer,jsonb)', 'foreach k in array keys loop',
      'foreach k in array keys loop' || chr(10) || $x$   continue when k='branchAccess' and lvl<4;$x$]
  ];
  fn text; src text; cur text := ''; pending text := ''; i integer;
begin
  for i in 1 .. array_length(fixes, 1) loop
    fn := fixes[i][1];
    if fn <> cur then
      if cur <> '' then execute pending; end if;
      cur := fn; pending := pg_get_functiondef(fn::regprocedure);
    end if;
    if (length(pending) - length(replace(pending, fixes[i][2], ''))) / length(fixes[i][2]) <> 1 then
      raise exception '% changed (%); review the general manager migration', fn, left(fixes[i][2], 50);
    end if;
    pending := replace(pending, fixes[i][2], fixes[i][3]);
  end loop;
  execute pending;
end $mig$;

create or replace function public.save_shop_user_internal(p_shop uuid, p_action text, p_data jsonb)
 returns void language plpgsql security definer set search_path to '' as $function$
declare v_row public.shop_members%rowtype; v_actor public.shop_members%rowtype; v_user uuid; v_name text; v_username text; v_role text; v_rank integer; v_access integer;
begin
 perform 1 from public.shops where id=p_shop for update;
 select * into v_actor from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2;
 if not found then
  if private.console_role() is null then raise exception 'User management access denied'; end if;
  -- The developer console acts like the business's Developer.
  v_actor.rank := 5; v_actor.user_id := auth.uid();
 end if;
 if p_action is null or p_action not in ('create','edit','archive','restore','grant','revoke') then raise exception 'Unknown user action'; end if;
 if p_action in ('create','edit') then
  v_name=btrim(p_data->>'name');v_username=lower(btrim(p_data->>'username'));v_role=p_data->>'role';
  v_rank=case v_role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 when 'general_manager' then 4 when 'developer' then 5 end;
  if v_name is null or length(v_name) not between 1 and 160 or v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' or v_rank is null then raise exception 'Invalid user details'; end if;
  if v_rank>v_actor.rank then raise exception 'Cannot assign a rank above your own'; end if;
 end if;
 if p_action='create' then
  if v_role='general_manager' then raise exception 'The General Manager is the business account and cannot be added here'; end if;
  v_user=(p_data->>'userId')::uuid;
  if not exists(select 1 from auth.users where id=v_user and created_at>now()-interval '10 minutes')
   or exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'Account is not eligible for creation'; end if;
  insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
  values(p_shop,v_user,v_role,v_name,v_username,v_rank,v_rank,auth.uid(),auth.uid());
 else
  select * into v_row from public.shop_members where shop_id=p_shop and id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'User not found'; end if;
  if v_row.version is distinct from (p_data->>'version')::integer then raise exception 'User changed on another device. Refresh and try again' using errcode='PT409'; end if;
  if not (v_actor.rank=5 or v_actor.user_id=v_row.user_id or v_actor.rank>v_row.rank) then raise exception 'You cannot modify this user rank'; end if;
  if v_row.rank=5 and v_actor.rank<>5 then raise exception 'Only a Developer can modify a Developer'; end if;
  -- The General Manager rank belongs to the business account only.
  if p_action='edit' and (v_role='general_manager') <> (v_row.role='general_manager') then
   raise exception 'The General Manager rank belongs to the business account; it cannot be given or removed here';
  end if;
  if v_row.role='general_manager' and p_action in ('archive','revoke') and v_actor.rank<>5 then
   raise exception 'Only a Developer can turn off the General Manager';
  end if;
  if p_action='edit' and v_row.archived then raise exception 'Restore this user before editing'; end if;
  if p_action='grant' and v_row.archived then raise exception 'Restore this user before granting access'; end if;
  v_rank=case when p_action='edit' then v_rank else v_row.rank end;
  v_access=case when p_action='revoke' then 0 when p_action='grant' then v_row.rank when p_action='edit' and v_row.access_level>0 then v_rank else v_row.access_level end;
  if not v_row.archived and v_row.access_level>0 and v_row.rank>=3 and (p_action in ('archive','revoke') or v_rank<3)
   and not exists(select 1 from public.shop_members where shop_id=p_shop and user_id<>v_row.user_id and not archived and access_level>=3)
   then raise exception 'Keep at least one active Manager or Developer'; end if;
  update public.shop_members set name=case when p_action='edit' then v_name else name end,
   username=case when p_action='edit' then v_username else username end,role=case when p_action='edit' then v_role else role end,
   rank=v_rank,access_level=v_access,archived=case when p_action='archive' then true when p_action='restore' then false else archived end,
   modified_at=now(),modified_by=auth.uid(),version=version+1 where shop_id=p_shop and id=v_row.id;
 end if;
end; $function$;

-- 4. Direct table access stays Developer only.
alter policy business_settings_insert on public.business_settings with check ((modified_by = (select auth.uid())) and exists (select 1 from public.shop_members m
  where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5));
alter policy business_settings_update on public.business_settings using (exists (select 1 from public.shop_members m
  where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5))
  with check ((modified_by = (select auth.uid())) and exists (select 1 from public.shop_members m
  where m.shop_id = business_settings.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5));
alter policy business_history_read on public.business_settings_history using (exists (select 1 from public.shop_members m
  where m.shop_id = business_settings_history.shop_id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5));
alter policy manager_business_name on public.shops using (exists (select 1 from public.shop_members m
  where m.shop_id = shops.id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5))
  with check (exists (select 1 from public.shop_members m
  where m.shop_id = shops.id and m.user_id = (select auth.uid()) and not m.archived and m.access_level = 5));
