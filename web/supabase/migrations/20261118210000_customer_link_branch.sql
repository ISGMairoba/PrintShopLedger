-- A branch with its own customers can add a customer from another branch (plans/branches-next.md):
-- when the phone number typed already belongs to a customer the branch cannot see, the app says
-- only that the number is in use elsewhere and offers "Add them to this branch". Choosing it links
-- the same customer (customers.linked_branches); the name shows only after that choice.
alter table public.customers add column if not exists linked_branches text[] not null default '{}';

-- Is this number already a customer's? Says yes or no only (no name).
create or replace function public.customer_phone_elsewhere(p_shop uuid, p_phone text) returns boolean
language plpgsql stable security definer set search_path to '' as $f$
declare k text := private.phone_key(p_phone);
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level > 0) then
    raise exception 'Business access denied' using errcode = '42501';
  end if;
  if k is null or k = '' then return false; end if;
  return exists (select 1 from public.customers c where c.shop_id = p_shop and private.phone_key(c.phone) = k);
end $f$;
revoke all on function public.customer_phone_elsewhere(uuid, text) from public, anon;
grant execute on function public.customer_phone_elsewhere(uuid, text) to authenticated;

-- Link the customer with this number to the branch this device works at; returns its id and name.
create or replace function public.link_customer_by_phone(p_shop uuid, p_phone text) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare k text := private.phone_key(p_phone); here text; c record;
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level > 0) then
    raise exception 'Business access denied' using errcode = '42501';
  end if;
  here := private.request_branch(p_shop);
  if here is null then raise exception 'Customers are added to a branch from that branch.'; end if;
  if k is null or k = '' then raise exception 'Enter a phone number.'; end if;
  select id, name into c from public.customers where shop_id = p_shop and private.phone_key(phone) = k
   order by archived, created_at limit 1;
  if not found then raise exception 'No customer has this phone number.'; end if;
  update public.customers set linked_branches = array_append(linked_branches, here)
   where shop_id = p_shop and id = c.id and not (here = any(linked_branches));
  return jsonb_build_object('id', c.id, 'name', c.name);
end $f$;
revoke all on function public.link_customer_by_phone(uuid, text) from public, anon;
grant execute on function public.link_customer_by_phone(uuid, text) to authenticated;

-- The business copy: as before (20261118180000_branch_customers), plus each customer's linked
-- branches, and a branch with its own customers also gets the customers linked to it.
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $function$
declare result jsonb := public.get_ledger_before_branch_customers(p_shop); bv record; own boolean := false;
begin
  if not (result ? 'customers') then return result; end if;
  select * into bv from private.branch_view(p_shop);
  if bv.has_branches and bv.keep_branch is not null and bv.keep_branch <> 'main' then
    select exists (select 1 from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
                   where b.shop_id = p_shop and x->>'id' = bv.keep_branch and x->>'customers' = 'own') into own;
  end if;
  result := jsonb_set(result, '{customers}', (
    select coalesce(jsonb_agg(x.v || jsonb_build_object('branchId', coalesce(c.branch_id, 'main'),
             'creditLimits', coalesce(c.credit_limits, '{}'::jsonb),
             'linkedBranches', to_jsonb(coalesce(c.linked_branches, '{}'::text[]))) order by x.n), '[]'::jsonb)
    from jsonb_array_elements(result->'customers') with ordinality x(v, n)
    left join public.customers c on c.shop_id = p_shop and c.id = (x.v->>'id')::uuid
    where not own or coalesce(c.branch_id, 'main') = bv.keep_branch or bv.keep_branch = any(c.linked_branches)
       or exists (select 1 from public.jobs j where j.shop_id = p_shop and j.customer_id = c.id and j.branch_id = bv.keep_branch)
       or exists (select 1 from public.checkout_records k where k.shop_id = p_shop and k.customer_id = c.id and k.branch_id = bv.keep_branch)));
  return result;
end $function$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
