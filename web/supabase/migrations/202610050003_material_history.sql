begin;
alter table public.material_stock_changes drop constraint material_stock_changes_action_check;
alter table public.material_stock_changes add constraint material_stock_changes_action_check check (
  action in ('material.created','material.updated','material.stock_added','material.stock_set','material.archived','material.restored'));
alter table public.material_stock_changes alter column before_available drop not null;
alter table public.material_stock_changes add column material_name text not null default '';
alter table public.material_stock_changes add column measurement_unit text not null default '';
alter table public.material_stock_changes add column before_values jsonb;
alter table public.material_stock_changes add column after_values jsonb not null default '{}';
alter table public.material_stock_changes add column details_complete boolean not null default false;

-- Rebuild older history from the existing event trail; preserve previously recorded stock quantities.
with recursive ordered as (
  select e.*, (e.payload->'data'->>'id')::uuid as material_id,
    row_number() over(partition by e.shop_id, e.payload->'data'->>'id'
      order by case when e.payload->>'kind'='material.created' then 1 else (e.payload->'data'->>'baseVersion')::integer+1 end,
      e.received_at,e.id) as position
  from public.ledger_events e where e.payload->>'kind' in
    ('material.created','material.updated','material.stock_added','material.stock_set','material.archived','material.restored')
), reconstructed as (
  select o.*, null::jsonb as before_state,
    jsonb_build_object('name',btrim(o.payload->'data'->>'name'),'available',(o.payload->'data'->>'available')::numeric,
      'measurementUnit',btrim(o.payload->'data'->>'measurementUnit'),'requireSize',(o.payload->'data'->>'requireSize')::boolean,'archived',false) as after_state
  from ordered o where o.position=1 and o.payload->>'kind'='material.created'
  union all
  select o.*, r.after_state as before_state,
    r.after_state || case o.payload->>'kind'
      when 'material.updated' then jsonb_build_object('name',btrim(o.payload->'data'->>'name'),'measurementUnit',btrim(o.payload->'data'->>'measurementUnit'),'requireSize',(o.payload->'data'->>'requireSize')::boolean)
      when 'material.stock_added' then jsonb_build_object('available',(r.after_state->>'available')::numeric+(o.payload->'data'->>'quantity')::numeric)
      when 'material.stock_set' then jsonb_build_object('available',(o.payload->'data'->>'quantity')::numeric)
      when 'material.archived' then '{"archived":true}'::jsonb
      when 'material.restored' then '{"archived":false}'::jsonb
      else '{}'::jsonb end
  from ordered o join reconstructed r on o.shop_id=r.shop_id and o.material_id=r.material_id and o.position=r.position+1
)
insert into public.material_stock_changes(id,shop_id,material_id,action,before_available,after_available,reason,actor_id,actor_label,created_at,
  material_name,measurement_unit,before_values,after_values,details_complete)
select r.id,r.shop_id,r.material_id,r.payload->>'kind',
  coalesce(h.before_available,(r.before_state->>'available')::numeric),
  coalesce(h.after_available,(r.after_state->>'available')::numeric),
  coalesce(h.reason,r.payload->'data'->>'reason',''),r.actor_id,
  coalesce(h.actor_label,nullif(btrim(u.raw_user_meta_data->>'full_name'),''),u.email,r.actor_id::text),
  coalesce(h.created_at,r.received_at),r.after_state->>'name',r.after_state->>'measurementUnit',
  case when r.before_state is null then null else r.before_state || jsonb_build_object('available',coalesce(h.before_available,(r.before_state->>'available')::numeric)) end,
  r.after_state || jsonb_build_object('available',coalesce(h.after_available,(r.after_state->>'available')::numeric)),false
from reconstructed r join auth.users u on u.id=r.actor_id
left join public.material_stock_changes h on h.id=r.id and h.shop_id=r.shop_id
on conflict(id) do update set material_name=excluded.material_name,measurement_unit=excluded.measurement_unit,
  before_values=excluded.before_values,after_values=excluded.after_values;

create function public.record_material_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_event jsonb;
  v_before jsonb;
  v_after jsonb;
begin
  select payload into v_event from public.ledger_events where shop_id=new.shop_id and id=new.last_event_id;
  if v_event is null then raise exception 'Material change must have an event record'; end if;
  if tg_op='UPDATE' then
    v_before := jsonb_build_object('name',old.name,'available',old.available,'measurementUnit',old.measurement_unit,'requireSize',old.require_size,'archived',old.archived);
  end if;
  v_after := jsonb_build_object('name',new.name,'available',new.available,'measurementUnit',new.measurement_unit,'requireSize',new.require_size,'archived',new.archived);
  insert into public.material_stock_changes(id,shop_id,material_id,action,before_available,after_available,reason,actor_id,actor_label,created_at,
    material_name,measurement_unit,before_values,after_values,details_complete)
  values(new.last_event_id,new.shop_id,new.id,v_event->>'kind',(v_before->>'available')::numeric,new.available,
    btrim(coalesce(v_event->'data'->>'reason','')),new.modified_by,new.modified_by_label,new.modified_at,
    new.name,new.measurement_unit,v_before,v_after,true);
  return new;
end;
$$;
revoke all on function public.record_material_change() from public,anon,authenticated;
create trigger material_change_history after insert or update on public.materials for each row execute function public.record_material_change();

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
  insert into public.ledger_events(shop_id, id, actor_id, payload) values(p_shop, v_event, v_user, p_event);
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
  elsif v_kind in ('material.archived', 'material.restored') then
    if v_material.archived = (v_kind = 'material.archived') then raise exception 'Material is already in that state'; end if;
    update public.materials set archived = (v_kind = 'material.archived'), modified_by = v_user,
      modified_by_label = v_label, modified_at = now(), version = version + 1, last_event_id = v_event
      where id = v_id and shop_id = p_shop;
  else raise exception 'Unknown material operation'; end if;

end;
$$;
revoke all on function public.apply_material_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_material_event(uuid, jsonb) to authenticated;

create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  return jsonb_build_object(
    'materialHistory', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'materialId', material_id,
      'materialName', material_name, 'measurementUnit', measurement_unit, 'action', action,
      'beforeAvailable', before_available, 'afterAvailable', after_available, 'reason', reason,
      'changedBy', actor_id, 'changedByLabel', actor_label, 'changedAt', created_at,
      'before', before_values, 'after', after_values, 'detailsComplete', details_complete)
      order by created_at, id), '[]'::jsonb) from public.material_stock_changes where shop_id=p_shop),
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'available', available, 'measurementUnit', measurement_unit, 'requireSize', require_size, 'archived', archived, 'version', version, 'createdBy', created_by, 'createdByLabel', created_by_label, 'createdAt', created_at, 'modifiedBy', modified_by, 'modifiedByLabel', modified_by_label, 'modifiedAt', modified_at, 'lastEventId', last_event_id) order by created_at, id), '[]'::jsonb) from public.materials where shop_id = p_shop),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'createdAt', created_at) order by created_at, id), '[]'::jsonb) from public.customers where shop_id = p_shop),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'customerId', customer_id, 'service', service, 'description', description, 'amount', amount, 'createdAt', created_at) order by created_at, id), '[]'::jsonb) from public.jobs where shop_id = p_shop),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'customerId', p.customer_id, 'amount', p.amount, 'method', p.method, 'paidOn', p.paid_on, 'reference', p.reference, 'createdAt', p.created_at,
      'allocations', (select jsonb_agg(jsonb_build_object('jobId', a.job_id, 'amount', a.amount) order by a.job_id) from public.payment_allocations a where a.shop_id = p_shop and a.payment_id = p.id)) order by p.created_at, p.id), '[]'::jsonb) from public.payments p where p.shop_id = p_shop)
  );
end;
$$;
commit;
