-- Branches, phase 3: branch prices (plan: project doc plans/branches.md).
-- * Business settings → Branches: settings.branchPricing = 'shared' (one price list, the default) or
--   'perBranch' (each branch may set its own price for any item).
-- * A branch price replaces the item's unit price in that branch; an item with pack prices or
--   quantity ranges is sold singly at the branch price there. No branch price = the business price.
-- * Devices receive items with their branch's prices already in place (the business values are kept
--   under "base" for editing), and the server prices checkouts and templates the same way.

create table if not exists public.branch_prices (
  shop_id uuid not null references public.shops(id) on delete cascade,
  branch_id text not null check (branch_id ~ '^b-[a-z0-9]{6,20}$'),
  service_id uuid not null,
  price bigint not null check (price between 0 and 100000000000),
  modified_by uuid references auth.users(id),
  modified_at timestamptz not null default now(),
  primary key (shop_id, branch_id, service_id)
);
alter table public.branch_prices enable row level security;
revoke all on public.branch_prices from public, anon, authenticated;

create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path to '' as $f$
 select coalesce(array_agg(k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
 ('Payment methods','options'),('Dropdowns & workflow','options'),
 ('Jobs & payments','jobs'),('Jobs & payments','terms'),('Jobs & payments','discounts'),('Jobs & payments','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security'),
 ('Branches','branches'),('Branches','branchAccess'),('Branches','branchPricing')
 ) as t(tab,k) where p_tabs ? tab
$f$;

-- The branch whose prices apply to this request (null = business prices). Checked once per request.
create or replace function private.price_branch(p_shop uuid) returns text
language plpgsql security definer set search_path to '' as $f$
declare br text := private.request_branch(p_shop); cached text := current_setting('psl.price_branch', true); per boolean;
begin
  if br is null then return null; end if;
  if cached = p_shop::text || ':' || br then return br; end if;
  if cached = p_shop::text || ':!' || br then return null; end if;
  select coalesce(b.settings->>'branchPricing', 'shared') = 'perBranch' into per from public.business_settings b where b.shop_id = p_shop;
  perform set_config('psl.price_branch', p_shop::text || ':' || case when per then '' else '!' end || br, true);
  return case when per then br end;
end $f$;

-- An item as priced in this request's branch.
create or replace function private.branch_service(p_shop uuid, s public.services) returns public.services
language plpgsql security definer set search_path to '' as $f$
declare br text; p bigint;
begin
  if s.id is null then return s; end if;
  br := private.price_branch(p_shop);
  if br is null then return s; end if;
  select bp.price into p from public.branch_prices bp where bp.shop_id = p_shop and bp.branch_id = br and bp.service_id = s.id;
  if p is null then return s; end if;
  s.price := p;
  s.pack_prices := '[]'::jsonb;
  s.price_tiers := '[]'::jsonb;
  return s;
end $f$;

-- Every place the server prices an item reads it through branch_service.
do $mig$
declare src text; fn text; stmt text; n integer;
begin
  foreach fn in array array['public.apply_checkout_event(uuid,jsonb)', 'private.apply_supervised_event_v2(uuid,jsonb)',
                            'private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'] loop
    src := pg_get_functiondef(fn::regprocedure);
    n := 0;
    for stmt in select distinct m[1] from regexp_matches(src, '(select \* into (svc|s) from public\.services where [^;]*)', 'g') m loop
      src := replace(src, stmt || ';', stmt || ';' || case when stmt like 'select * into svc%' then 'svc' else 's' end
        || ':=private.branch_service(p_shop,' || case when stmt like 'select * into svc%' then 'svc' else 's' end || ');');
      n := n + 1;
    end loop;
    if n = 0 then raise exception '% changed; review the branch prices migration', fn; end if;
    execute src;
  end loop;
end $mig$;

-- Devices receive their branch's prices in place; the business values stay under "base".
create or replace function private.branch_price_services(p_shop uuid, p_services jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare br text := private.price_branch(p_shop); out jsonb;
begin
  if br is null or p_services is null or jsonb_typeof(p_services) <> 'array' then return p_services; end if;
  select coalesce(jsonb_agg(case when bp.price is null then e.v else e.v || jsonb_build_object(
      'price', bp.price, 'packPrices', '[]'::jsonb, 'priceTiers', '[]'::jsonb, 'branchPriced', true,
      'base', jsonb_build_object('price', e.v->'price', 'packPrices', coalesce(e.v->'packPrices', '[]'::jsonb), 'priceTiers', coalesce(e.v->'priceTiers', '[]'::jsonb)))
    end order by e.o), '[]'::jsonb) into out
  from jsonb_array_elements(p_services) with ordinality e(v, o)
  left join public.branch_prices bp on bp.shop_id = p_shop and bp.branch_id = br and bp.service_id::text = e.v->>'id';
  return out;
end $f$;

create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare
  result jsonb := public.get_ledger_before_branches(p_shop);
  v record;
  part record;
begin
  select * into v from private.branch_view(p_shop);
  if not v.has_branches then return result; end if;
  for part in select * from (values ('jobs','jobs'), ('payments','payments'), ('checkouts','checkout_records'),
      ('expenses','expenses'), ('drawerClosings','drawer_closings'), ('saleAdjustments','sale_adjustments'),
      ('quotations','quotations'), ('reminders','customer_reminders'), ('materialWaste','material_waste')) x(k, t) loop
    if result ? part.k then
      result := jsonb_set(result, array[part.k], private.branch_records(p_shop, result->part.k, part.t, v.keep_branch));
    end if;
  end loop;
  if v.keep_branch is not null then result := private.branch_accounts(p_shop, result, v.keep_branch); end if;
  if result ? 'services' then result := jsonb_set(result, '{services}', private.branch_price_services(p_shop, result->'services')); end if;
  return result;
end $f$;

-- Set or clear (p_price null) an item's price in this device's branch.
create or replace function public.set_branch_price(p_shop uuid, p_service uuid, p_price bigint) returns void
language plpgsql security definer set search_path to '' as $f$
declare br text := private.price_branch(p_shop); lvl integer;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  select access_level into lvl from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  if coalesce(lvl, 0) < 2 then raise exception 'Only Admin or higher can set branch prices'; end if;
  if br is null then raise exception 'Branch prices are off, or this device is in the main branch (which uses the business prices).'; end if;
  if not exists (select 1 from public.services where shop_id = p_shop and id = p_service) then raise exception 'Item not found'; end if;
  if p_price is null then
    delete from public.branch_prices where shop_id = p_shop and branch_id = br and service_id = p_service;
  else
    if p_price < 0 or p_price > 100000000000 then raise exception 'Enter a valid price'; end if;
    insert into public.branch_prices (shop_id, branch_id, service_id, price, modified_by)
    values (p_shop, br, p_service, p_price, auth.uid())
    on conflict (shop_id, branch_id, service_id) do update set price = excluded.price, modified_by = auth.uid(), modified_at = now();
  end if;
  -- Devices pick up the change with their next sync.
  update public.services set version = version where shop_id = p_shop and id = p_service;
end $f$;

revoke all on function private.price_branch(uuid), private.branch_service(uuid,public.services), private.branch_price_services(uuid,jsonb),
  public.set_branch_price(uuid,uuid,bigint) from public, anon;
grant execute on function private.price_branch(uuid), private.branch_service(uuid,public.services), private.branch_price_services(uuid,jsonb),
  public.set_branch_price(uuid,uuid,bigint) to authenticated;
