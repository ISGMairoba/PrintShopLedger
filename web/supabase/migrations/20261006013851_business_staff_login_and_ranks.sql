begin;
alter table public.shop_members drop constraint shop_user_rank;
alter table public.shop_members drop constraint shop_members_role_check;
alter table public.shop_members add constraint shop_members_role_check check(role in ('cashier','admin','manager','developer'));
create table public.business_accounts(
 shop_id uuid primary key references public.shops(id),
 user_id uuid not null references auth.users(id)
);
create index business_accounts_user on public.business_accounts(user_id);
insert into public.business_accounts(shop_id,user_id)
 select distinct on(shop_id) shop_id,user_id from public.shop_members where created_by=user_id order by shop_id,created_at,id;
update public.shop_members m set role='manager' from public.business_accounts b where b.shop_id=m.shop_id and b.user_id=m.user_id;
alter table public.shop_members alter column rank drop default;
alter table public.shop_members alter column rank type integer using (case role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end);
alter table public.shop_members add column access_level integer;
update public.shop_members set access_level=rank;
alter table public.shop_members alter column access_level set not null;
alter table public.shop_members add constraint staff_rank check(rank between 1 and 4 and rank=case role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 else 4 end),
 add constraint staff_access check(access_level in (0,rank));
update public.shop_members m set username='manager' from public.business_accounts b
 where b.shop_id=m.shop_id and b.user_id=m.user_id and m.username like 'user-%'
 and not exists(select 1 from public.shop_members p where p.shop_id=m.shop_id and p.username='manager');
alter table public.business_accounts enable row level security;
revoke all on public.business_accounts from anon,authenticated;
grant select on public.business_accounts to authenticated;
create policy own_business_account on public.business_accounts for select to authenticated using(user_id=(select auth.uid()));
create or replace function public.is_shop_member(p_shop uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>0);
$$;
create or replace function private.can_manage_users(p_shop uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2);
$$;
create or replace function public.list_my_shops() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role,'rank',m.rank,'accessLevel',m.access_level,'userId',m.user_id,'username',m.username,'staffName',m.name) order by s.created_at),'[]'::jsonb)
 from public.shops s join public.shop_members m on m.shop_id=s.id where m.user_id=auth.uid() and not m.archived and m.access_level>0;
$$;
create function public.list_business_shops() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to the business first'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) order by s.created_at),'[]'::jsonb)
 from public.shops s join public.business_accounts b on b.shop_id=s.id where b.user_id=auth.uid());
end; $$;
revoke all on function public.list_business_shops() from public,anon;
grant execute on function public.list_business_shops() to authenticated;
create or replace function public.create_shop(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_shop uuid; v_name text;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 -- Staff authentication accounts cannot register themselves as businesses.
 if exists(select 1 from public.shop_members m where m.user_id=auth.uid()) and not exists(select 1 from public.business_accounts b where b.user_id=auth.uid()) then raise exception 'Use the business email account'; end if;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),split_part(email,'@',1),'Manager') into v_name from auth.users where id=auth.uid();
 insert into public.shops(name) values(btrim(p_name)) returning id into v_shop;
 insert into public.business_accounts(shop_id,user_id) values(v_shop,auth.uid());
 insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
 values(v_shop,auth.uid(),'manager',v_name,'manager',3,3,auth.uid(),auth.uid());
 return v_shop;
end; $$;
create or replace function public.list_shop_users(p_shop uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_manage_users(p_shop) then raise exception 'Users page requires Admin, Manager or Developer access'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'id',m.id,'userId',m.user_id,'name',m.name,'username',m.username,'rank',m.rank,'role',m.role,'accessLevel',m.access_level,
 'archived',m.archived,'version',m.version,'lastLogin',u.last_sign_in_at,
 'createdAt',m.created_at,'createdBy',m.created_by,'createdByLabel',coalesce(c.name,'Manager'),
 'modifiedAt',m.modified_at,'modifiedBy',m.modified_by,'modifiedByLabel',coalesce(e.name,'Manager')) order by m.name),'[]'::jsonb)
 from public.shop_members m join auth.users u on u.id=m.user_id
 left join public.shop_members c on c.shop_id=m.shop_id and c.user_id=m.created_by
 left join public.shop_members e on e.shop_id=m.shop_id and e.user_id=m.modified_by where m.shop_id=p_shop);
end; $$;
create or replace function public.save_shop_user_internal(p_shop uuid,p_action text,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_row public.shop_members%rowtype; v_actor public.shop_members%rowtype; v_user uuid; v_name text; v_username text; v_role text; v_rank integer; v_access integer;
begin
 perform 1 from public.shops where id=p_shop for update;
 select * into v_actor from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2;
 if not found then raise exception 'User management access denied'; end if;
 if p_action is null or p_action not in ('create','edit','archive','restore','grant','revoke') then raise exception 'Unknown user action'; end if;
 if p_action in ('create','edit') then
  v_name=btrim(p_data->>'name');v_username=lower(btrim(p_data->>'username'));v_role=p_data->>'role';
  v_rank=case v_role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3 when 'developer' then 4 end;
  if v_name is null or length(v_name) not between 1 and 160 or v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' or v_rank is null then raise exception 'Invalid user details'; end if;
  if v_rank>v_actor.rank then raise exception 'Cannot assign a rank above your own'; end if;
 end if;
 if p_action='create' then
  v_user=(p_data->>'userId')::uuid;
  if not exists(select 1 from auth.users where id=v_user and created_at>now()-interval '10 minutes')
   or exists(select 1 from public.shop_members where user_id=v_user) then raise exception 'Account is not eligible for creation'; end if;
  insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
  values(p_shop,v_user,v_role,v_name,v_username,v_rank,v_rank,auth.uid(),auth.uid());
 else
  select * into v_row from public.shop_members where shop_id=p_shop and id=(p_data->>'id')::uuid for update;
  if not found then raise exception 'User not found'; end if;
  if v_row.version is distinct from (p_data->>'version')::integer then raise exception 'User changed on another device. Refresh and try again' using errcode='40001'; end if;
  if not (v_actor.rank=4 or v_actor.user_id=v_row.user_id or v_actor.rank>v_row.rank) then raise exception 'You cannot modify this user rank'; end if;
  if v_row.rank=4 and v_actor.rank<>4 then raise exception 'Only a Developer can modify a Developer'; end if;
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
end; $$;
-- Recheck live access after acquiring the same business lock used by staff administration.
do $$
declare f record; body text; guard text;
begin
 for f in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('apply_material_event','apply_service_event','apply_customer_event','apply_ledger_event') loop
  body=pg_get_functiondef(f.oid);
  body=replace(body,'not archived and role in (''admin'',''manager'')','not archived and access_level>0 and role in (''admin'',''manager'',''developer'')');
  guard=case when f.proname in ('apply_material_event','apply_service_event')
   then 'if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2) then raise exception ''Business access denied''; end if;'
   else 'if not public.is_shop_member(p_shop) then raise exception ''Business access denied''; end if;' end;
  body=regexp_replace(body,'(perform 1 from public.shops where id\s*=\s*p_shop for update;)', E'\\1\n' || guard);
  execute body;
 end loop;
end $$;
commit;
