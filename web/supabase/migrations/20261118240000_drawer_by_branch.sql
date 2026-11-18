-- Closing a drawer, branch by branch (plans/audit-1-review.md, AUD-11): someone who sells at two
-- branches closes each branch's drawer there. The sales, refunds, corrections and opening cash
-- counted are that branch's only, the branch is checked (open, and the cashier works there), and
-- the closing is saved with its branch in the same step. The close-drawer function passes the
-- device's branch (p_branch); a business without branches works as before.
create or replace function public.finish_drawer_handover(p_shop uuid, p_actor uuid, p_receiver uuid, p_id uuid,
  p_counted bigint, p_checkouts uuid[], p_opening uuid, p_note text, p_refunds uuid[], p_branch text)
returns jsonb language plpgsql set search_path to '' as $function$
declare actor public.shop_members%rowtype;receiver public.shop_members%rowtype;existing public.drawer_closings%rowtype;
 ids uuid[];refund_ids uuid[];cash_refunded bigint;total_refunded bigint;opening public.drawer_closings%rowtype;last_closed timestamptz;at_time timestamptz;
 cash_correction bigint;cash bigint;collected bigint;pos bigint;transfer bigint;wallet bigint;sales bigint;opening_cash bigint;result jsonb;
 st jsonb; acc jsonb; multi boolean; br text := coalesce(nullif(btrim(p_branch), ''), 'main');
begin
 if p_shop is null or p_actor is null or p_receiver is null or p_id is null or p_actor=p_receiver or p_counted is null or p_counted<0 or p_counted>100000000000 or p_checkouts is null or length(coalesce(p_note,''))>500 then raise exception 'Invalid drawer handover';end if;
 perform 1 from public.shops where id=p_shop for update;
 select * into actor from public.shop_members where shop_id=p_shop and user_id=p_actor and not archived and access_level>0 for share;
 if not found then raise exception 'Current user access is unavailable';end if;
 select * into receiver from public.shop_members where shop_id=p_shop and user_id=p_receiver and not archived and access_level>0 for share;
 if not found then raise exception 'Receiving user access is unavailable';end if;
 -- The branch: open, and the cashier works there (General Manager and Developer: anywhere).
 select settings into st from public.business_settings where shop_id=p_shop;
 multi := coalesce(jsonb_typeof(st->'branches')='array' and jsonb_array_length(st->'branches')>1, false);
 if not multi then br := 'main'; end if;
 if multi then
  acc := st->'branchAccess'->(p_actor::text);
  if br<>'main' and not exists (select 1 from jsonb_array_elements(st->'branches') b where b->>'id'=br and not coalesce((b->>'archived')::boolean,false)) then
   raise exception 'This branch is closed or does not exist.';
  end if;
  if actor.rank<4 and not coalesce(acc ? '*', false) and not (
     coalesce(acc ? br, false) or (br='main' and (jsonb_typeof(acc) is distinct from 'array' or jsonb_array_length(acc)=0))) then
   raise exception 'You do not work at this branch, so you cannot close its drawer.' using errcode='42501';
  end if;
 end if;
 select * into existing from public.drawer_closings where shop_id=p_shop and id=p_id;
 if found then
  if existing.from_user<>p_actor or existing.to_user<>p_receiver or (existing.data->>'countedCash')::bigint<>p_counted or existing.data->>'note'<>coalesce(p_note,'') or coalesce((existing.data->>'openingId')::uuid,'00000000-0000-0000-0000-000000000000')<>coalesce(p_opening,'00000000-0000-0000-0000-000000000000') or (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(existing.data->'checkoutIds')) is distinct from (select array_agg(x order by x) from unnest(p_checkouts) x) then raise exception 'Handover ID is already used';end if;
  if coalesce((select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(existing.data->'refundIds')),'{}'::uuid[]) is distinct from coalesce((select array_agg(x order by x) from unnest(p_refunds) x),'{}'::uuid[]) then raise exception 'Handover ID is already used';end if;
  return existing.data;
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from public.checkout_records where shop_id=p_shop and (data->>'createdBy')::uuid=p_actor and drawer_closing_id is null
   and (not multi or coalesce(branch_id,'main')=br);
 if ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_checkouts) x) then raise exception 'Your unclosed transactions changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 select max(closed_at) into last_closed from public.drawer_closings where shop_id=p_shop and from_user=p_actor and (not multi or coalesce(branch_id,'main')=br);
 select * into opening from public.drawer_closings where shop_id=p_shop and to_user=p_actor and (last_closed is null or closed_at>last_closed)
   and (not multi or coalesce(branch_id,'main')=br) order by closed_at desc,id desc limit 1;
 if opening.id is distinct from p_opening then raise exception 'Opening cash changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 opening_cash=coalesce((opening.data->>'countedCash')::bigint,0);
 select coalesce(sum(private.checkout_method_amount(data,'Cash')),0),coalesce(sum((data->>'cashReceived')::bigint),0),coalesce(sum(private.checkout_method_amount(data,'POS')),0),coalesce(sum(private.checkout_method_amount(data,'Transfer')),0),coalesce(sum((data->>'walletUsed')::bigint),0),coalesce(sum((data->>'total')::bigint),0)
 into cash,collected,pos,transfer,wallet,sales from public.checkout_records where shop_id=p_shop and id=any(ids);
 select coalesce(array_agg(id order by id),'{}'::uuid[]),coalesce(sum((data->>'refundAmount')::bigint) filter(where data->>'action'='sale.refunded' and data->>'method'='Cash'),0),coalesce(sum((data->>'refundAmount')::bigint),0) into refund_ids,cash_refunded,total_refunded from public.sale_adjustments where shop_id=p_shop and drawer_closing_id is null and ((actor_id=p_actor and data->>'action'='sale.refunded') or (data->>'action'='payment.corrected' and (data->>'drawerActor')::uuid=p_actor))
   and (not multi or coalesce(branch_id,'main')=br);
 if refund_ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_refunds) x) then raise exception 'Refunds changed. Review the refreshed drawer before retrying.' using errcode='40001';end if;
 select coalesce(sum((data->>'cashDelta')::bigint),0) into cash_correction from public.sale_adjustments where shop_id=p_shop and id=any(refund_ids) and data->>'action'='payment.corrected';
 select pos+coalesce(sum((data->'methodDeltas'->>'POS')::bigint),0),transfer+coalesce(sum((data->'methodDeltas'->>'Transfer')::bigint),0),collected+coalesce(sum((data->'methodDeltas'->>'Cash')::bigint+(data->'methodDeltas'->>'POS')::bigint+(data->'methodDeltas'->>'Transfer')::bigint),0) into pos,transfer,collected from public.sale_adjustments where shop_id=p_shop and id=any(refund_ids) and data->>'action'='payment.corrected';
 at_time=clock_timestamp();
 result=jsonb_build_object('id',p_id,'fromUserId',p_actor,'fromUserLabel',actor.name,'toUserId',p_receiver,'toUserLabel',receiver.name,'closedAt',at_time,'checkoutIds',to_jsonb(ids),'openingId',opening.id,'openingCash',opening_cash,'cashCollected',cash,'totalCollected',collected,'posCollected',pos,'transferCollected',transfer,'walletUsed',wallet,'jobSales',sales,'refundIds',to_jsonb(refund_ids),'cashCorrection',cash_correction,'cashRefunded',cash_refunded,'totalRefunded',total_refunded,'expectedCash',opening_cash+cash+cash_correction-cash_refunded,'countedCash',p_counted,'difference',p_counted-opening_cash-cash-cash_correction+cash_refunded,'note',coalesce(p_note,''));
 insert into public.drawer_closings(shop_id,id,from_user,to_user,closed_at,data,branch_id) values(p_shop,p_id,p_actor,p_receiver,at_time,result,case when br='main' then null else br end);
 update public.checkout_records set drawer_closing_id=p_id where shop_id=p_shop and id=any(ids);
 update public.sale_adjustments set drawer_closing_id=p_id where shop_id=p_shop and id=any(refund_ids);
 return result;
end;$function$;
revoke all on function public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text,uuid[],text) from public, anon, authenticated;
grant execute on function public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text,uuid[],text) to service_role;
