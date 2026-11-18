-- Customers by branch (plans/branches-next.md, step 3):
-- * customers.branch_id: the branch a customer was added at (null = main), tagged like other records.
-- * customers.credit_limits: each branch's own credit limit ({ branchId: kobo }); a branch without
--   one uses the customer's credit_limit. Set by editing the customer at that branch
--   (data.branchCreditLimit on customer.created / customer.updated).
-- * A branch with its own customers (settings.branches[i].customers = 'own') receives only the
--   customers added there or with records there; the others stay shared.
alter table public.customers add column if not exists branch_id text;
alter table public.customers add column if not exists credit_limits jsonb not null default '{}'::jsonb;
alter table public.customers drop constraint if exists customers_credit_limits_check;
alter table public.customers add constraint customers_credit_limits_check check (jsonb_typeof(credit_limits) = 'object');
drop trigger if exists tag_branch on public.customers;
create trigger tag_branch before insert on public.customers for each row execute function private.tag_branch();

create or replace function private.branch_credit_limit() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare v jsonb := new.payload->'data'->'branchCreditLimit';
begin
  if new.payload->>'kind' not in ('customer.created', 'customer.updated') or v is null or new.branch_id is null then
    return null;
  end if;
  if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
     or (v::text)::numeric < 0 or (v::text)::numeric > 100000000000 then
    raise exception 'Credit limit must be zero or greater, with at most two decimal places.';
  end if;
  update public.customers set credit_limits = credit_limits || jsonb_build_object(new.branch_id, v)
   where shop_id = new.shop_id and id = (new.payload->'data'->>'id')::uuid;
  return null;
end $f$;
drop trigger if exists branch_credit_limit on public.ledger_events;
create trigger branch_credit_limit after insert on public.ledger_events
  for each row execute function private.branch_credit_limit();

-- The business copy: each customer's branch and branch limits; a branch with its own customers
-- gets only its customers.
do $m$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_ledger_before_branch_customers') then
    alter function public.get_ledger(uuid) rename to get_ledger_before_branch_customers;
  end if;
end $m$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $function$
declare result jsonb := public.get_ledger_before_branch_customers(p_shop); v record; own boolean := false;
begin
  if not (result ? 'customers') then return result; end if;
  select * into v from private.branch_view(p_shop);
  if v.has_branches and v.keep_branch is not null and v.keep_branch <> 'main' then
    select exists (select 1 from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
                   where b.shop_id = p_shop and x->>'id' = v.keep_branch and x->>'customers' = 'own') into own;
  end if;
  result := jsonb_set(result, '{customers}', (
    select coalesce(jsonb_agg(x.v || jsonb_build_object('branchId', coalesce(c.branch_id, 'main'),
             'creditLimits', coalesce(c.credit_limits, '{}'::jsonb)) order by x.n), '[]'::jsonb)
    from jsonb_array_elements(result->'customers') with ordinality x(v, n)
    left join public.customers c on c.shop_id = p_shop and c.id = (x.v->>'id')::uuid
    where not own or coalesce(c.branch_id, 'main') = v.keep_branch
       or exists (select 1 from public.jobs j where j.shop_id = p_shop and j.customer_id = c.id and j.branch_id = v.keep_branch)
       or exists (select 1 from public.checkout_records k where k.shop_id = p_shop and k.customer_id = c.id and k.branch_id = v.keep_branch)));
  return result;
end $function$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
revoke all on function public.get_ledger_before_branch_customers(uuid) from public, anon;
grant execute on function public.get_ledger_before_branch_customers(uuid) to authenticated;
