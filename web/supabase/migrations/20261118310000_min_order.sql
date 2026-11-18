-- An item's minimum order (services.min_quantity, in pieces; 0 = none), set with the item's icon,
-- category, code and tags (service.display_set, data.minQuantity). Below it a sale is refused when
-- the business says so (settings.jobs.minOrder: 'block', the default; 'warn' lets it through and the
-- app shows a note). Packs and quantity ranges count their pieces. Template parts are not checked.
alter table public.services add column if not exists min_quantity integer not null default 0;
alter table public.services drop constraint if exists services_min_quantity_check;
alter table public.services add constraint services_min_quantity_check check (min_quantity between 0 and 1000000);

-- 1. The business copy carries it.
do $m$ begin
  if not exists (select 1 from pg_proc where proname = 'get_ledger_before_min_order' and pronamespace = 'public'::regnamespace) then
    alter function public.get_ledger(uuid) rename to get_ledger_before_min_order;
  end if;
end $m$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); result jsonb;
begin
  perform set_config('psl.ledger', 'on', true);
  result := public.get_ledger_before_min_order(p_shop);
  if result ? 'services' then
    result := jsonb_set(result, '{services}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('minQuantity', coalesce(s.min_quantity, 0)) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'services') with ordinality x(v, n)
      left join public.services s on s.shop_id = p_shop and s.id = (x.v->>'id')::uuid));
  end if;
  perform set_config('psl.ledger', prev, true);
  return result;
end $f$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;

-- 2. Set with the item's icon, category, code and tags.
do $m$
declare d text := pg_get_functiondef('public.apply_service_display_event(uuid,jsonb)'::regprocedure);
  t1 text := $x$  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();$x$;
  t2 text := $x$code = v_code, tags = v_tags,$x$;
begin
  if position('min_quantity' in d) > 0 then return; end if;
  if position(t1 in d) = 0 or position(t2 in d) = 0 then raise exception 'apply_service_display_event: pattern not found'; end if;
  d := replace(d, t1, $x$  if d ? 'minQuantity' and (jsonb_typeof(d->'minQuantity') <> 'number' or (d->>'minQuantity')::numeric <> trunc((d->>'minQuantity')::numeric)
     or (d->>'minQuantity')::numeric not between 0 and 1000000) then raise exception 'Enter the minimum order as a whole number'; end if;
$x$ || t1);
  d := replace(d, t2, t2 || $x$ min_quantity = case when d ? 'minQuantity' then (d->>'minQuantity')::integer else min_quantity end,$x$);
  execute d;
end $m$;

-- 3. A sale below an item's minimum order (when the business blocks it).
create or replace function private.check_min_order() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare min integer; nm text; q numeric := nullif(new.metadata->>'quantity', '')::numeric;
begin
  if new.metadata ? 'templateSnapshot' or q is null or coalesce(new.metadata->>'serviceId', '') = '' then return new; end if;
  if tg_op = 'UPDATE' and (old.metadata->>'quantity') is not distinct from (new.metadata->>'quantity')
     and (old.metadata->>'serviceId') is not distinct from (new.metadata->>'serviceId') then
    return new;
  end if;
  select s.min_quantity, s.description into min, nm from public.services s
   where s.shop_id = new.shop_id and s.id::text = new.metadata->>'serviceId';
  if coalesce(min, 0) > 0 and q < min and coalesce((select settings->'jobs'->>'minOrder' from public.business_settings
                                                     where shop_id = new.shop_id), 'block') = 'block' then
    raise exception 'The minimum order for % is %.', nm, min using errcode = 'PT409';
  end if;
  return new;
end $f$;
drop trigger if exists check_min_order on public.jobs;
create trigger check_min_order before insert or update of metadata on public.jobs
  for each row execute function private.check_min_order();
