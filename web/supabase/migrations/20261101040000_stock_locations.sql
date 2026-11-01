-- Branches, phase 4: stock locations and stores (plan: project doc plans/branches.md).
-- * Locations are the branches and stores (a store is a branch entry with kind 'store'). The main
--   branch keeps its stock in materials.available as before; every other location has its own
--   quantity in location_stock (starting at zero).
-- * A device works in one location (the x-psl-branch header). Every server function that reads
--   or changes stock sees that location's quantity: materials are read through private.at_location,
--   relative stock updates use the location's value, and a trigger stores the new quantity for the
--   location (with its own stock history) instead of changing the main branch's.
-- * Transfers move stock between locations (transfer_stock), recorded on both sides.
-- * Devices receive the items with their location's quantities; the owner also receives every
--   location's quantity. Stock history is kept per location.
-- One-branch businesses are unchanged.

create table if not exists public.location_stock (
  shop_id uuid not null references public.shops(id) on delete cascade,
  location_id text not null check (location_id ~ '^b-[a-z0-9]{6,20}$'),
  material_id uuid not null,
  available numeric not null default 0 check (available between -1000000000000 and 1000000000000),
  modified_at timestamptz not null default now(),
  primary key (shop_id, location_id, material_id)
);
alter table public.location_stock enable row level security;
revoke all on public.location_stock from public, anon, authenticated;

-- The stock location of this request (null = the main branch, or stock handled directly).
create or replace function private.stock_location(p_shop uuid) returns text
language plpgsql security definer set search_path to '' as $f$
begin
  if current_setting('psl.stock_direct', true) = 'on' then return null; end if;
  return private.request_branch(p_shop);
end $f$;

-- A material as stocked at this request's location.
create or replace function private.at_location(p_shop uuid, m public.materials) returns public.materials
language plpgsql security definer set search_path to '' as $f$
declare loc text;
begin
  if m.id is null then return m; end if;
  loc := private.stock_location(p_shop);
  if loc is null then return m; end if;
  m.available := coalesce((select ls.available from public.location_stock ls
    where ls.shop_id = p_shop and ls.location_id = loc and ls.material_id = m.id), 0);
  return m;
end $f$;
create or replace function private.stock_at(p_shop uuid, p_material uuid) returns numeric
language plpgsql security definer set search_path to '' as $f$
declare m public.materials;
begin
  select * into m from public.materials where shop_id = p_shop and id = p_material;
  return (private.at_location(p_shop, m)).available;
end $f$;

-- Stock changes at a location other than the main branch: kept in location_stock with their own
-- history; the main branch's quantity is left as it was.
create or replace function private.location_stock_overlay() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare loc text := private.stock_location(new.shop_id); before_qty numeric; ev jsonb;
begin
  if loc is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.available <> 0 then
      insert into public.location_stock (shop_id, location_id, material_id, available)
      values (new.shop_id, loc, new.id, new.available)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
      new.available := 0;
    end if;
    return new;
  end if;
  if new.available is not distinct from old.available then return new; end if;
  before_qty := coalesce((select ls.available from public.location_stock ls
    where ls.shop_id = new.shop_id and ls.location_id = loc and ls.material_id = new.id), 0);
  if new.available < 0 and new.available < before_qty and exists (select 1 from public.business_settings s
      where s.shop_id = new.shop_id and s.settings->'jobs'->>'stockBelowZero' = 'block') then
    raise exception 'Not enough %: % % in stock, this needs %. Ask an admin to update the stock first.',
      new.name, trim_scale(greatest(before_qty, 0)), new.measurement_unit, trim_scale(before_qty - new.available)
      using errcode = 'PT409';
  end if;
  insert into public.location_stock (shop_id, location_id, material_id, available)
  values (new.shop_id, loc, new.id, new.available)
  on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
  select payload into ev from public.ledger_events where shop_id = new.shop_id and id = new.last_event_id;
  insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason,
    actor_id, actor_label, created_at, material_name, measurement_unit, before_values, after_values, details_complete,
    job_id, checkout_id, expense_id, branch_id)
  values (new.last_event_id, new.shop_id, new.id, coalesce(ev->>'kind', 'material.stock_changed'), before_qty, new.available,
    btrim(coalesce(ev->'data'->>'reason', '')), new.modified_by, new.modified_by_label, new.modified_at, new.name,
    new.measurement_unit, jsonb_build_object('available', before_qty), jsonb_build_object('available', new.available), true,
    (ev->'data'->>'jobId')::uuid, (ev->'data'->>'checkoutId')::uuid, (ev->'data'->>'expenseId')::uuid, loc)
  on conflict do nothing;
  perform set_config('psl.loc_hist', new.last_event_id::text, true);
  new.available := old.available;
  return new;
end $f$;
-- Runs before the other material triggers (they then see the main branch's quantity unchanged).
drop trigger if exists a_location_stock on public.materials;
create trigger a_location_stock before insert or update on public.materials
  for each row execute function private.location_stock_overlay();

do $mig$
declare
  src text; fn text; stmt text; n integer; v text;
  -- History for a location's change is recorded by the overlay above.
  -- (single-line match: the stored function may have Windows line endings)
  hist_a text := $x$select payload into v_event from public.ledger_events where shop_id=new.shop_id and id=new.last_event_id;$x$;
  hist_b text := $x$if current_setting('psl.loc_hist', true) is not distinct from new.last_event_id::text then return new; end if; select payload into v_event from public.ledger_events where shop_id=new.shop_id and id=new.last_event_id;$x$;
  -- Relative stock updates use the location's quantity of the row read.
  rel text[][] := array[
    array['public.apply_checkout_event(uuid,jsonb)', 'set available=available-case when counted', 'set available=mat.available-case when counted'],
    array['private.apply_supervised_event_v1(uuid,jsonb)', 'available=round(available+returned,3)', 'available=round(m.available+returned,3)'],
    array['private.apply_supervised_event_v2(uuid,jsonb)', 'available=round(available+delta,3)', 'available=round(m.available+delta,3)'],
    array['private.deduct_template_stock(uuid,jsonb,uuid,uuid,uuid,text)', $x$available=available-(s->>'quantity')::numeric$x$, $x$available=private.stock_at(p_shop,mid)-(s->>'quantity')::numeric$x$],
    array['public.apply_job_material_event(uuid,jsonb)', 'available=round(available-qty,3)', 'available=round(m.available-qty,3)'],
    array['private.choice_usage_apply(uuid,uuid,jsonb,jsonb,jsonb,text,text,timestamp with time zone,uuid,text,boolean)', 'available=round(available+delta,3)', 'available=round(m.available+delta,3)']
  ];
  i integer;
begin
  src := pg_get_functiondef('public.record_material_change()'::regprocedure);
  if (length(src) - length(replace(src, hist_a, ''))) / length(hist_a) <> 1 then raise exception 'record_material_change changed; review the stock locations migration'; end if;
  execute replace(src, hist_a, hist_b);

  for i in 1 .. array_length(rel, 1) loop
    src := pg_get_functiondef(rel[i][1]::regprocedure);
    if (length(src) - length(replace(src, rel[i][2], ''))) / length(rel[i][2]) <> 1 then
      raise exception '% changed (%); review the stock locations migration', rel[i][1], rel[i][2];
    end if;
    execute replace(src, rel[i][2], rel[i][3]);
  end loop;

  -- Every read of a material into a row variable sees the location's quantity.
  foreach fn in array array['public.apply_material_event(uuid,jsonb)', 'public.apply_checkout_event(uuid,jsonb)',
      'private.apply_expense_event(uuid,jsonb)', 'private.apply_supervised_event_v1(uuid,jsonb)', 'private.apply_supervised_event_v2(uuid,jsonb)',
      'public.apply_job_material_event(uuid,jsonb)',
      'private.choice_usage_apply(uuid,uuid,jsonb,jsonb,jsonb,text,text,timestamp with time zone,uuid,text,boolean)',
      'private.tpl_price(uuid,jsonb,jsonb,numeric,jsonb,boolean)'] loop
    src := pg_get_functiondef(fn::regprocedure);
    n := 0;
    for stmt, v in select distinct m[1], m[2] from regexp_matches(src, '(select \* into (mat|m|fm|v_material) from public\.materials where [^;]*)', 'g') m loop
      src := replace(src, stmt || ';', stmt || ';' || v || ':=private.at_location(p_shop,' || v || ');');
      n := n + 1;
    end loop;
    if n = 0 then raise exception '% has no material reads; review the stock locations migration', fn; end if;
    execute src;
  end loop;
end $mig$;

-- Move stock between locations ('main' = the main branch). From is this device's location unless
-- the person works in every branch.
create or replace function public.transfer_stock(p_shop uuid, p_material uuid, p_from text, p_to text, p_quantity numeric, p_reason text default '')
returns void language plpgsql security definer set search_path to '' as $f$
declare
  here text := coalesce(private.request_branch(p_shop), 'main');
  all_branches boolean;
  m public.materials;
  ev uuid := gen_random_uuid();
  label text;
  from_before numeric; to_before numeric;
  locs jsonb;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000000000 or p_quantity <> round(p_quantity, 3) then
    raise exception 'Enter a quantity greater than zero with at most three decimal places';
  end if;
  if p_from = p_to then raise exception 'Choose two different locations'; end if;
  select b.settings->'branches' into locs from public.business_settings b where b.shop_id = p_shop;
  if not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_to and not coalesce((x->>'archived')::boolean, false))
     or not exists (select 1 from jsonb_array_elements(coalesce(locs, '[]'::jsonb)) x where x->>'id' = p_from and not coalesce((x->>'archived')::boolean, false)) then
    raise exception 'Choose open locations';
  end if;
  select (select v.keep_branch is null from private.branch_view(p_shop) v) into all_branches;
  if p_from <> here and not all_branches then raise exception 'You can send stock only from the location this device works in'; end if;
  select * into m from public.materials where shop_id = p_shop and id = p_material and not archived for update;
  if not found then raise exception 'Stock item not found'; end if;
  select coalesce(sm.name, '') into label from public.shop_members sm where sm.shop_id = p_shop and sm.user_id = auth.uid();
  from_before := case when p_from = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_from and material_id = m.id for update), 0) end;
  if from_before < p_quantity then
    raise exception 'Not enough %: % % at the sending location', m.name, trim_scale(greatest(from_before, 0)), m.measurement_unit;
  end if;
  to_before := case when p_to = 'main' then m.available else coalesce((select available from public.location_stock
    where shop_id = p_shop and location_id = p_to and material_id = m.id for update), 0) end;
  insert into public.ledger_events (shop_id, id, actor_id, payload) values (p_shop, ev, auth.uid(), jsonb_build_object(
    'id', ev, 'kind', 'material.transferred', 'data', jsonb_build_object('id', m.id, 'from', p_from, 'to', p_to,
      'quantity', p_quantity, 'reason', left(btrim(coalesce(p_reason, '')), 500), 'modifiedBy', auth.uid(), 'modifiedAt', now())));
  perform set_config('psl.stock_direct', 'on', true);
  -- Each side: the main branch through materials (its own history), others in location_stock.
  if p_from = 'main' or p_to = 'main' then
    update public.materials set available = case when p_from = 'main' then available - p_quantity else available + p_quantity end,
      version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = ev
      where shop_id = p_shop and id = m.id;
  else
    -- Devices pick up the change with their next sync (no main-branch history for this).
    perform set_config('psl.loc_hist', ev::text, true);
    update public.materials set last_event_id = ev where shop_id = p_shop and id = m.id;
  end if;
  if p_from <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_from, m.id, from_before - p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', from_before, from_before - p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', from_before, 'to', p_to),
      jsonb_build_object('available', from_before - p_quantity), true, p_from);
  end if;
  if p_to <> 'main' then
    insert into public.location_stock (shop_id, location_id, material_id, available) values (p_shop, p_to, m.id, to_before + p_quantity)
      on conflict (shop_id, location_id, material_id) do update set available = excluded.available, modified_at = now();
    insert into public.material_stock_changes (id, shop_id, material_id, action, before_available, after_available, reason, actor_id, actor_label,
      created_at, material_name, measurement_unit, before_values, after_values, details_complete, branch_id)
    values (gen_random_uuid(), p_shop, m.id, 'material.transferred', to_before, to_before + p_quantity, left(btrim(coalesce(p_reason, '')), 500),
      auth.uid(), label, now(), m.name, m.measurement_unit, jsonb_build_object('available', to_before, 'from', p_from),
      jsonb_build_object('available', to_before + p_quantity), true, p_to);
  end if;
  -- The main branch's side is recorded by its own history trigger; tag it with the main branch.
  update public.material_stock_changes set branch_id = null where shop_id = p_shop and id = ev;
  perform set_config('psl.stock_direct', '', true);
end $f$;

-- Devices receive items with their location's quantities; the owner also receives every location's.
create or replace function private.location_materials(p_shop uuid, p_materials jsonb) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare loc text := private.stock_location(p_shop); out jsonb;
begin
  if loc is null or p_materials is null or jsonb_typeof(p_materials) <> 'array' then return p_materials; end if;
  select coalesce(jsonb_agg(e.v || jsonb_build_object('available', coalesce(ls.available, 0)) order by e.o), '[]'::jsonb) into out
  from jsonb_array_elements(p_materials) with ordinality e(v, o)
  left join public.location_stock ls on ls.shop_id = p_shop and ls.location_id = loc and ls.material_id::text = e.v->>'id';
  return out;
end $f$;
create or replace function private.all_location_stock(p_shop uuid) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id::text || ':main', 'materialId', m.id, 'location', 'main', 'available', m.available)), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('id', ls.material_id::text || ':' || ls.location_id, 'materialId', ls.material_id, 'location', ls.location_id, 'available', ls.available))
                 from public.location_stock ls where ls.shop_id = p_shop), '[]'::jsonb)
  from public.materials m where m.shop_id = p_shop
$f$;

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
      ('quotations','quotations'), ('reminders','customer_reminders'), ('materialWaste','material_waste'),
      ('materialHistory','material_stock_changes')) x(k, t) loop
    if result ? part.k then
      result := jsonb_set(result, array[part.k], private.branch_records(p_shop, result->part.k, part.t, v.keep_branch));
    end if;
  end loop;
  if v.keep_branch is not null then result := private.branch_accounts(p_shop, result, v.keep_branch); end if;
  if result ? 'services' then result := jsonb_set(result, '{services}', private.branch_price_services(p_shop, result->'services')); end if;
  if result ? 'materials' then result := jsonb_set(result, '{materials}', private.location_materials(p_shop, result->'materials')); end if;
  if v.keep_branch is null then result := result || jsonb_build_object('locationStock', private.all_location_stock(p_shop)); end if;
  return result;
end $f$;

-- Stores do not count toward the plan's branch limit.
create or replace function private.check_branch_limit() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare open_now integer; open_before integer := 0; lim integer;
begin
  select count(*) into open_now from jsonb_array_elements(coalesce(new.settings->'branches', '[]'::jsonb)) b
    where not coalesce((b->>'archived')::boolean, false) and coalesce(b->>'kind', 'branch') <> 'store';
  open_now := greatest(open_now, 1);
  if tg_op = 'UPDATE' then
    select count(*) into open_before from jsonb_array_elements(coalesce(old.settings->'branches', '[]'::jsonb)) b
      where not coalesce((b->>'archived')::boolean, false) and coalesce(b->>'kind', 'branch') <> 'store';
    open_before := greatest(open_before, 1);
  end if;
  if open_now <= greatest(open_before, 1) then return new; end if;
  select coalesce(s.max_branches, p.max_branches) into lim
    from public.subscriptions s left join public.plans p on p.id = s.plan_id where s.shop_id = new.shop_id;
  if lim is not null and open_now > lim then
    raise exception 'This business''s PrintShopLedger plan allows % open branch%. Contact PrintShopLedger to add more.',
      lim, case when lim = 1 then '' else 'es' end;
  end if;
  return new;
end $f$;

-- The owner's devices also keep every location's quantities up to date with each sync.
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare result jsonb; key text; extra jsonb := '{}'; v record;
begin
  result := public.get_ledger_changes_before_operations(p_shop, p_since);
  foreach key in array array['payees','moneyAccounts','accountEntries','operationHistory'] loop
    extra := extra || jsonb_build_object(key, (select coalesce(jsonb_agg(data order by data->>'modifiedAt', id), '[]'::jsonb)
      from public.business_operations_records where shop_id = p_shop and collection = key
        and (coalesce((result->>'full')::boolean, false) or sync_xid >= p_since::xid8)));
  end loop;
  select * into v from private.branch_view(p_shop);
  if v.has_branches and v.keep_branch is not null then extra := private.branch_accounts(p_shop, extra, v.keep_branch); end if;
  if v.has_branches and v.keep_branch is null then extra := extra || jsonb_build_object('locationStock', private.all_location_stock(p_shop)); end if;
  return jsonb_set(result, '{ledger}', (result->'ledger') || extra);
end $f$;

revoke all on function private.stock_location(uuid), private.at_location(uuid,public.materials), private.stock_at(uuid,uuid),
  private.location_stock_overlay(), private.location_materials(uuid,jsonb), private.all_location_stock(uuid),
  public.transfer_stock(uuid,uuid,text,text,numeric,text) from public, anon;
grant execute on function private.stock_location(uuid), private.at_location(uuid,public.materials), private.stock_at(uuid,uuid),
  private.location_materials(uuid,jsonb), private.all_location_stock(uuid), public.transfer_stock(uuid,uuid,text,text,numeric,text) to authenticated;
