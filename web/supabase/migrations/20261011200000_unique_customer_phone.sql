-- Each phone number belongs to one customer per business.
-- Numbers compare in local Nigerian form (+234 803…, 234803…, 0803…, 803… are the same).
-- Customers that already shared a number keep it; they cannot gain a new duplicate.

create or replace function private.phone_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^234[0-9]{10}$' then '0' || substr(d, 4)
    when d ~ '^[1-9][0-9]{9}$' then '0' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create index if not exists customers_phone_key on public.customers (shop_id, private.phone_key(phone));

create or replace function private.customer_phone_unique()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  k text := private.phone_key(new.phone);
  other text;
begin
  if k = '' then return new; end if;
  if tg_op = 'UPDATE' and k = private.phone_key(old.phone) then return new; end if;
  -- Serialise checks for the same number so two devices cannot both claim it.
  perform pg_advisory_xact_lock(hashtextextended(new.shop_id::text || ':' || k, 0));
  select c.name into other from public.customers c
   where c.shop_id = new.shop_id and c.id <> new.id and private.phone_key(c.phone) = k
   limit 1;
  if found then
    raise exception 'This phone number already belongs to %. Use that customer or enter a different number.', other
      using errcode = 'PT409';
  end if;
  return new;
end
$$;
revoke all on function private.customer_phone_unique() from public, anon, authenticated;

drop trigger if exists customers_phone_unique on public.customers;
create trigger customers_phone_unique before insert or update of phone on public.customers
  for each row execute function private.customer_phone_unique();
