-- History window stage 2, part 1: the checkout account check covers the jobs still owing only.
-- A sale or correction carries what the device expected the customer's account to be. A device
-- keeping recent history only no longer has old paid jobs, so the app now sends the wallet and the
-- jobs still owing (or overpaid). The server accepts that form and the older every-job form, so
-- devices on older app versions keep working.

create or replace function private.owing_account_token(p_shop uuid, p_customer uuid) returns text
language plpgsql stable set search_path to '' as $f$
declare br text := 'main';
begin
  if (select has_branches from private.branch_view(p_shop)) then br := coalesce(private.request_branch(p_shop), 'main'); end if;
  return 'wallet=' || coalesce((select sum(wallet_added - wallet_used) from public.payments
      where shop_id = p_shop and customer_id = p_customer and coalesce(branch_id, 'main') = br), 0)::text || ';'
    || coalesce((select string_agg(x.id::text || ':' || x.owed::text, ',' order by x.id) from (
        select j.id, j.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.shop_id = p_shop and a.job_id = j.id), 0) owed
        from public.jobs j where j.shop_id = p_shop and j.customer_id = p_customer and coalesce(j.branch_id, 'main') = br) x where x.owed <> 0), '');
end $f$;

create or replace function private.account_token_ok(p_token text, p_shop uuid, p_customer uuid) returns boolean
language sql stable set search_path to '' as $f$
  select p_token is not null and (p_token = private.owing_account_token(p_shop, p_customer) or p_token = public.checkout_account_token(p_shop, p_customer))
$f$;
revoke all on function private.owing_account_token(uuid, uuid), private.account_token_ok(text, uuid, uuid) from public, anon;
grant execute on function private.owing_account_token(uuid, uuid), private.account_token_ok(text, uuid, uuid) to authenticated;

do $patch$
declare f text; d text; pat text := $$d->>'expectedAccount' is distinct from public.checkout_account_token(p_shop,$$;
begin
  foreach f in array array['public.apply_checkout_event(uuid,jsonb)', 'private.apply_supervised_event_v1(uuid,jsonb)',
                           'private.apply_supervised_event_v2(uuid,jsonb)', 'private.apply_supervised_event(uuid,jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception '% pattern not found exactly once', f; end if;
    execute replace(d, pat, $$not private.account_token_ok(d->>'expectedAccount',p_shop,$$);
  end loop;
end $patch$;
