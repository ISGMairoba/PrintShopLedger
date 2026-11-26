-- AUD-10 stage 2 (plans/audit-2-overnight.md): the last server rules that read business-wide settings
-- now read the branch's own (Business Settings → Branches → a branch's own settings):
--   * the overnight drawer closing: each branch's own "close drawers left open" (drawers.autoClose)
--   * pricing templates at a sale: the branch's own templates (pricing)
--   * "collect only what is paid for" at a handover: the branch's own rule (options.handoverPayment)
-- The main branch and businesses without branches use the business-wide settings, as before.
-- Each part is replaced only where found as expected (patterns allow CR LF); otherwise nothing changes.

-- Overnight: every business, each drawer at a branch whose own setting closes drawers (default yes).
create or replace function private.auto_close_drawers(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path to '' as $f$
declare cutoff timestamptz := (date_trunc('day', p_now at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos'; s record; d record; n integer := 0;
begin
  for s in select b.shop_id from public.business_settings b order by b.shop_id loop
    perform 1 from public.shops where id = s.shop_id for update;
    for d in
      select distinct actor, branch from (
        select (data->>'createdBy')::uuid actor, coalesce(branch_id, 'main') branch from public.checkout_records
         where shop_id = s.shop_id and drawer_closing_id is null and (data->>'createdAt')::timestamptz < cutoff
        union
        select case when data->>'action' = 'payment.corrected' then (data->>'drawerActor')::uuid else actor_id end, coalesce(branch_id, 'main')
          from public.sale_adjustments
         where shop_id = s.shop_id and drawer_closing_id is null and data->>'action' in ('sale.refunded', 'payment.corrected') and (data->>'changedAt')::timestamptz < cutoff
      ) x where actor is not null order by actor, branch
    loop
      -- The branch's own choice (its Jobs & payments → drawers), else the business's.
      continue when coalesce(private.branch_settings(s.shop_id, d.branch)->'drawers'->>'autoClose', 'true') = 'false';
      -- Still selling at this branch (a sale in the last 3 hours): leave that drawer for its handover or the next night.
      continue when exists (select 1 from public.checkout_records where shop_id = s.shop_id and drawer_closing_id is null
                              and (data->>'createdBy')::uuid = d.actor and coalesce(branch_id, 'main') = d.branch
                              and (data->>'createdAt')::timestamptz > p_now - interval '3 hours');
      if private.auto_close_drawer(s.shop_id, d.actor, cutoff, d.branch) is not null then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $f$;
revoke all on function private.auto_close_drawers(timestamptz) from public, anon, authenticated;

do $patch$
declare d text; n text;
begin
  d := pg_get_functiondef('private.price_template_snapshot(uuid,jsonb,numeric,boolean)'::regprocedure);
  n := regexp_replace(d, 'select settings->''pricing'' into pricing from public\.business_settings where shop_id=p_shop;',
    'pricing := private.branch_settings(p_shop, private.request_branch(p_shop))->''pricing'';');
  if n = d then raise exception 'price_template_snapshot pattern not found'; end if;
  execute n;

  d := pg_get_functiondef('private.apply_job_handover_event_core(uuid,jsonb)'::regprocedure);
  n := regexp_replace(d, 'select b\.settings->''options''->>''handoverPayment'' into rule from public\.business_settings b where b\.shop_id = p_shop;',
    'rule := private.branch_settings(p_shop, private.request_branch(p_shop))->''options''->>''handoverPayment'';');
  if n = d then raise exception 'apply_job_handover_event_core pattern not found'; end if;
  execute n;
end $patch$;
