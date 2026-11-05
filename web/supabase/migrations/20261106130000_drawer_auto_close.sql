-- Drawers left open overnight are closed automatically, "not counted", for an Admin to review.
-- * Every night at 04:00 Lagos, for businesses with Business Settings → Jobs & payments → "Close
--   drawers left open overnight" on (the default), each staff member's sales, refunds and payment
--   corrections from before today that no handover has closed go into one closing: expected cash
--   worked out as at a handover, counted cash left empty. Staff still selling in the last 3 hours are
--   left for the next night.
-- * The closing has no receiver (to_user is the staff member), so their next handover starts at zero.
-- * review_drawer_closing: an Admin or above enters the cash actually found (or leaves it empty) and
--   the closing is marked "Reviewed by …".

-- A handover goes to someone else; only an automatic closing has no receiver (to_user = from_user).
alter table public.drawer_closings drop constraint if exists drawer_closings_check;
alter table public.drawer_closings add constraint drawer_closings_check
  check (from_user <> to_user or coalesce((data->>'autoClosed')::boolean, false));

create or replace function private.auto_close_drawer(p_shop uuid, p_actor uuid, p_cutoff timestamptz) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare actor public.shop_members%rowtype; ids uuid[]; refund_ids uuid[]; opening public.drawer_closings%rowtype; last_closed timestamptz;
  cash bigint; collected bigint; pos bigint; transfer bigint; wallet bigint; sales bigint; opening_cash bigint; cash_refunded bigint; total_refunded bigint;
  cash_correction bigint; result jsonb; cid uuid := gen_random_uuid(); at_time timestamptz; v_branch text;
begin
  select * into actor from public.shop_members where shop_id = p_shop and user_id = p_actor;
  if not found then return null; end if;
  select coalesce(array_agg(id order by id), '{}') into ids from public.checkout_records
   where shop_id = p_shop and (data->>'createdBy')::uuid = p_actor and drawer_closing_id is null and (data->>'createdAt')::timestamptz < p_cutoff;
  select coalesce(array_agg(id order by id), '{}'),
         coalesce(sum((data->>'refundAmount')::bigint) filter (where data->>'action' = 'sale.refunded' and data->>'method' = 'Cash'), 0),
         coalesce(sum((data->>'refundAmount')::bigint), 0)
    into refund_ids, cash_refunded, total_refunded from public.sale_adjustments
   where shop_id = p_shop and drawer_closing_id is null and (data->>'changedAt')::timestamptz < p_cutoff
     and ((actor_id = p_actor and data->>'action' = 'sale.refunded') or (data->>'action' = 'payment.corrected' and (data->>'drawerActor')::uuid = p_actor));
  if cardinality(ids) = 0 and cardinality(refund_ids) = 0 then return null; end if;
  select max(closed_at) into last_closed from public.drawer_closings where shop_id = p_shop and from_user = p_actor;
  select * into opening from public.drawer_closings where shop_id = p_shop and to_user = p_actor and from_user <> p_actor
     and (last_closed is null or closed_at > last_closed) order by closed_at desc, id desc limit 1;
  opening_cash := coalesce((opening.data->>'countedCash')::bigint, 0);
  select coalesce(sum((data->>'cashReceived')::bigint) filter (where data->>'method' = 'Cash'), 0), coalesce(sum((data->>'cashReceived')::bigint), 0),
         coalesce(sum((data->>'cashReceived')::bigint) filter (where data->>'method' = 'POS'), 0), coalesce(sum((data->>'cashReceived')::bigint) filter (where data->>'method' = 'Transfer'), 0),
         coalesce(sum((data->>'walletUsed')::bigint), 0), coalesce(sum((data->>'total')::bigint), 0)
    into cash, collected, pos, transfer, wallet, sales from public.checkout_records where shop_id = p_shop and id = any(ids);
  select coalesce(sum((data->>'cashDelta')::bigint), 0),
         pos + coalesce(sum((data->'methodDeltas'->>'POS')::bigint), 0), transfer + coalesce(sum((data->'methodDeltas'->>'Transfer')::bigint), 0),
         collected + coalesce(sum(coalesce((data->'methodDeltas'->>'Cash')::bigint, 0) + coalesce((data->'methodDeltas'->>'POS')::bigint, 0) + coalesce((data->'methodDeltas'->>'Transfer')::bigint, 0)), 0)
    into cash_correction, pos, transfer, collected from public.sale_adjustments where shop_id = p_shop and id = any(refund_ids) and data->>'action' = 'payment.corrected';
  select branch_id into v_branch from public.checkout_records where shop_id = p_shop and id = any(ids) order by data->>'createdAt' desc limit 1;
  at_time := clock_timestamp();
  result := jsonb_build_object('id', cid, 'fromUserId', p_actor, 'fromUserLabel', actor.name, 'toUserId', p_actor, 'toUserLabel', 'Not handed over',
    'closedAt', at_time, 'checkoutIds', to_jsonb(ids), 'openingId', opening.id, 'openingCash', opening_cash, 'cashCollected', cash, 'totalCollected', collected,
    'posCollected', pos, 'transferCollected', transfer, 'walletUsed', wallet, 'jobSales', sales, 'refundIds', to_jsonb(refund_ids), 'cashCorrection', cash_correction,
    'cashRefunded', cash_refunded, 'totalRefunded', total_refunded, 'expectedCash', opening_cash + cash + cash_correction - cash_refunded,
    'countedCash', null, 'difference', null, 'note', 'Closed automatically, not counted', 'autoClosed', true, 'reviewStatus', 'pending', 'coversUntil', p_cutoff);
  insert into public.drawer_closings(shop_id, id, from_user, to_user, closed_at, data, branch_id) values (p_shop, cid, p_actor, p_actor, at_time, result, v_branch);
  update public.checkout_records set drawer_closing_id = cid where shop_id = p_shop and id = any(ids);
  update public.sale_adjustments set drawer_closing_id = cid where shop_id = p_shop and id = any(refund_ids);
  return result;
end $f$;

create or replace function private.auto_close_drawers(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path to '' as $f$
declare cutoff timestamptz := (date_trunc('day', p_now at time zone 'Africa/Lagos')) at time zone 'Africa/Lagos'; s record; a uuid; n integer := 0;
begin
  for s in select b.shop_id from public.business_settings b where coalesce(b.settings->'drawers'->>'autoClose', 'true') <> 'false' order by b.shop_id loop
    perform 1 from public.shops where id = s.shop_id for update;
    for a in
      select distinct actor from (
        select (data->>'createdBy')::uuid actor from public.checkout_records
         where shop_id = s.shop_id and drawer_closing_id is null and (data->>'createdAt')::timestamptz < cutoff
        union
        select case when data->>'action' = 'payment.corrected' then (data->>'drawerActor')::uuid else actor_id end from public.sale_adjustments
         where shop_id = s.shop_id and drawer_closing_id is null and data->>'action' in ('sale.refunded', 'payment.corrected') and (data->>'changedAt')::timestamptz < cutoff
      ) x where actor is not null
    loop
      -- Still selling (a sale in the last 3 hours): leave the drawer for its handover or the next night.
      continue when exists (select 1 from public.checkout_records where shop_id = s.shop_id and drawer_closing_id is null
                              and (data->>'createdBy')::uuid = a and (data->>'createdAt')::timestamptz > p_now - interval '3 hours');
      if private.auto_close_drawer(s.shop_id, a, cutoff) is not null then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $f$;

create or replace function public.review_drawer_closing(p_shop uuid, p_id uuid, p_counted bigint, p_note text) returns jsonb
language plpgsql security definer set search_path to '' as $f$
declare u uuid := auth.uid(); c public.drawer_closings%rowtype; label text;
begin
  if u is null or not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = u and not archived and access_level >= 2) then
    raise exception 'Admin access required to review a drawer' using errcode = '42501';
  end if;
  if p_counted is not null and (p_counted < 0 or p_counted > 100000000000) then raise exception 'Enter the cash counted'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Keep the note to 500 characters'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select * into c from public.drawer_closings where shop_id = p_shop and id = p_id for update;
  if not found then raise exception 'Drawer closing not found' using errcode = 'P0002'; end if;
  if not coalesce((c.data->>'autoClosed')::boolean, false) then raise exception 'Only drawers closed automatically need a review'; end if;
  if c.data->>'reviewStatus' = 'reviewed' then return c.data; end if;
  select coalesce(nullif(btrim(m.name), ''), au.email, u::text) into label from public.shop_members m join auth.users au on au.id = m.user_id where m.shop_id = p_shop and m.user_id = u;
  c.data := c.data || jsonb_build_object('countedCash', p_counted, 'difference', case when p_counted is null then null else p_counted - (c.data->>'expectedCash')::bigint end,
    'reviewStatus', 'reviewed', 'reviewedBy', u, 'reviewedByLabel', label, 'reviewedAt', now(), 'reviewNote', btrim(coalesce(p_note, '')));
  update public.drawer_closings set data = c.data where shop_id = p_shop and id = p_id;
  return c.data;
end $f$;

revoke all on function private.auto_close_drawer(uuid, uuid, timestamptz), private.auto_close_drawers(timestamptz) from public, anon, authenticated;
revoke all on function public.review_drawer_closing(uuid, uuid, bigint, text) from public, anon;
grant execute on function public.review_drawer_closing(uuid, uuid, bigint, text) to authenticated;

-- The setting lives on the Jobs & payments tab.
do $patch$
declare d text := pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure); pat text := $$('Jobs & payments','jobs'),$$;
begin
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'settings_tab_keys pattern not found exactly once'; end if;
  execute replace(d, pat, pat || $$('Jobs & payments','drawers'),$$);
end $patch$;

select cron.unschedule('auto-close-drawers') where exists (select 1 from cron.job where jobname = 'auto-close-drawers');
select cron.schedule('auto-close-drawers', '0 3 * * *', 'select private.auto_close_drawers()');
