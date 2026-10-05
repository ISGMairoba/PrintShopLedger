begin;
create table public.services (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  description text not null check(length(btrim(description)) between 1 and 500),
  material_id uuid not null,
  price bigint not null check(price between 0 and 100000000000),
  archived boolean not null default false,
  version integer not null default 1 check(version>0),
  created_by uuid not null references auth.users(id),
  created_by_label text not null,
  created_at timestamptz not null default now(),
  modified_by uuid not null references auth.users(id),
  modified_by_label text not null,
  modified_at timestamptz not null default now(),
  last_event_id uuid not null,
  unique(shop_id,id),
  foreign key(shop_id,material_id) references public.materials(shop_id,id)
);
create index services_shop_status on public.services(shop_id,archived);
create index services_material on public.services(shop_id,material_id);
alter table public.services enable row level security;
revoke all on public.services from anon,authenticated;
grant select on public.services to authenticated;
create policy member_read on public.services for select to authenticated using(public.is_shop_member(shop_id));

create function public.apply_service_event(p_shop uuid,p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_data jsonb := p_event->'data';
  v_kind text := p_event->>'kind';
  v_event uuid := (p_event->>'id')::uuid;
  v_id uuid := (v_data->>'id')::uuid;
  v_user uuid := auth.uid();
  v_existing jsonb;
  v_actor uuid;
  v_label text;
  v_service public.services%rowtype;
  v_material public.materials%rowtype;
  v_price numeric;
  v_service_exists boolean;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing service identifier'; end if;
  if (v_data->>'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id=p_shop for update;
  select payload,actor_id into v_existing,v_actor from public.ledger_events where shop_id=p_shop and id=v_event;
  if found then
    if v_existing<>p_event or v_actor<>v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),email,id::text) into v_label from auth.users where id=v_user;
  select * into v_service from public.services where id=v_id and shop_id=p_shop for update;
  v_service_exists := found;
  if v_kind='service.created' then
    if v_service_exists then raise exception 'Service ID already exists'; end if;
  else
    if not v_service_exists then raise exception 'Service not found'; end if;
    if (v_data->>'baseVersion')::integer is distinct from v_service.version then raise exception 'Service changed elsewhere. Review the latest version.' using errcode='40001'; end if;
  end if;
  if v_kind in ('service.created','service.updated') then
    if jsonb_typeof(v_data->'description') is distinct from 'string' or length(btrim(v_data->>'description')) not between 1 and 500 then raise exception 'Enter a service description (up to 500 characters)'; end if;
    if jsonb_typeof(v_data->'price') is distinct from 'number' then raise exception 'Price must be a number'; end if;
    v_price := (v_data->>'price')::numeric;
    if v_price<0 or v_price>100000000000 or v_price<>trunc(v_price) then raise exception 'Price must be non-negative integer kobo'; end if;
    select * into v_material from public.materials where shop_id=p_shop and id=(v_data->>'materialId')::uuid;
    if not found then raise exception 'Choose a base material from this workspace' using errcode='P0002'; end if;
    if v_material.archived and (not v_service_exists or v_material.id<>v_service.material_id) then raise exception 'Choose an active base material' using errcode='P0002'; end if;
    if v_kind='service.created' then
      insert into public.services(id,shop_id,description,material_id,price,created_by,created_by_label,modified_by,modified_by_label,last_event_id)
        values(v_id,p_shop,btrim(v_data->>'description'),v_material.id,v_price::bigint,v_user,v_label,v_user,v_label,v_event);
    else
      if v_service.archived then raise exception 'Restore this service before editing it'; end if;
      update public.services set description=btrim(v_data->>'description'),material_id=v_material.id,price=v_price::bigint,
        modified_by=v_user,modified_by_label=v_label,modified_at=now(),version=version+1,last_event_id=v_event where id=v_id and shop_id=p_shop;
    end if;
  elsif v_kind in ('service.archived','service.restored') then
    if v_service.archived=(v_kind='service.archived') then raise exception 'Service is already in that state'; end if;
    update public.services set archived=(v_kind='service.archived'),modified_by=v_user,modified_by_label=v_label,
      modified_at=now(),version=version+1,last_event_id=v_event where id=v_id and shop_id=p_shop;
  else raise exception 'Unknown service operation'; end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,v_event,v_user,p_event);
end;
$$;
revoke all on function public.apply_service_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_service_event(uuid,jsonb) to authenticated;

create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  return jsonb_build_object(
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'materialId',material_id,'price',price,
      'archived',archived,'version',version,'createdBy',created_by,'createdByLabel',created_by_label,'createdAt',created_at,
      'modifiedBy',modified_by,'modifiedByLabel',modified_by_label,'modifiedAt',modified_at,'lastEventId',last_event_id)
      order by description,id), '[]'::jsonb) from public.services where shop_id=p_shop),
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
