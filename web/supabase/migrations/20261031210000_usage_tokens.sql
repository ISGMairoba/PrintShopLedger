-- Developer console, part 8: usage in tokens.
-- Every operation a business records (a sale, a job moving stage, a new customer, an expense…) is
-- already kept as one row in ledger_events. Usage is worked out from those rows when the console
-- asks for it, so recording work costs nothing extra. Each kind of operation is worth a number of
-- tokens, set in the console; a plan can say how many tokens a month it includes (shown, not enforced).

create table if not exists public.usage_weights (
  pattern text primary key check (pattern ~ '^[a-z_]+(\.[a-z_]+|\.\*)$'),
  category text not null check (length(btrim(category)) between 1 and 40),
  tokens integer not null check (tokens between 0 and 1000)
);
alter table public.usage_weights enable row level security;
revoke all on public.usage_weights from public, anon, authenticated;
insert into public.usage_weights (pattern, category, tokens) values
  ('checkout.completed', 'Sales', 5),
  ('quotation.*', 'Quotations', 2),
  ('job.*', 'Jobs', 1),
  ('material.job_used', 'Jobs', 1),
  ('customer.*', 'Customers', 1),
  ('expense.*', 'Expenses', 2),
  ('service.*', 'Catalogue', 1),
  ('material.*', 'Stock', 1),
  ('sale.*', 'Corrections', 3),
  ('payment.*', 'Corrections', 3),
  ('account.*', 'Accounts', 1),
  ('payee.*', 'Accounts', 1)
on conflict (pattern) do nothing;

alter table public.plans add column if not exists monthly_tokens integer check (monthly_tokens is null or monthly_tokens between 1 and 100000000);

-- Usage counts look at recent rows of one business.
create index if not exists ledger_events_shop_received on public.ledger_events(shop_id, received_at);

-- The weight of one kind of operation: its exact entry, else its group's (job.*), else 1 token.
create or replace function private.usage_weight(p_kind text, out category text, out tokens integer)
language sql stable security definer set search_path to '' as $f$
  select coalesce(w.category, 'Other'), coalesce(w.tokens, 1)
  from (select 1) one
  left join lateral (select u.category, u.tokens from public.usage_weights u
    where u.pattern = p_kind or u.pattern = split_part(p_kind, '.', 1) || '.*'
    order by (u.pattern = p_kind) desc limit 1) w on true
$f$;

-- Console: one business's usage between two days (Lagos time), with the plan's monthly tokens.
create or replace function public.console_usage(p_shop uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare result jsonb;
begin
  perform private.require_console();
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Choose up to 400 days.'; end if;
  with ops as (
    select e.payload->>'kind' as kind, (e.received_at at time zone 'Africa/Lagos')::date as dd
    from public.ledger_events e
    where e.shop_id = p_shop
      and e.received_at >= (p_from::timestamp at time zone 'Africa/Lagos')
      and e.received_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
  ), kinds as (
    select k.kind, w.category, w.tokens, k.n
    from (select kind, count(*) as n from ops group by kind) k
    cross join lateral private.usage_weight(k.kind) w
  ), days as (
    select x.dd, sum(w.tokens * x.n) as tokens, sum(x.n) as n
    from (select dd, kind, count(*) as n from ops group by dd, kind) x
    cross join lateral private.usage_weight(x.kind) w
    group by x.dd
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'tokens', coalesce((select sum(tokens * n) from kinds), 0),
    'operations', coalesce((select sum(n) from kinds), 0),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', c.category, 'tokens', c.tokens, 'operations', c.n) order by c.tokens desc)
        from (select category, sum(tokens * n) as tokens, sum(n) as n from kinds group by category) c), '[]'::jsonb),
    'byKind', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'category', k.category, 'each', k.tokens, 'operations', k.n, 'tokens', k.tokens * k.n) order by k.tokens * k.n desc)
        from kinds k), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.dd, 'tokens', d.tokens, 'operations', d.n) order by d.dd) from days d), '[]'::jsonb),
    'monthlyTokens', (select p.monthly_tokens from public.subscriptions s join public.plans p on p.id = s.plan_id where s.shop_id = p_shop))
  into result;
  return result;
end $f$;

-- Console: token values.
create or replace function public.console_usage_weights() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('pattern', pattern, 'category', category, 'tokens', tokens) order by category, pattern)
    from public.usage_weights), '[]'::jsonb);
end $f$;
create or replace function public.console_save_usage_weights(p_weights jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console(true);
  if jsonb_typeof(p_weights) <> 'array' or jsonb_array_length(p_weights) > 200 then raise exception 'Invalid token values.'; end if;
  delete from public.usage_weights;
  insert into public.usage_weights (pattern, category, tokens)
  select lower(btrim(x->>'pattern')), btrim(x->>'category'), (x->>'tokens')::integer from jsonb_array_elements(p_weights) x;
  perform private.console_log(null, 'usage_weights.saved', jsonb_build_object('count', jsonb_array_length(p_weights)));
end $f$;

-- Plans carry their monthly tokens.
create or replace function public.console_plans() returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  perform private.require_console();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'price', p.price, 'periodDays', p.period_days,
      'maxDevices', p.max_devices, 'monthlyTokens', p.monthly_tokens, 'description', p.description, 'archived', p.archived,
      'businesses', (select count(*) from public.subscriptions s where s.plan_id = p.id)) order by p.archived, p.price, p.name)
    from public.plans p), '[]'::jsonb);
end $f$;
create or replace function public.console_save_plan(p_plan jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  perform private.require_console();
  insert into public.plans (id, name, price, period_days, max_devices, monthly_tokens, description, archived)
  values (p_plan->>'id', btrim(p_plan->>'name'), (p_plan->>'price')::bigint, (p_plan->>'periodDays')::integer,
    nullif(p_plan->>'maxDevices', '')::integer, nullif(p_plan->>'monthlyTokens', '')::integer,
    coalesce(p_plan->>'description', ''), coalesce((p_plan->>'archived')::boolean, false))
  on conflict (id) do update set name = excluded.name, price = excluded.price, period_days = excluded.period_days,
    max_devices = excluded.max_devices, monthly_tokens = excluded.monthly_tokens, description = excluded.description,
    archived = excluded.archived;
  perform private.console_log(null, 'plan.saved', p_plan);
end $f$;

-- The business list shows tokens used in the last 30 days.
do $mig$
declare src text;
  a text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),$x$;
  b text := $x$'lastActivity', (select max(e.received_at) from public.ledger_events e where e.shop_id = s.id),
      'tokens30', (select coalesce(sum(w.tokens * k.n), 0)
                   from (select e.payload->>'kind' as kind, count(*) as n from public.ledger_events e
                         where e.shop_id = s.id and e.received_at > now() - interval '30 days' group by 1) k
                   cross join lateral private.usage_weight(k.kind) w),$x$;
begin
  src := pg_get_functiondef('public.console_businesses()'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'console_businesses changed; review the usage migration'; end if;
  execute replace(src, a, b);
end $mig$;

revoke all on function private.usage_weight(text) from public, anon, authenticated;
revoke all on function public.console_usage(uuid,date,date), public.console_usage_weights(), public.console_save_usage_weights(jsonb) from public, anon;
grant execute on function public.console_usage(uuid,date,date), public.console_usage_weights(), public.console_save_usage_weights(jsonb) to authenticated;
