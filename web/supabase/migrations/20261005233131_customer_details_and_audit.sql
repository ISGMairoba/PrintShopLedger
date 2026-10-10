begin;
alter table public.customers add column address text not null default '' check(length(address)<=500);
alter table public.customers add column credit_limit bigint not null default 0 check(credit_limit between 0 and 100000000000);
alter table public.customers add column archived boolean not null default false;
alter table public.customers add column version integer not null default 1 check(version>0);
alter table public.customers add column created_by uuid references auth.users(id);
alter table public.customers add column created_by_label text not null default 'Unknown (older record)';
alter table public.customers add column modified_by uuid references auth.users(id);
alter table public.customers add column modified_by_label text not null default 'Unknown (older record)';
alter table public.customers add column modified_at timestamptz not null default now();
alter table public.customers add column last_event_id uuid;
update public.customers set modified_at=created_at;
update public.customers c set created_by=e.actor_id,modified_by=e.actor_id,
  created_by_label=coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),u.email,u.id::text),
  modified_by_label=coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),u.email,u.id::text),
  last_event_id=e.id
from public.ledger_events e join auth.users u on u.id=e.actor_id
where e.shop_id=c.shop_id and e.payload->>'kind'='customer.created' and e.payload->'data'->>'id'=c.id::text;
create index customers_shop_status on public.customers(shop_id,archived);

create function public.apply_customer_event(p_shop uuid,p_event jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_data jsonb:=p_event->'data';
  v_kind text:=p_event->>'kind';
  v_event uuid:=(p_event->>'id')::uuid;
  v_id uuid:=(v_data->>'id')::uuid;
  v_user uuid:=auth.uid();
  v_label text;
  v_existing jsonb;
  v_actor uuid;
  v_customer public.customers%rowtype;
  v_limit numeric;
  v_legacy boolean:=v_kind='customer.created' and v_data->>'modifiedBy' is null;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing customer identifier'; end if;
  if not v_legacy and (v_data->>'modifiedBy')::uuid is distinct from v_user then raise exception 'Audit identity must match the signed-in user'; end if;
  perform 1 from public.shops where id=p_shop for update;
  select payload,actor_id into v_existing,v_actor from public.ledger_events where shop_id=p_shop and id=v_event;
  if found then
    if v_existing<>p_event or v_actor<>v_user then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),email,id::text) into v_label from auth.users where id=v_user;
  select * into v_customer from public.customers where shop_id=p_shop and id=v_id for update;
  if v_kind='customer.created' then
    if found then raise exception 'Customer ID already exists'; end if;
  else
    if not found then raise exception 'Customer not found'; end if;
    if (v_data->>'baseVersion')::integer is distinct from v_customer.version then raise exception 'Customer changed elsewhere. Review the latest version.' using errcode='40001'; end if;
  end if;
  if v_kind in ('customer.created','customer.updated') then
    if jsonb_typeof(v_data->'name') is distinct from 'string' or length(btrim(v_data->>'name')) not between 1 and 160 then raise exception 'Enter a full name (up to 160 characters)'; end if;
    if jsonb_typeof(coalesce(v_data->'phone','""'::jsonb)) is distinct from 'string' or length(btrim(coalesce(v_data->>'phone',''))) > 40 or
      (not v_legacy and length(btrim(coalesce(v_data->>'phone','')))=0) then raise exception 'Enter a phone number (up to 40 characters)'; end if;
    if jsonb_typeof(coalesce(v_data->'address','""'::jsonb)) is distinct from 'string' or length(btrim(coalesce(v_data->>'address','')))>500 then raise exception 'Address must be up to 500 characters'; end if;
    if jsonb_typeof(coalesce(v_data->'creditLimit','0'::jsonb)) is distinct from 'number' then raise exception 'Credit limit must be a number'; end if;
    v_limit:=coalesce((v_data->>'creditLimit')::numeric,0);
    if v_limit<0 or v_limit>100000000000 or v_limit<>trunc(v_limit) then raise exception 'Credit limit must be non-negative integer kobo'; end if;
    if v_kind='customer.created' then
      insert into public.customers(shop_id,id,name,phone,address,credit_limit,created_at,created_by,created_by_label,modified_by,modified_by_label,modified_at,last_event_id)
      values(p_shop,v_id,btrim(v_data->>'name'),btrim(coalesce(v_data->>'phone','')),btrim(coalesce(v_data->>'address','')),v_limit::bigint,
        now(),v_user,v_label,v_user,v_label,now(),v_event);
    else
      if v_customer.archived then raise exception 'Restore this customer before editing'; end if;
      update public.customers set name=btrim(v_data->>'name'),phone=btrim(v_data->>'phone'),address=btrim(coalesce(v_data->>'address','')),credit_limit=v_limit::bigint,
        modified_by=v_user,modified_by_label=v_label,modified_at=now(),version=version+1,last_event_id=v_event where shop_id=p_shop and id=v_id;
    end if;
  elsif v_kind in ('customer.archived','customer.restored') then
    if v_customer.archived=(v_kind='customer.archived') then raise exception 'Customer is already in that state'; end if;
    update public.customers set archived=(v_kind='customer.archived'),modified_by=v_user,modified_by_label=v_label,
      modified_at=now(),version=version+1,last_event_id=v_event where shop_id=p_shop and id=v_id;
  else raise exception 'Unknown customer operation'; end if;
  insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,v_event,v_user,p_event);
end;
$$;
revoke all on function public.apply_customer_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_customer_event(uuid,jsonb) to authenticated;

create or replace function public.apply_ledger_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_data jsonb := p_event -> 'data';
  v_kind text := p_event ->> 'kind';
  v_event uuid := (p_event ->> 'id')::uuid;
  v_id uuid := (v_data ->> 'id')::uuid;
  v_customer uuid;
  v_amount bigint;
  v_alloc jsonb;
  v_job public.jobs%rowtype;
  v_paid bigint;
  v_sum bigint := 0;
  v_existing jsonb;
  v_actor uuid;
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if v_event is null or v_id is null then raise exception 'Missing identifier'; end if;
  -- Keep older clients and pending customer events compatible; job/payment code below is unchanged.
  if v_kind like 'customer.%' then
    perform public.apply_customer_event(p_shop,p_event);
    return;
  end if;
  -- Serialize writes within a business. No concurrent payment can overpay a job.
  perform 1 from public.shops where id = p_shop for update;
  select payload, actor_id into v_existing, v_actor from public.ledger_events where shop_id = p_shop and id = v_event;
  if found then
    if v_existing <> p_event or v_actor <> auth.uid() then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  if v_kind = 'customer.created' then
    insert into public.customers(shop_id, id, name, phone, created_at)
    values(p_shop, v_id, v_data ->> 'name', coalesce(v_data ->> 'phone', ''), (v_data ->> 'createdAt')::timestamptz);
  elsif v_kind = 'job.created' then
    if (v_data ->> 'amount') !~ '^[0-9]+$' then raise exception 'Amount must be integer kobo'; end if;
    insert into public.jobs(shop_id, id, customer_id, service, description, amount, created_at)
    values(p_shop, v_id, (v_data ->> 'customerId')::uuid, v_data ->> 'service', v_data ->> 'description',
      (v_data ->> 'amount')::bigint, (v_data ->> 'createdAt')::timestamptz);
  elsif v_kind = 'payment.recorded' then
    if (v_data ->> 'amount') !~ '^[0-9]+$' then raise exception 'Amount must be integer kobo'; end if;
    v_amount := (v_data ->> 'amount')::bigint;
    v_customer := (v_data ->> 'customerId')::uuid;
    if jsonb_typeof(v_data -> 'allocations') is distinct from 'array' then raise exception 'Allocations must be an array'; end if;
    if jsonb_array_length(v_data -> 'allocations') = 0 then raise exception 'Allocate payment to at least one job'; end if;
    insert into public.payments(shop_id, id, customer_id, amount, method, paid_on, reference, created_at)
    values(p_shop, v_id, v_customer, v_amount, v_data ->> 'method', (v_data ->> 'paidOn')::date,
      coalesce(v_data ->> 'reference', ''), (v_data ->> 'createdAt')::timestamptz);
    for v_alloc in select value from jsonb_array_elements(v_data -> 'allocations') loop
      if (v_alloc ->> 'amount') !~ '^[0-9]+$' then raise exception 'Allocation must be integer kobo'; end if;
      select * into v_job from public.jobs where shop_id = p_shop and id = (v_alloc ->> 'jobId')::uuid;
      if not found or v_job.customer_id <> v_customer then raise exception 'Allocation job belongs to a different customer or business'; end if;
      select coalesce(sum(amount), 0) into v_paid from public.payment_allocations where shop_id = p_shop and job_id = v_job.id;
      if (v_alloc ->> 'amount')::bigint > v_job.amount - v_paid then raise exception 'Allocation exceeds outstanding job balance'; end if;
      insert into public.payment_allocations(shop_id, payment_id, job_id, amount)
      values(p_shop, v_id, v_job.id, (v_alloc ->> 'amount')::bigint);
      v_sum := v_sum + (v_alloc ->> 'amount')::bigint;
    end loop;
    if v_sum <> v_amount then raise exception 'Allocated amounts must equal payment total'; end if;
  else raise exception 'Unknown operation';
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values(p_shop, v_event, auth.uid(), p_event);
end;
$$;
revoke all on function public.apply_ledger_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_ledger_event(uuid, jsonb) to authenticated;

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
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'address', address, 'creditLimit', credit_limit, 'archived', archived, 'version', version, 'createdAt', created_at, 'createdBy', created_by, 'createdByLabel', created_by_label, 'modifiedBy', modified_by, 'modifiedByLabel', modified_by_label, 'modifiedAt', modified_at, 'lastEventId', last_event_id) order by created_at, id), '[]'::jsonb) from public.customers where shop_id = p_shop),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'customerId', customer_id, 'service', service, 'description', description, 'amount', amount, 'createdAt', created_at) order by created_at, id), '[]'::jsonb) from public.jobs where shop_id = p_shop),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'customerId', p.customer_id, 'amount', p.amount, 'method', p.method, 'paidOn', p.paid_on, 'reference', p.reference, 'createdAt', p.created_at,
      'allocations', (select jsonb_agg(jsonb_build_object('jobId', a.job_id, 'amount', a.amount) order by a.job_id) from public.payment_allocations a where a.shop_id = p_shop and a.payment_id = p.id)) order by p.created_at, p.id), '[]'::jsonb) from public.payments p where p.shop_id = p_shop)
  );
end;
$$;
commit;
