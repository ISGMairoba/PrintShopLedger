-- Business-scoped staff accounts. Never store credentials in this table.
begin;
alter table public.shop_members
 add column id uuid not null default gen_random_uuid(),
 add column name text not null default '',
 add column username text not null default '',
 add column rank text not null default 'Staff',
 add column archived boolean not null default false,
 add column version integer not null default 1,
 add column created_at timestamptz not null default now(),
 add column created_by uuid references auth.users(id),
 add column modified_at timestamptz not null default now(),
 add column modified_by uuid references auth.users(id);
update public.shop_members m set name=coalesce(nullif(u.raw_user_meta_data->>'full_name',''), split_part(u.email,'@',1),'User'),
 username='user-'||replace(m.id::text,'-',''),rank=case when m.role='admin' then 'Administrator' else 'Staff' end,
 created_by=m.user_id,modified_by=m.user_id from auth.users u where u.id=m.user_id;
alter table public.shop_members add constraint shop_user_name check(length(btrim(name)) between 1 and 160),
 add constraint shop_user_username check(username ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
 add constraint shop_user_rank check(length(btrim(rank)) between 1 and 80),
 add constraint shop_user_version check(version > 0),
 add constraint shop_user_id unique(id);
create unique index shop_user_username_unique on public.shop_members(shop_id,lower(username));
create schema if not exists private;
revoke all on schema private from public;
create function private.can_manage_users(p_shop uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and role='admin' and not archived);
$$;
revoke all on function private.can_manage_users(uuid) from public;
create or replace function public.is_shop_member(p_shop uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived);
$$;
create or replace function public.list_my_shops() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role) order by s.created_at),'[]'::jsonb)
 from public.shops s join public.shop_members m on m.shop_id=s.id where m.user_id=auth.uid() and not m.archived;
$$;
create or replace function public.create_shop(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_shop uuid; v_name text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),split_part(email,'@',1),'Administrator') into v_name from auth.users where id=auth.uid();
 insert into public.shops(name) values(btrim(p_name)) returning id into v_shop;
 insert into public.shop_members(shop_id,user_id,role,name,username,rank,created_by,modified_by)
 values(v_shop,auth.uid(),'admin',v_name,'user-'||replace(gen_random_uuid()::text,'-',''),'Administrator',auth.uid(),auth.uid());
 return v_shop;
end; $$;
create function public.list_shop_users(p_shop uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_users(p_shop) then raise exception 'Only an active administrator can manage users'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'id',m.id,'userId',m.user_id,'name',m.name,'username',m.username,'rank',m.rank,'role',m.role,
 'archived',m.archived,'version',m.version,'lastLogin',u.last_sign_in_at,'email',u.email,
 'createdAt',m.created_at,'createdBy',m.created_by,'createdByLabel',coalesce(c.name,'Administrator'),
 'modifiedAt',m.modified_at,'modifiedBy',m.modified_by,'modifiedByLabel',coalesce(e.name,'Administrator')) order by m.name),'[]'::jsonb)
 from public.shop_members m join auth.users u on u.id=m.user_id
 left join public.shop_members c on c.shop_id=m.shop_id and c.user_id=m.created_by
 left join public.shop_members e on e.shop_id=m.shop_id and e.user_id=m.modified_by where m.shop_id=p_shop);
end; $$;
create function public.save_shop_user(p_shop uuid,p_action text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_row public.shop_members%rowtype; v_user uuid; v_name text; v_username text; v_rank text; v_role text;
begin
 -- Serialize administration and lock the actor's membership to prevent stale authorization.
 perform 1 from public.shops where id=p_shop for update;
 if not private.can_manage_users(p_shop) then raise exception 'Only an active administrator can manage users'; end if;
 if p_action not in ('create','edit','archive','restore') or p_action is null then raise exception 'Unknown user action'; end if;
 if p_action in ('create','edit') then
  v_name=btrim(p_data->>'name');v_username=lower(btrim(p_data->>'username'));v_rank=btrim(p_data->>'rank');v_role=p_data->>'role';
  if v_name is null or length(v_name) not between 1 and 160 or v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$'
   or v_rank is null or length(v_rank) not between 1 and 80 or v_role is null or v_role not in ('admin','manager','cashier') then raise exception 'Invalid user details'; end if;
 end if;
 if p_action='create' then
  v_user=(p_data->>'userId')::uuid;
  -- Only newly provisioned, unused accounts can be attached. Existing accounts are never taken over.
  if not exists(select 1 from auth.users where id=v_user and created_at>now()-interval '10 minutes')
   or exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'Account is not eligible for creation'; end if;
  insert into public.shop_members(shop_id,user_id,role,name,username,rank,created_by,modified_by)
  values(p_shop,v_user,v_role,v_name,v_username,v_rank,auth.uid(),auth.uid());
 else
  select * into v_row from public.shop_members where shop_id=p_shop and id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'User not found'; end if;
  if v_row.version is distinct from (p_data->>'version')::integer then raise exception 'User changed on another device. Refresh and try again' using errcode='40001'; end if;
  if v_row.user_id=auth.uid() and (p_action='archive' or (p_action='edit' and v_role<>'admin')) then raise exception 'You cannot archive or demote your own administrator account'; end if;
  if not v_row.archived and v_row.role='admin' and (p_action='archive' or (p_action='edit' and v_role<>'admin')) and
   (select count(*) from public.shop_members where shop_id=p_shop and role='admin' and not archived)<=1 then raise exception 'Keep at least one active administrator'; end if;
  if p_action='edit' and v_row.archived then raise exception 'Restore this user before editing'; end if;
  update public.shop_members set name=case when p_action='edit' then v_name else name end,
   username=case when p_action='edit' then v_username else username end,rank=case when p_action='edit' then v_rank else rank end,
   role=case when p_action='edit' then v_role else role end,
   archived=case when p_action='archive' then true when p_action='restore' then false else archived end,
   modified_at=now(),modified_by=auth.uid(),version=version+1 where shop_id=p_shop and id=v_row.id;
 end if;
end; $$;
-- Restrict creation to server provisioning; edits/status changes remain authenticated RPC calls.
alter function public.save_shop_user(uuid,text,jsonb) rename to save_shop_user_internal;
create function public.save_shop_user(p_shop uuid,p_action text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_action='create' then raise exception 'Use secure account provisioning to create users'; end if;
 perform public.save_shop_user_internal(p_shop,p_action,p_data);
end; $$;
-- Server passes the authenticated actor explicitly, after validating their token.
create function public.provision_shop_user(p_shop uuid,p_actor uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform public.save_shop_user_internal(p_shop,'create',p_data);
end; $$;
revoke all on function public.save_shop_user_internal(uuid,text,jsonb),public.provision_shop_user(uuid,uuid,jsonb),public.save_shop_user(uuid,text,jsonb),public.list_shop_users(uuid) from public,anon,authenticated;
grant execute on function public.provision_shop_user(uuid,uuid,jsonb) to service_role;
grant execute on function public.save_shop_user(uuid,text,jsonb),public.list_shop_users(uuid) to authenticated;
-- Cashiers can read the catalogue but cannot modify materials or services.
do $$
declare f record; body text;
begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('apply_material_event','apply_service_event') loop
  body=pg_get_functiondef(f.oid);
  body=replace(body,'if not public.is_shop_member(p_shop) then',
   'if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and role in (''admin'',''manager'')) then');
  execute body;
 end loop;
end $$;
commit;
