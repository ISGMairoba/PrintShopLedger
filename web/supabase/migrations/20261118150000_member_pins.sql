-- PIN lock: each person's PIN hash (made on their device: PBKDF2-SHA256 with a random salt; the PIN
-- itself never leaves the device). Kept in the private schema, so no table read can reach it: a
-- person reads and sets only their own, through the functions below. Every device they sign in on
-- downloads it, so the PIN works everywhere and unlocking needs no server.
create table if not exists private.member_pins (
  shop_id uuid not null,
  user_id uuid not null,
  pin_hash text not null check (pin_hash ~ '^v1\$[0-9]{5,7}\$[A-Za-z0-9+/=]{16,64}\$[A-Za-z0-9+/=]{40,64}$'),
  set_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
revoke all on private.member_pins from public, anon, authenticated;

create or replace function public.my_pin(p_shop uuid) returns text
language sql stable security definer set search_path to '' as $f$
  select p.pin_hash from private.member_pins p
  join public.shop_members m on m.shop_id = p.shop_id and m.user_id = p.user_id and not m.archived and m.access_level > 0
  where p.shop_id = p_shop and p.user_id = auth.uid()
$f$;
revoke all on function public.my_pin(uuid) from public, anon;
grant execute on function public.my_pin(uuid) to authenticated;

-- Set (or, with null, remove) the signed-in person's own PIN.
create or replace function public.set_my_pin(p_shop uuid, p_hash text) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level > 0) then
    raise exception 'Business access denied' using errcode = '42501';
  end if;
  if p_hash is null then
    delete from private.member_pins where shop_id = p_shop and user_id = auth.uid();
    return;
  end if;
  if p_hash !~ '^v1\$[0-9]{5,7}\$[A-Za-z0-9+/=]{16,64}\$[A-Za-z0-9+/=]{40,64}$' then
    raise exception 'Invalid PIN';
  end if;
  insert into private.member_pins (shop_id, user_id, pin_hash) values (p_shop, auth.uid(), p_hash)
  on conflict (shop_id, user_id) do update set pin_hash = excluded.pin_hash, set_at = now();
end $f$;
revoke all on function public.set_my_pin(uuid, text) from public, anon;
grant execute on function public.set_my_pin(uuid, text) to authenticated;
