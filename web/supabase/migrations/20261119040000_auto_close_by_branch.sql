-- Overnight drawer closing, branch by branch (audit AUD-11). The closing at the end of the day
-- put everything a cashier sold, at every branch, into one closing marked with one branch. Now each
-- branch the cashier worked at gets its own closing: that branch's sales, refunds, corrections and
-- opening cash only, saved with the branch (like closing by hand, 20261118240000).
create or replace function private.auto_close_drawer(p_shop uuid, p_actor uuid, p_cutoff timestamptz, p_branch text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare actor public.shop_members%rowtype; ids uuid[]; refund_ids uuid[]; opening public.drawer_closings%rowtype; last_closed timestamptz;
  cash bigint; collected bigint; pos bigint; transfer bigint; wallet bigint; sales bigint; opening_cash bigint; cash_refunded bigint; total_refunded bigint;
  cash_correction bigint; result jsonb; cid uuid := gen_random_uuid(); at_time timestamptz; br text := coalesce(nullif(btrim(p_branch), ''), 'main');
begin
  select * into actor from public.shop_members where shop_id = p_shop and user_id = p_actor;
  if not found then return null; end if;
  select coalesce(array_agg(id order by id), '{}') into ids from public.checkout_records
   where shop_id = p_shop and (data->>'createdBy')::uuid = p_actor and drawer_closing_id is null and (data->>'createdAt')::timestamptz < p_cutoff
     and coalesce(branch_id, 'main') = br;
  select coalesce(array_agg(id order by id), '{}'),
         coalesce(sum((data->>'refundAmount')::bigint) filter (where data->>'action' = 'sale.refunded' and data->>'method' = 'Cash'), 0),
         coalesce(sum((data->>'refundAmount')::bigint), 0)
    into refund_ids, cash_refunded, total_refunded from public.sale_adjustments
   where shop_id = p_shop and drawer_closing_id is null and (data->>'changedAt')::timestamptz < p_cutoff
     and ((actor_id = p_actor and data->>'action' = 'sale.refunded') or (data->>'action' = 'payment.corrected' and (data->>'drawerActor')::uuid = p_actor))
     and coalesce(branch_id, 'main') = br;
  if cardinality(ids) = 0 and cardinality(refund_ids) = 0 then return null; end if;
  select max(closed_at) into last_closed from public.drawer_closings
   where shop_id = p_shop and from_user = p_actor and coalesce(branch_id, 'main') = br;
  select * into opening from public.drawer_closings where shop_id = p_shop and to_user = p_actor and from_user <> p_actor
     and coalesce(branch_id, 'main') = br and (last_closed is null or closed_at > last_closed) order by closed_at desc, id desc limit 1;
  opening_cash := coalesce((opening.data->>'countedCash')::bigint, 0);
  select coalesce(sum(private.checkout_method_amount(data,'Cash')), 0), coalesce(sum((data->>'cashReceived')::bigint), 0),
         coalesce(sum(private.checkout_method_amount(data,'POS')), 0), coalesce(sum(private.checkout_method_amount(data,'Transfer')), 0),
         coalesce(sum((data->>'walletUsed')::bigint), 0), coalesce(sum((data->>'total')::bigint), 0)
    into cash, collected, pos, transfer, wallet, sales from public.checkout_records where shop_id = p_shop and id = any(ids);
  select coalesce(sum((data->>'cashDelta')::bigint), 0),
         pos + coalesce(sum((data->'methodDeltas'->>'POS')::bigint), 0), transfer + coalesce(sum((data->'methodDeltas'->>'Transfer')::bigint), 0),
         collected + coalesce(sum(coalesce((data->'methodDeltas'->>'Cash')::bigint, 0) + coalesce((data->'methodDeltas'->>'POS')::bigint, 0) + coalesce((data->'methodDeltas'->>'Transfer')::bigint, 0)), 0)
    into cash_correction, pos, transfer, collected from public.sale_adjustments where shop_id = p_shop and id = any(refund_ids) and data->>'action' = 'payment.corrected';
  at_time := clock_timestamp();
  result := jsonb_build_object('id', cid, 'fromUserId', p_actor, 'fromUserLabel', actor.name, 'toUserId', p_actor, 'toUserLabel', 'Not handed over',
    'closedAt', at_time, 'checkoutIds', to_jsonb(ids), 'openingId', opening.id, 'openingCash', opening_cash, 'cashCollected', cash, 'totalCollected', collected,
    'posCollected', pos, 'transferCollected', transfer, 'walletUsed', wallet, 'jobSales', sales, 'refundIds', to_jsonb(refund_ids), 'cashCorrection', cash_correction,
    'cashRefunded', cash_refunded, 'totalRefunded', total_refunded, 'expectedCash', opening_cash + cash + cash_correction - cash_refunded,
    'countedCash', null, 'difference', null, 'note', 'Closed automatically, not counted', 'autoClosed', true, 'reviewStatus', 'pending', 'coversUntil', p_cutoff);
  insert into public.drawer_closings(shop_id, id, from_user, to_user, closed_at, data, branch_id)
    values (p_shop, cid, p_actor, p_actor, at_time, result, case when br = 'main' then null else br end);
  update public.checkout_records set drawer_closing_id = cid where shop_id = p_shop and id = any(ids);
  update public.sale_adjustments set drawer_closing_id = cid where shop_id = p_shop and id = any(refund_ids);
  return result;
end $function$;
revoke all on function private.auto_close_drawer(uuid, uuid, timestamptz, text) from public, anon, authenticated;

create or replace function private.auto_close_drawers(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path to '' as $function$
declare cutoff timestamptz := (date_trunc('day', p_now at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos'; s record; d record; n integer := 0;
begin
  for s in select b.shop_id from public.business_settings b where coalesce(b.settings->'drawers'->>'autoClose', 'true') <> 'false' order by b.shop_id loop
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
      -- Still selling at this branch (a sale in the last 3 hours): leave that drawer for its handover or the next night.
      continue when exists (select 1 from public.checkout_records where shop_id = s.shop_id and drawer_closing_id is null
                              and (data->>'createdBy')::uuid = d.actor and coalesce(branch_id, 'main') = d.branch
                              and (data->>'createdAt')::timestamptz > p_now - interval '3 hours');
      if private.auto_close_drawer(s.shop_id, d.actor, cutoff, d.branch) is not null then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $function$;
