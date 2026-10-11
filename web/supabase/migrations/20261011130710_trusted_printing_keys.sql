-- Trusted printing: one QZ Tray signing key per business.
-- The private key is readable only by the print-signing edge function (service role).
-- Staff download the public certificate and install it in QZ Tray on each printing computer.

create table if not exists private.print_signing_keys (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  certificate text not null check (certificate like '-----BEGIN CERTIFICATE-----%'),
  private_key text not null check (private_key like '-----BEGIN PRIVATE KEY-----%'),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
revoke all on private.print_signing_keys from public, anon, authenticated;
grant select, insert on private.print_signing_keys to service_role;

-- The business name (for a new certificate) and its key, if one exists.
create or replace function public.print_signing_key(p_shop uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('name', s.name, 'certificate', k.certificate, 'private_key', k.private_key)
  from public.shops s left join private.print_signing_keys k on k.shop_id = s.id
  where s.id = p_shop
$$;

-- Saves a new key unless another request saved one first; returns the key now in use.
create or replace function public.save_print_signing_key(p_shop uuid, p_certificate text, p_private_key text, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into private.print_signing_keys (shop_id, certificate, private_key, created_by)
  values (p_shop, p_certificate, p_private_key, p_user)
  on conflict (shop_id) do nothing;
  return (select jsonb_build_object('certificate', certificate, 'private_key', private_key)
          from private.print_signing_keys where shop_id = p_shop);
end
$$;

revoke all on function public.print_signing_key(uuid), public.save_print_signing_key(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.print_signing_key(uuid), public.save_print_signing_key(uuid, text, text, uuid)
  to service_role;
