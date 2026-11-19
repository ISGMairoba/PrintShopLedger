-- A branch with its own customers (audit AUD-27): the app counts a customer as this branch's when
-- they have a job, sale, payment or quotation here; the server counted jobs and sales only, so a
-- customer with only a deposit or a quotation at the branch was left out of its download (their
-- quotation showed without its customer). The server now counts payments and quotations too.
do $m$
declare d text := replace(pg_get_functiondef('public.get_ledger_before_guard(uuid)'::regprocedure), E'\r', '');
  t text := $x$       or exists (select 1 from public.checkout_records k where k.shop_id = p_shop and k.customer_id = c.id and k.branch_id = bv.keep_branch)$x$;
begin
  if position('public.payments p where p.shop_id = p_shop and p.customer_id = c.id' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'get_ledger_before_guard: customer rule not found'; end if;
  execute replace(d, t, t || $x$
       or exists (select 1 from public.payments p where p.shop_id = p_shop and p.customer_id = c.id and p.branch_id = bv.keep_branch)
       or exists (select 1 from public.quotations q where q.shop_id = p_shop and q.data->>'customerId' = c.id::text and q.branch_id = bv.keep_branch)$x$);
end $m$;
