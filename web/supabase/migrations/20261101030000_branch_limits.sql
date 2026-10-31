-- Branches, phase 5: branch limits and usage per branch in the console (plan: project doc plans/branches.md).
-- * A plan says the most branches a business may have open (empty = no limit); a subscription can
--   set its own. Opening more branches than allowed is refused when the settings are saved.
-- * The console's Usage shows tokens per branch.

alter table public.plans add column if not exists max_branches integer check (max_branches is null or max_branches between 1 and 1000);
alter table public.subscriptions add column if not exists max_branches integer check (max_branches is null or max_branches between 1 and 1000);

-- Saving business settings: no more open branches than the subscription allows (only checked when
-- the number of open branches goes up, so a business above a lowered limit can still save other settings).
create or replace function private.check_branch_limit() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare open_now integer; open_before integer := 0; lim integer;
begin
  select count(*) into open_now from jsonb_array_elements(coalesce(new.settings->'branches', '[]'::jsonb)) b
    where not coalesce((b->>'archived')::boolean, false);
  open_now := greatest(open_now, 1);
  if tg_op = 'UPDATE' then
    select count(*) into open_before from jsonb_array_elements(coalesce(old.settings->'branches', '[]'::jsonb)) b
      where not coalesce((b->>'archived')::boolean, false);
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
drop trigger if exists check_branch_limit on public.business_settings;
create trigger check_branch_limit before insert or update of settings on public.business_settings
  for each row execute function private.check_branch_limit();

-- Console functions carry the branch limit, and usage per branch.
do $mig$
declare
  fixes text[][] := array[
    array['public.console_plans()', $x$'maxDevices', p.max_devices,$x$, $x$'maxDevices', p.max_devices, 'maxBranches', p.max_branches,$x$],
    array['public.console_save_plan(jsonb)', $x$max_devices, monthly_tokens, description, archived)$x$, $x$max_devices, max_branches, monthly_tokens, description, archived)$x$],
    array['public.console_save_plan(jsonb)', $x$nullif(p_plan->>'maxDevices', '')::integer, nullif(p_plan->>'monthlyTokens', '')::integer,$x$, $x$nullif(p_plan->>'maxDevices', '')::integer, nullif(p_plan->>'maxBranches', '')::integer, nullif(p_plan->>'monthlyTokens', '')::integer,$x$],
    array['public.console_save_plan(jsonb)', $x$max_devices = excluded.max_devices, monthly_tokens$x$, $x$max_devices = excluded.max_devices, max_branches = excluded.max_branches, monthly_tokens$x$],
    array['public.console_subscription(uuid)', $x$'maxDevices', s.max_devices,$x$, $x$'maxDevices', s.max_devices, 'maxBranches', s.max_branches,$x$],
    array['public.console_save_subscription(uuid,jsonb)', $x$max_devices, updated_by, updated_at)$x$, $x$max_devices, max_branches, updated_by, updated_at)$x$],
    array['public.console_save_subscription(uuid,jsonb)', $x$nullif(p_sub->>'maxDevices', '')::integer, auth.uid(), now())$x$, $x$nullif(p_sub->>'maxDevices', '')::integer, nullif(p_sub->>'maxBranches', '')::integer, auth.uid(), now())$x$],
    array['public.console_save_subscription(uuid,jsonb)', $x$max_devices = excluded.max_devices,$x$, $x$max_devices = excluded.max_devices, max_branches = excluded.max_branches,$x$],
    array['public.console_usage(uuid,date,date)', $x$'monthlyTokens', (select$x$, $x$'byBranch', coalesce((select jsonb_agg(jsonb_build_object('branch', x.b, 'name', coalesce((select br->>'name' from public.business_settings bs
        cross join lateral jsonb_array_elements(coalesce(bs.settings->'branches', '[]'::jsonb)) br where bs.shop_id = p_shop and br->>'id' = x.b), 'Main branch'),
        'tokens', x.t, 'operations', x.n) order by x.t desc)
      from (select k.b, sum(w.tokens * k.n) as t, sum(k.n) as n
            from (select coalesce(e2.branch_id, 'main') as b, e2.payload->>'kind' as kind, count(*) as n from public.ledger_events e2
                  where e2.shop_id = p_shop and e2.received_at >= (p_from::timestamp at time zone 'Africa/Lagos')
                    and e2.received_at < ((p_to + 1)::timestamp at time zone 'Africa/Lagos') group by 1, 2) k
            cross join lateral private.usage_weight(k.kind) w
            group by k.b) x), '[]'::jsonb),
    'monthlyTokens', (select$x$]
  ];
  fx text[]; fn text; src text; cur text := ''; pending text := '';
  i integer;
begin
  for i in 1 .. array_length(fixes, 1) loop
    fn := fixes[i][1];
    if fn <> cur then
      if cur <> '' then execute pending; end if;
      cur := fn; pending := pg_get_functiondef(fn::regprocedure);
    end if;
    if (length(pending) - length(replace(pending, fixes[i][2], ''))) / length(fixes[i][2]) <> 1 then
      raise exception '% changed (%); review the branch limits migration', fn, left(fixes[i][2], 40);
    end if;
    pending := replace(pending, fixes[i][2], fixes[i][3]);
  end loop;
  execute pending;
end $mig$;

revoke all on function private.check_branch_limit() from public, anon, authenticated;
