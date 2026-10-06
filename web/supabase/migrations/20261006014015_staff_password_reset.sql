begin;
create function public.authorize_staff_password_reset(p_shop uuid,p_id uuid,p_version integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.shop_members%rowtype; t public.shop_members%rowtype;
begin
 select * into a from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2;
 if not found then raise exception 'User management access denied'; end if;
 select * into t from public.shop_members where shop_id=p_shop and id=p_id;
 if not found or t.archived then raise exception 'Active user not found'; end if;
 if t.version<>p_version then raise exception 'User changed. Refresh before resetting their password'; end if;
 if not (a.rank=4 or a.user_id=t.user_id or a.rank>t.rank) then raise exception 'Cannot reset this user password'; end if;
 return t.user_id;
end; $$;
create function public.audit_staff_password_reset(p_shop uuid,p_user uuid,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.shop_members set modified_at=now(),modified_by=p_actor,version=version+1 where shop_id=p_shop and user_id=p_user;
end; $$;
revoke all on function public.authorize_staff_password_reset(uuid,uuid,integer),public.audit_staff_password_reset(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_staff_password_reset(uuid,uuid,integer) to authenticated;
grant execute on function public.audit_staff_password_reset(uuid,uuid,uuid) to service_role;
commit;
