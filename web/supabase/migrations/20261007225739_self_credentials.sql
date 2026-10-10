-- Only the authenticated Edge Function may call this service-role operation.
create or replace function public.update_self_username(p_shop uuid,p_actor uuid,p_username text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_member public.shop_members%rowtype; v_username text:=lower(btrim(p_username));
begin
 if p_actor is null or v_username is null or v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' then raise exception 'Invalid username'; end if;
 select * into v_member from public.shop_members where shop_id=p_shop and user_id=p_actor for update;
 if not found or v_member.archived or v_member.access_level<1 then raise exception 'Business access denied'; end if;
 update public.shop_members set username=v_username,version=version+1,modified_at=now(),modified_by=p_actor where id=v_member.id;
end; $$;
revoke all on function public.update_self_username(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.update_self_username(uuid,uuid,text) to service_role;
