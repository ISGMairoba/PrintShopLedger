-- Helpers for the database tests only (never applied to a real database). Loaded after the
-- migrations by scripts/sql-tests.mjs.
create schema if not exists test;
grant usage on schema test to authenticated, anon;

-- A business made the way the app makes one (Register your business): the owner becomes its
-- General Manager (rank 4) and it gets its default money accounts. The owner is the signed-in user
-- unless given; their sign-in is made (and confirmed) when missing.
create or replace function test.new_shop(p_name text, p_owner uuid default auth.uid()) returns uuid
language plpgsql security definer set search_path = '' as $f$
declare developer uuid := gen_random_uuid(); shop uuid;
begin
  if p_owner is null then raise exception 'test.new_shop: sign someone in first (request.jwt.claim.sub)'; end if;
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
  values (p_owner, p_owner::text || '@example.invalid', now(), '{}')
  on conflict (id) do update set email_confirmed_at = coalesce(auth.users.email_confirmed_at, now());
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
  values (developer, 'staff-developer-' || developer::text || '@staff.printshopledger.invalid', now(), '{}');
  shop := (public.complete_business_registration(
    p_owner, developer, p_name, 'Owner', encode(extensions.digest(developer::text, 'sha256'), 'hex'),
    'https://print-shop-ledger.vercel.app/#developer_activation=' || developer::text
  ) ->> 'shopId')::uuid;
  perform test.open_early(shop);
  return shop;
end $f$;
grant execute on function test.new_shop(text, uuid) to authenticated;

-- Adds someone to a business at a rank by role name (cashier, admin, manager, general_manager), with
-- the rank and access level the role carries. Their sign-in is made when missing.
create or replace function test.add_member(p_shop uuid, p_user uuid, p_role text, p_username text default null)
returns void language plpgsql security definer set search_path = '' as $f$
declare r integer := case p_role when 'cashier' then 1 when 'admin' then 2 when 'manager' then 3
  when 'general_manager' then 4 else 5 end;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
  values (p_user, p_user::text || '@staff.example.invalid', now(), '{}') on conflict (id) do nothing;
  insert into public.shop_members(shop_id, user_id, role, name, username, rank, access_level, created_by, modified_by)
  values (p_shop, p_user, p_role, initcap(p_role), coalesce(p_username, p_role || '-' || left(p_user::text, 8)),
    r, least(r, 4), p_user, p_user);
end $f$;

-- The money account a payment method pays into (by the method's kind: Cash, POS, Transfer, Other).
create or replace function test.account_for(p_shop uuid, p_kind text default 'Cash') returns uuid
language sql security definer set search_path = '' as $f$
  select a.id from public.business_operations_records a
   where a.shop_id = p_shop and a.collection = 'moneyAccounts'
     and not coalesce((a.data ->> 'archived')::boolean, false)
     and exists (select 1 from jsonb_array_elements(coalesce(a.data -> 'paymentMethods', '[]')) m
                 where m ->> 'kind' = p_kind and coalesce((m ->> 'enabled')::boolean, true))
   order by a.id limit 1
$f$;
grant execute on function test.account_for(uuid, text) to authenticated;

-- The money account with a payment method of this label (the label a sale names), if any.
create or replace function test.account_with_label(p_shop uuid, p_label text) returns uuid
language sql security definer set search_path = '' as $f$
  select a.id from public.business_operations_records a
   where a.shop_id = p_shop and a.collection = 'moneyAccounts' and p_label is not null
     and not coalesce((a.data ->> 'archived')::boolean, false)
     and exists (select 1 from jsonb_array_elements(coalesce(a.data -> 'paymentMethods', '[]')) m
                 where m ->> 'label' = p_label and coalesce((m ->> 'enabled')::boolean, true))
   order by a.id limit 1
$f$;
grant execute on function test.account_with_label(uuid, text) to authenticated;

-- Money accounts open on the day they are made; the fixtures date their sales earlier.
-- The default Bank account's methods are labelled "Bank — POS" and "Bank — Transfer"; the fixtures
-- predate that and name them POS and Transfer, so their labels become the method names here.
create or replace function test.open_early(p_shop uuid) returns void
language sql security definer set search_path = '' as $f$
  update public.business_operations_records r
     set data = jsonb_set(jsonb_set(r.data, '{openingDate}', '"2000-01-01"'), '{paymentMethods}',
       (select jsonb_agg(m || jsonb_build_object('label', m ->> 'name')) from jsonb_array_elements(r.data -> 'paymentMethods') m))
       || jsonb_build_object('methods', (select jsonb_agg(m ->> 'name') from jsonb_array_elements(r.data -> 'paymentMethods') m))
   where r.shop_id = p_shop and r.collection = 'moneyAccounts' and r.data ->> 'createdByLabel' = 'Default accounts'
     and r.data ->> 'openingDate' > '2000-01-01'
$f$;
grant execute on function test.open_early(uuid) to authenticated;

-- A checkout as the app sends it: when the fixture leaves out the money account, the account that
-- takes its payment method is added (the app always sends one).
create or replace function test.checkout(p_shop uuid, p_event jsonb) returns void
language plpgsql set search_path = '' as $f$
declare d jsonb := p_event -> 'data';
begin
  perform test.open_early(p_shop);
  if d ? 'accountId' or coalesce(d ->> 'method', '') = '' then
    perform public.apply_checkout_event(p_shop, p_event);
  else
    perform public.apply_checkout_event(p_shop, jsonb_set(p_event, '{data,accountId}', coalesce(
      to_jsonb(test.account_with_label(p_shop, d ->> 'methodLabel')),
      to_jsonb(test.account_for(p_shop, d ->> 'method')), 'null')));
  end if;
end $f$;
grant execute on function test.checkout(uuid, jsonb) to authenticated;
grant usage on schema test to authenticated;

-- Removes the Cash and Bank accounts every new business starts with, for fixtures that set up their
-- own accounts and count them.
create or replace function test.without_default_accounts(p_shop uuid) returns void
language sql security definer set search_path = '' as $f$
  delete from public.business_operations_records
   where shop_id = p_shop and (
     (collection = 'moneyAccounts' and data ->> 'createdByLabel' = 'Default accounts')
     or (collection = 'operationHistory' and data ->> 'modifiedByLabel' = 'Default accounts'))
$f$;

-- Makes someone the business's Developer (business settings are created by the Developer).
create or replace function test.make_developer(p_shop uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $f$
  update public.shop_members set role = 'developer', rank = 5, access_level = 5
   where shop_id = p_shop and user_id = p_user
$f$;
grant execute on function test.make_developer(uuid, uuid) to authenticated;

-- NEW-02: the one-pass download must equal the old layered one, byte for byte, for every member of
-- every business and every branch they could ask for. sql-tests.mjs runs this at the end of each
-- fixture, before its rollback, so it sees that fixture's data.
create or replace function test.ledger_same() returns int language plpgsql as $$
declare s record; m record; b text; a jsonb; o jsonb; k text; n int := 0;
begin
  if to_regprocedure('private.get_ledger_layered(uuid)') is null then return 0; end if;
  for s in select id from public.shops loop
    for m in select user_id from public.shop_members where shop_id = s.id loop
      for b in select null union all
               select distinct x->>'id' from public.business_settings bs, jsonb_array_elements(coalesce(bs.settings->'branches', '[]'::jsonb)) x
               where bs.shop_id = s.id loop
        perform set_config('request.jwt.claims', jsonb_build_object('sub', m.user_id, 'role', 'authenticated')::text, true);
        perform set_config('request.jwt.claim.sub', m.user_id::text, true);
        perform set_config('request.headers', case when b is null then '{}' else jsonb_build_object('x-psl-branch', b)::text end, true);
        perform set_config('psl.branch', '', true);
        perform set_config('psl.price_branch', '', true);
        begin a := public.get_ledger(s.id); exception when others then a := to_jsonb('refused: ' || sqlerrm); end;
        -- Fields added after NEW-02 are not in the old download: left out of the comparison.
        if jsonb_typeof(a) = 'object' then
          a := jsonb_set(a, '{materials}', (select coalesce(jsonb_agg(x - 'costPrice' order by i), '[]'::jsonb)
            from jsonb_array_elements(a->'materials') with ordinality m(x, i)));
          a := jsonb_set(a, '{materialHistory}', (select coalesce(jsonb_agg(x - 'unitCost' - 'costActual' order by i), '[]'::jsonb)
            from jsonb_array_elements(a->'materialHistory') with ordinality m(x, i))) - 'stockValues' - 'lateCosts' - 'teamPeople' - 'jobAssignments' - 'workRecords' - 'workCorrections' - 'teamTerms' - 'teamPayouts' - 'stockCounts' - 'materialShelves' - 'partnerItems';
        end if;
        begin o := private.get_ledger_layered(s.id); exception when others then o := to_jsonb('refused: ' || sqlerrm); end;
        if a::text is distinct from o::text then
          if jsonb_typeof(a) = 'object' and jsonb_typeof(o) = 'object' then
            select string_agg(key, ', ') into k from (select key from jsonb_each(a) union select key from jsonb_each(o)) x
              where a->key is distinct from o->key;
          else k := a::text || ' vs ' || o::text; end if;
          raise exception 'One-pass download differs from the layered one (shop %, user %, branch %): %', s.id, m.user_id, b, k;
        end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
