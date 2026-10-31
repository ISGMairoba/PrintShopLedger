-- Branches, stage 1b (plan: project doc plans/branches.md).
-- * Records sent to devices say their branch (branchId; none = the main branch).
-- * Staff who do not work in every branch receive only the records of the branch their device works
--   in (with the shared ones: customers, services, stock, settings). The business owner ("Every
--   branch") and Developer receive every branch; their devices show one branch at a time.
-- * A customer has one account per branch: the checkout account check counts only the jobs and
--   wallet of the branch the request comes from.
-- One-branch businesses are unchanged (nothing is tagged and nothing is filtered).

-- Who sees what in this request: whether the business has branches, and the branch to keep
-- (null = every branch).
create or replace function private.branch_view(p_shop uuid, out has_branches boolean, out keep_branch text)
language plpgsql security definer set search_path to '' as $f$
declare s jsonb;
begin
  select b.settings->'branches', b.settings->'branchAccess'->(auth.uid()::text) into s, keep_branch
    from public.business_settings b where b.shop_id = p_shop;
  has_branches := coalesce(jsonb_typeof(s) = 'array' and jsonb_array_length(s) > 1, false);
  if not has_branches then keep_branch := null; return; end if;
  if (keep_branch::jsonb ? '*')
     or exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4) then
    keep_branch := null;
  else
    keep_branch := coalesce(private.request_branch(p_shop), 'main');
  end if;
end $f$;

-- One part of the records with each record's branch, kept to one branch when asked.
create or replace function private.branch_records(p_shop uuid, p_records jsonb, p_table text, p_keep text) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare out jsonb;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) = 0 then return p_records; end if;
  execute format($q$
    select coalesce(jsonb_agg(case when t.branch_id is null then e.v else e.v || jsonb_build_object('branchId', t.branch_id) end order by e.o), '[]'::jsonb)
    from jsonb_array_elements($1) with ordinality e(v, o)
    left join public.%I t on t.shop_id = $2 and t.id::text = e.v->>'id'
    where $3 is null or coalesce(t.branch_id, 'main') = $3$q$, p_table)
  using p_records, p_shop, p_keep into out;
  return out;
end $f$;

do $mig$
begin
  if to_regprocedure('public.get_ledger_before_branches(uuid)') is null then
    alter function public.get_ledger(uuid) rename to get_ledger_before_branches;
  end if;
end $mig$;

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
  return result;
end $f$;

-- One account per branch.
create or replace function public.checkout_account_token(p_shop uuid, p_customer uuid) returns text
language plpgsql stable set search_path to '' as $f$
declare br text := 'main';
begin
  if (select has_branches from private.branch_view(p_shop)) then br := coalesce(private.request_branch(p_shop), 'main'); end if;
  return 'wallet=' || coalesce((select sum(wallet_added - wallet_used) from public.payments
      where shop_id = p_shop and customer_id = p_customer and coalesce(branch_id, 'main') = br), 0)::text || ';'
    || coalesce((select string_agg(j.id::text || ':' || (j.amount - coalesce((select sum(a.amount) from public.payment_allocations a
        where a.shop_id = p_shop and a.job_id = j.id), 0))::text, ',' order by j.id)
      from public.jobs j where j.shop_id = p_shop and j.customer_id = p_customer and coalesce(j.branch_id, 'main') = br), '');
end $f$;

revoke all on function private.branch_view(uuid), private.branch_records(uuid,jsonb,text,text) from public, anon;
grant execute on function private.branch_view(uuid), private.branch_records(uuid,jsonb,text,text), private.request_branch(uuid) to authenticated;
grant execute on function public.get_ledger_before_branches(uuid) to authenticated;
