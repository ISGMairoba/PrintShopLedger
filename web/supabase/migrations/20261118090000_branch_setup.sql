-- Branch setup: each branch chooses what it does (retail, print or both: settings only), whether
-- it uses the main branch's prices or its own, and whether it sells every item or only chosen ones.
--   settings.branches[i].type   'both' | 'print' | 'retail'  (left out = the business's type)
--   settings.branches[i].prices 'main' | 'own'               (left out = settings.branchPricing)
--   settings.branches[i].sells  'chosen'                     (left out = every item)
-- Items sold at a chosen-items branch list it in services.sold_at. Items added at such a branch
-- are sold there; the General Manager and Developer choose the rest.

alter table public.services add column if not exists sold_at jsonb not null default '[]'::jsonb;
alter table public.services drop constraint if exists services_sold_at_check;
alter table public.services add constraint services_sold_at_check
  check (jsonb_typeof(sold_at) = 'array' and jsonb_array_length(sold_at) <= 60);

-- Whether a branch sells only chosen items.
create or replace function private.branch_sells_chosen(p_shop uuid, p_branch text) returns boolean
language sql stable security definer set search_path to '' as $f$
  select coalesce(p_branch is not null and p_branch <> 'main' and exists (
    select 1 from public.business_settings b
    cross join lateral jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) br
    where b.shop_id = p_shop and br->>'id' = p_branch and br->>'sells' = 'chosen'), false)
$f$;
revoke all on function private.branch_sells_chosen(uuid, text) from public, anon, authenticated;

-- 1. The business copy carries soldAt.
do $m$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_ledger_before_sold_at') then
    alter function public.get_ledger(uuid) rename to get_ledger_before_sold_at;
  end if;
end $m$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $function$
declare result jsonb := public.get_ledger_before_sold_at(p_shop);
begin
  if result ? 'services' then
    result := jsonb_set(result, '{services}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('soldAt', coalesce(s.sold_at, '[]'::jsonb)) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'services') with ordinality x(v, n)
      left join public.services s on s.shop_id = p_shop and s.id = (x.v->>'id')::uuid));
  end if;
  return result;
end $function$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
revoke all on function public.get_ledger_before_sold_at(uuid) from public, anon;
grant execute on function public.get_ledger_before_sold_at(uuid) to authenticated;

-- 2. Prices: each branch's own choice; branches without one follow settings.branchPricing.
create or replace function private.price_branch(p_shop uuid) returns text
language plpgsql security definer set search_path to '' as $function$
declare br text := private.request_branch(p_shop); cached text := current_setting('psl.price_branch', true); per boolean;
begin
  if br is null then return null; end if;
  if cached = p_shop::text || ':' || br then return br; end if;
  if cached = p_shop::text || ':!' || br then return null; end if;
  select coalesce(
      (select x->>'prices' from jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x where x->>'id' = br limit 1),
      case when coalesce(b.settings->>'branchPricing', 'shared') = 'perBranch' then 'own' else 'main' end) = 'own'
    into per from public.business_settings b where b.shop_id = p_shop;
  per := coalesce(per, false);
  perform set_config('psl.price_branch', p_shop::text || ':' || case when per then '' else '!' end || br, true);
  return case when per then br end;
end $function$;

-- 3. Selling: an item not chosen for a chosen-items branch cannot be sold there.
create or replace function private.assert_sold_here(p_shop uuid, s public.services) returns void
language plpgsql security definer set search_path to '' as $function$
declare br text;
begin
  if s.id is null then return; end if;
  br := private.request_branch(p_shop);
  if br is null or not private.branch_sells_chosen(p_shop, br) then return; end if;
  if not coalesce(s.sold_at ? br, false) then
    raise exception '% is not sold at this branch', s.description using errcode = 'PT409';
  end if;
end $function$;
revoke all on function private.assert_sold_here(uuid, public.services) from public, anon, authenticated;

do $m$
declare def text; t text; n integer;
begin
  def := pg_get_functiondef('public.apply_checkout_event'::regproc);
  if position('assert_sold_here' in def) = 0 then
    t := 'svc:=private.branch_service(p_shop,svc);';
    n := (length(def) - length(replace(def, t, ''))) / length(t);
    if n <> 1 then raise exception 'apply_checkout_event: item price read found % times', n; end if;
    execute replace(def, t, t || 'perform private.assert_sold_here(p_shop,svc);');
  end if;
  def := pg_get_functiondef('private.apply_supervised_event_v2'::regproc);
  if position('assert_sold_here' in def) = 0 then
    t := 's:=private.branch_service(p_shop,s);';
    n := (length(def) - length(replace(def, t, ''))) / length(t);
    if n <> 1 then raise exception 'apply_supervised_event_v2: item price read found % times', n; end if;
    execute replace(def, t, t || 'perform private.assert_sold_here(p_shop,s);');
  end if;
end $m$;

-- 4. An item added at a chosen-items branch is sold there (the event is tagged with its branch).
create or replace function private.sold_where_added() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  if new.payload->>'kind' = 'service.created' and new.branch_id is not null
     and private.branch_sells_chosen(new.shop_id, new.branch_id) then
    update public.services set sold_at = sold_at || to_jsonb(new.branch_id)
     where shop_id = new.shop_id and id = (new.payload->'data'->>'id')::uuid and not sold_at ? new.branch_id;
  end if;
  return null;
end $function$;
drop trigger if exists sold_where_added on public.ledger_events;
create trigger sold_where_added after insert on public.ledger_events
  for each row execute function private.sold_where_added();

-- 5. The General Manager and Developer choose items: all of one branch's at once, or one item's branches.
create or replace function private.assert_chooses_items(p_shop uuid) returns void
language plpgsql security definer set search_path to '' as $function$
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and rank >= 4) then
    raise exception 'Only the General Manager or Developer chooses the items a branch sells' using errcode = '42501';
  end if;
end $function$;
revoke all on function private.assert_chooses_items(uuid) from public, anon, authenticated;

create or replace function public.set_branch_items(p_shop uuid, p_branch text, p_services uuid[]) returns integer
language plpgsql security definer set search_path to '' as $function$
declare n integer;
begin
  perform private.assert_chooses_items(p_shop);
  if p_branch is null or p_branch !~ '^b-[a-z0-9]{6,20}$' then raise exception 'Choose a branch'; end if;
  if coalesce(cardinality(p_services), 0) > 5000 then raise exception 'Too many items'; end if;
  perform 1 from public.shops where id = p_shop for update;
  update public.services set sold_at = sold_at - p_branch
   where shop_id = p_shop and sold_at ? p_branch and not (id = any(coalesce(p_services, '{}')));
  update public.services set sold_at = sold_at || to_jsonb(p_branch)
   where shop_id = p_shop and id = any(coalesce(p_services, '{}')) and not sold_at ? p_branch;
  select count(*) into n from public.services where shop_id = p_shop and sold_at ? p_branch;
  return n;
end $function$;
revoke all on function public.set_branch_items(uuid, text, uuid[]) from public, anon;
grant execute on function public.set_branch_items(uuid, text, uuid[]) to authenticated;

create or replace function public.set_item_branches(p_shop uuid, p_service uuid, p_branches text[]) returns void
language plpgsql security definer set search_path to '' as $function$
declare list text[] := coalesce(p_branches, '{}');
begin
  perform private.assert_chooses_items(p_shop);
  if cardinality(list) > 50 or exists (select 1 from unnest(list) b where b !~ '^b-[a-z0-9]{6,20}$') then
    raise exception 'Choose branches from the list';
  end if;
  update public.services set sold_at = (select coalesce(jsonb_agg(distinct b), '[]'::jsonb) from unnest(list) b)
   where shop_id = p_shop and id = p_service;
  if not found then raise exception 'Item not found'; end if;
end $function$;
revoke all on function public.set_item_branches(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_item_branches(uuid, uuid, text[]) to authenticated;
