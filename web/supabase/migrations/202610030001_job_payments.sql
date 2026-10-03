-- PrintShopLedger v0.1. All writes go through an atomic, idempotent RPC.
begin;
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  currency text not null default 'NGN' check (currency = 'NGN'),
  created_at timestamptz not null default now()
);
create table public.shop_members (
  shop_id uuid not null references public.shops(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('admin', 'manager', 'cashier')),
  primary key (shop_id, user_id)
);
create index shop_members_user on public.shop_members(user_id);
create table public.customers (
  shop_id uuid not null references public.shops(id), id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  phone text not null default '' check (length(phone) <= 40),
  created_at timestamptz not null, primary key (shop_id, id)
);
create table public.jobs (
  shop_id uuid not null, id uuid not null, customer_id uuid not null,
  service text not null check (length(btrim(service)) between 1 and 160),
  description text not null check (length(btrim(description)) between 1 and 500),
  amount bigint not null check (amount between 1 and 100000000000),
  created_at timestamptz not null, primary key (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id)
);
create index jobs_customer on public.jobs(shop_id, customer_id);
create table public.payments (
  shop_id uuid not null, id uuid not null, customer_id uuid not null,
  amount bigint not null check (amount between 1 and 100000000000),
  method text not null check (method in ('Cash', 'POS', 'Transfer')),
  paid_on date not null, reference text not null default '' check (length(reference) <= 200),
  created_at timestamptz not null, primary key (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id)
);
create table public.payment_allocations (
  shop_id uuid not null, payment_id uuid not null, job_id uuid not null,
  amount bigint not null check (amount > 0), primary key (shop_id, payment_id, job_id),
  foreign key (shop_id, payment_id) references public.payments(shop_id, id),
  foreign key (shop_id, job_id) references public.jobs(shop_id, id)
);
create index allocations_job on public.payment_allocations(shop_id, job_id);
create table public.ledger_events (
  shop_id uuid not null references public.shops(id), id uuid not null,
  actor_id uuid not null references auth.users(id), payload jsonb not null,
  received_at timestamptz not null default now(), primary key (shop_id, id)
);

create function public.is_shop_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid());
$$;
revoke all on function public.is_shop_member(uuid) from public, anon;
grant execute on function public.is_shop_member(uuid) to authenticated;

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.ledger_events enable row level security;
revoke all on public.shops, public.shop_members, public.customers, public.jobs,
  public.payments, public.payment_allocations, public.ledger_events from anon, authenticated;
grant select on public.shops, public.shop_members, public.customers, public.jobs,
  public.payments, public.payment_allocations, public.ledger_events to authenticated;
create policy member_read on public.shops for select to authenticated using (public.is_shop_member(id));
create policy own_memberships on public.shop_members for select to authenticated using (user_id = auth.uid());
create policy member_read on public.customers for select to authenticated using (public.is_shop_member(shop_id));
create policy member_read on public.jobs for select to authenticated using (public.is_shop_member(shop_id));
create policy member_read on public.payments for select to authenticated using (public.is_shop_member(shop_id));
create policy member_read on public.payment_allocations for select to authenticated using (public.is_shop_member(shop_id));
create policy member_read on public.ledger_events for select to authenticated using (public.is_shop_member(shop_id));

create function public.list_my_shops() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'role', m.role) order by s.created_at), '[]'::jsonb)
  from public.shops s join public.shop_members m on m.shop_id = s.id where m.user_id = auth.uid();
$$;
revoke all on function public.list_my_shops() from public, anon;
grant execute on function public.list_my_shops() to authenticated;

create function public.create_shop(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_shop uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.shops(name) values (btrim(p_name)) returning id into v_shop;
  insert into public.shop_members(shop_id, user_id, role) values (v_shop, auth.uid(), 'admin');
  return v_shop;
end;
$$;
revoke all on function public.create_shop(text) from public, anon;
grant execute on function public.create_shop(text) to authenticated;

create function public.apply_ledger_event(p_shop uuid, p_event jsonb) returns void
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

create function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  return jsonb_build_object(
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'createdAt', created_at) order by created_at, id), '[]'::jsonb) from public.customers where shop_id = p_shop),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'customerId', customer_id, 'service', service, 'description', description, 'amount', amount, 'createdAt', created_at) order by created_at, id), '[]'::jsonb) from public.jobs where shop_id = p_shop),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'customerId', p.customer_id, 'amount', p.amount, 'method', p.method, 'paidOn', p.paid_on, 'reference', p.reference, 'createdAt', p.created_at,
      'allocations', (select jsonb_agg(jsonb_build_object('jobId', a.job_id, 'amount', a.amount) order by a.job_id) from public.payment_allocations a where a.shop_id = p_shop and a.payment_id = p.id)) order by p.created_at, p.id), '[]'::jsonb) from public.payments p where p.shop_id = p_shop)
  );
end;
$$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
commit;
