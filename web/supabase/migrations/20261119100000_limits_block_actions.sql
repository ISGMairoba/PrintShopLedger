-- Page limits also block their actions (audit AUD-41, decided 19 Nov). A General Manager's branch
-- limit or a Manager's limit for one person took pages away in the app only; the server still took
-- that page's work from them. Now each kind of change needs at least one page that can make it,
-- among the pages the person may open there (public.my_page_limits). Business Settings → Security →
-- "Page limits also block their actions" (security.limitsBlockActions, on by default) turns it off.
-- Only the extra limits (branch, person) are checked here; the rank's own pages are not.
-- (Patterns are one line each, so the SQL editor's line breaks don't matter.)

-- 1. The setting.
do $m$
declare d text := replace(pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure), E'\r', '');
  t text := $x$key not in ('autoLockMinutes','syncMinutes','historyKeep','lockOnOpen'))$x$;
  g text := $x$ if config->'security' ? 'lockOnOpen' and$x$;
begin
  if position('limitsBlockActions' in d) > 0 then return; end if;
  if position(t in d) = 0 or position(g in d) = 0 then raise exception 'check_dynamic_business_settings: security check not found'; end if;
  d := replace(d, t, $x$key not in ('autoLockMinutes','syncMinutes','historyKeep','lockOnOpen','limitsBlockActions'))$x$);
  d := replace(d, g, $x$ if config->'security' ? 'limitsBlockActions' and jsonb_typeof(config->'security'->'limitsBlockActions') is distinct from 'boolean' then raise exception 'Choose whether page limits also block their actions';end if;
$x$ || g);
  execute d;
end $m$;

-- 2. The pages that can make each kind of change (generous: any page where the app makes it).
create or replace function private.event_pages(p_kind text) returns text[]
language sql immutable set search_path to '' as $f$
  select case
    when p_kind = 'checkout.completed' then array['Point of Service','Quotations','Pricing Templates','Jobs','Customers']
    when p_kind = 'customer.reminded' then array['Payment Reminders','Customers','Jobs']
    when p_kind like 'customer.%' then array['Point of Service','Quotations','Pricing Templates','Customers','Payment Reminders','Jobs','Payments']
    when p_kind like 'job.%' then array['Jobs','Point of Service','My Sales','Customers','Dashboard']
    when p_kind like 'quotation.%' then array['Quotations','Point of Service','Pricing Templates']
    when p_kind like 'expense.%' then array['Expenses','Stock History','Materials','Payees','Accounts']
    when p_kind like 'account.%' or p_kind like 'payee.%' or p_kind like 'repeat.%' then array['Accounts','Payees','Expenses']
    when p_kind like 'service.%' then array['Services','Edit Products','Pricing Templates','Point of Service','Materials']
    when p_kind like 'material.%' then array['Materials','Material Waste','Edit Products','Services','Stock History']
    when p_kind like 'sale.%' or p_kind = 'payment.corrected' then array['Sale Adjustments','Payments','Jobs','My Sales','Customers','Point of Service']
  end
$f$;

-- 3. The check. Allowed when: the business turned it off; no branch or personal limit applies; or
-- one of the pages is among those left. A supervisor applying a reviewed change for someone, and a
-- retry of a change already saved, are not checked again.
create or replace function private.assert_pages(p_shop uuid, p_pages text[]) returns void
language plpgsql stable security definer set search_path to '' as $f$
declare lim text[];
begin
  if p_pages is null then return; end if;
  if current_setting('printshopledger.review_actor', true) = p_shop::text || ':' || auth.uid()::text then return; end if;
  if (private.branch_settings(p_shop, private.request_branch(p_shop))->'security'->>'limitsBlockActions') = 'false' then return; end if;
  lim := public.my_page_limits(p_shop);
  if lim is null or lim && p_pages then return; end if;
  raise exception 'Your pages here don''t include %. Ask a Manager to change your pages.', p_pages[1] using errcode = 'PT409';
end $f$;
revoke all on function private.assert_pages(uuid, text[]) from public, anon, authenticated;

create or replace function private.assert_event_pages(p_shop uuid, p_event jsonb) returns void
language plpgsql stable security definer set search_path to '' as $f$
begin
  if exists (select 1 from public.ledger_events where shop_id = p_shop and id::text = p_event->>'id' and actor_id = auth.uid() and payload = p_event) then return; end if;
  perform private.assert_pages(p_shop, private.event_pages(p_event->>'kind'));
end $f$;
revoke all on function private.assert_event_pages(uuid, jsonb) from public, anon, authenticated;
-- Signed-in staff may call it: the expense and supervised functions below run as them (it only
-- refuses or lets through). Without this they failed with "permission denied" (hotfix, 20 Nov).
grant execute on function private.assert_event_pages(uuid, jsonb) to authenticated;

-- 4. Where it is checked.
-- 4a. Sales, customers, materials, items, jobs and accounts already pass through assert_sync_dependencies.
do $m$
declare d text := replace(pg_get_functiondef('private.assert_sync_dependencies(uuid,jsonb)'::regprocedure), E'\r', '');
  t text := $x$ if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level=1) then return;end if;$x$;
begin
  if position('assert_event_pages' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'assert_sync_dependencies: start not found'; end if;
  execute replace(d, t, $x$ perform private.assert_event_pages(p_shop,p_event);
$x$ || t);
end $m$;

-- 4b. Expenses and supervised changes (corrections, refunds, waste).
create or replace function public.apply_expense_event(p_shop uuid, p_event jsonb) returns void
language sql set search_path to '' as $f$
  select private.assert_event_pages(p_shop, p_event);
  select private.apply_expense_event(p_shop, p_event);
$f$;
create or replace function public.apply_supervised_event(p_shop uuid, p_event jsonb) returns jsonb
language sql set search_path to '' as $f$
  select private.assert_event_pages(p_shop, p_event);
  select private.apply_supervised_event(p_shop, p_event);
$f$;

-- 4c. Quotations, reminders and stock transfers: a check at the start of each.
do $m$
declare f regprocedure; d text; pages text;
begin
  for f, pages in select x.f::regprocedure, x.pages from (values
      ('public.apply_quotation_event(uuid,jsonb)', $x$private.event_pages(p_event->>'kind')$x$),
      ('public.apply_reminder_event(uuid,jsonb)', $x$private.event_pages(p_event->>'kind')$x$),
      ('public.transfer_stock(uuid,uuid,text,text,numeric,text,numeric,boolean)', $x$array['Materials','Stock History']$x$),
      ('public.transfer_stock(uuid,uuid,uuid,text,text,numeric,text,numeric,boolean)', $x$array['Materials','Stock History']$x$)) x(f, pages)
    where to_regprocedure(x.f) is not null loop
    d := replace(pg_get_functiondef(f), E'\r', '');
    if position('private.assert_pages(' in d) > 0 then continue; end if;
    if position(E'\nbegin' in d) = 0 then raise exception '%: start not found', f; end if;
    execute regexp_replace(d, E'\nbegin\\s*\n', E'\nbegin\n  perform private.assert_pages(p_shop, ' || pages || E');\n');
  end loop;
end $m$;
