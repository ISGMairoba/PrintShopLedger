-- New businesses: the Developer account is active straight away (the password is set by the
-- register-business function from the DEVELOPER_DEFAULT_PASSWORD secret). Service role only.
create or replace function public.activate_registered_developer(p_shop uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r private.business_registrations%rowtype;
begin
  select * into r from private.business_registrations where shop_id = p_shop for update;
  if not found then raise exception 'Business registration not found.'; end if;
  update public.shop_members set access_level = 4, archived = false, modified_at = now(), version = version + 1
   where shop_id = r.shop_id and user_id = r.developer_id and rank = 4;
  if not found then raise exception 'Developer access is unavailable.'; end if;
  update private.business_registrations
     set activated_at = coalesce(activated_at, now()), activation_claim = null, activation_claimed_at = null
   where owner_id = r.owner_id;
end
$$;
revoke all on function public.activate_registered_developer(uuid) from public, anon, authenticated;
grant execute on function public.activate_registered_developer(uuid) to service_role;
