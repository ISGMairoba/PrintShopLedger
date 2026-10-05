begin;
create table public.material_stock_changes (
  id uuid primary key,
  shop_id uuid not null,
  material_id uuid not null,
  action text not null check (action in ('material.stock_added','material.stock_set')),
  before_available numeric(18,3) not null,
  after_available numeric(18,3) not null,
  reason text not null default '' check (length(reason)<=500),
  actor_id uuid not null references auth.users(id),
  actor_label text not null,
  created_at timestamptz not null default now(),
  foreign key(shop_id,material_id) references public.materials(shop_id,id)
);
create index material_stock_changes_material on public.material_stock_changes(shop_id,material_id,created_at);
alter table public.material_stock_changes enable row level security;
revoke all on public.material_stock_changes from anon,authenticated;
grant select on public.material_stock_changes to authenticated;
create policy member_read on public.material_stock_changes for select to authenticated using(public.is_shop_member(shop_id));
create or replace function public.apply_material_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_data jsonb := p_event -> 'data';
  v_kind text := p_event ->> 'kind';
  v_event uuid := (p_event ->> 'id')::uuid;
  v_id uuid := (v_data ->> 'id')::uuid;
  v_user uuid := auth.uid();
  v_label text;
  v_existing jsonb;
  v_actor uuid;
  v_material public.materials%rowtype;
  v_available numeric;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing material identifier'; end if;
  if (v_data ->> 'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select payload, actor_id into v_existing, v_actor from public.ledger_events where shop_id = p_shop and id = v_event;
  if found then
    if v_existing <> p_event or v_actor <> v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data ->> 'full_name'), ''), email, id::text)
    into v_label from auth.users where id = v_user;
  select * into v_material from public.materials where id = v_id and shop_id = p_shop for update;
  if v_kind = 'material.created' then
    if found then raise exception 'Material ID already exists'; end if;
  else
    if not found then raise exception 'Material not found'; end if;
    if (v_data ->> 'baseVersion')::integer is distinct from v_material.version then
      raise exception 'Material changed elsewhere. Sync and reopen it before editing.' using errcode = '40001';
    end if;
  end if;
  if v_kind in ('material.created', 'material.updated') then
    if jsonb_typeof(v_data -> 'available') is distinct from 'number' then raise exception 'Available must be a number'; end if;
    v_available := (v_data ->> 'available')::numeric;
    if v_available < 0 or v_available > 1000000000000 or v_available <> round(v_available, 3) then
      raise exception 'Available must be non-negative with at most three decimal places';
    end if;
    if jsonb_typeof(v_data -> 'requireSize') is distinct from 'boolean' then raise exception 'Require Size must be boolean'; end if;
    if v_kind = 'material.created' then
      insert into public.materials(id, shop_id, name, available, measurement_unit, require_size, created_by,
        created_by_label, modified_by, modified_by_label, last_event_id)
      values(v_id, p_shop, btrim(v_data ->> 'name'), v_available, btrim(v_data ->> 'measurementUnit'),
        (v_data ->> 'requireSize')::boolean, v_user, v_label, v_user, v_label, v_event);
    else
      if v_material.archived then raise exception 'Restore this material before editing it'; end if;
      update public.materials set name = btrim(v_data ->> 'name'),
        measurement_unit = btrim(v_data ->> 'measurementUnit'), require_size = (v_data ->> 'requireSize')::boolean,
        modified_by = v_user, modified_by_label = v_label, modified_at = now(),
        version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
    end if;
  elsif v_kind in ('material.stock_added', 'material.stock_set') then
    if v_material.archived then raise exception 'Restore this material before changing stock'; end if;
    if jsonb_typeof(v_data -> 'quantity') is distinct from 'number' then raise exception 'Stock quantity must be a number'; end if;
    v_available := (v_data ->> 'quantity')::numeric;
    if v_available < 0 or v_available > 1000000000000 or v_available <> round(v_available,3) then raise exception 'Stock quantity must be non-negative with at most three decimal places'; end if;
    if length(coalesce(v_data ->> 'reason','')) > 500 then raise exception 'Stock note is too long'; end if;
    if v_kind = 'material.stock_added' then
      if v_available <= 0 then raise exception 'Quantity to add must be greater than zero'; end if;
      v_available := v_material.available + v_available;
    end if;
    if v_available > 1000000000000 then raise exception 'Available quantity is too large'; end if;
    update public.materials set available = v_available, modified_by = v_user, modified_by_label = v_label,
      modified_at = now(), version = version + 1, last_event_id = v_event where id = v_id and shop_id = p_shop;
    insert into public.material_stock_changes(id,shop_id,material_id,action,before_available,after_available,reason,actor_id,actor_label)
      values(v_event,p_shop,v_id,v_kind,v_material.available,v_available,coalesce(v_data ->> 'reason',''),v_user,v_label);
  elsif v_kind in ('material.archived', 'material.restored') then
    if v_material.archived = (v_kind = 'material.archived') then raise exception 'Material is already in that state'; end if;
    update public.materials set archived = (v_kind = 'material.archived'), modified_by = v_user,
      modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  else raise exception 'Unknown material operation'; end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values(p_shop, v_event, v_user, p_event);
end;
$$;
revoke all on function public.apply_material_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_material_event(uuid, jsonb) to authenticated;


commit;
