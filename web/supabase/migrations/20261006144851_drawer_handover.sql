begin;
create table public.drawer_closings(
 shop_id uuid not null references public.shops(id),id uuid not null,from_user uuid not null references auth.users(id),
 to_user uuid not null references auth.users(id),closed_at timestamptz not null default clock_timestamp(),data jsonb not null,
 primary key(shop_id,id),check(from_user<>to_user)
);
create index drawer_closings_from on public.drawer_closings(shop_id,from_user,closed_at desc);
create index drawer_closings_to on public.drawer_closings(shop_id,to_user,closed_at desc);
create index drawer_closings_from_user on public.drawer_closings(from_user);
create index drawer_closings_to_user on public.drawer_closings(to_user);
alter table public.drawer_closings enable row level security;
revoke all on public.drawer_closings from public,anon,authenticated;
grant select on public.drawer_closings to authenticated;
grant all on public.drawer_closings to service_role;
create policy own_drawer_read on public.drawer_closings for select to authenticated using(public.is_shop_member(shop_id) and (from_user=(select auth.uid()) or to_user=(select auth.uid())));
alter table public.checkout_records add column drawer_closing_id uuid;
alter table public.checkout_records add constraint checkout_drawer_fk foreign key(shop_id,drawer_closing_id) references public.drawer_closings(shop_id,id);
create index checkout_records_open_actor on public.checkout_records(shop_id,((data->>'createdBy')::uuid)) where drawer_closing_id is null;
create index checkout_records_drawer on public.checkout_records(shop_id,drawer_closing_id);
grant update on public.checkout_records to service_role;
-- Password verification happens in close-drawer. Only its server identity can finalize the handover.
create function public.finish_drawer_handover(p_shop uuid,p_actor uuid,p_receiver uuid,p_id uuid,p_counted bigint,p_checkouts uuid[],p_opening uuid,p_note text default '') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare actor public.shop_members%rowtype;receiver public.shop_members%rowtype;existing public.drawer_closings%rowtype;
 ids uuid[];opening public.drawer_closings%rowtype;last_closed timestamptz;at_time timestamptz;
 cash bigint;collected bigint;pos bigint;transfer bigint;wallet bigint;sales bigint;opening_cash bigint;result jsonb;
begin
 if p_shop is null or p_actor is null or p_receiver is null or p_id is null or p_actor=p_receiver or p_counted is null or p_counted<0 or p_counted>100000000000 or p_checkouts is null or length(coalesce(p_note,''))>500 then raise exception 'Invalid drawer handover';end if;
 perform 1 from public.shops where id=p_shop for update;
 select * into actor from public.shop_members where shop_id=p_shop and user_id=p_actor and not archived and access_level>0 for share;
 if not found then raise exception 'Current user access is unavailable';end if;
 select * into receiver from public.shop_members where shop_id=p_shop and user_id=p_receiver and not archived and access_level>0 for share;
 if not found then raise exception 'Receiving user access is unavailable';end if;
 select * into existing from public.drawer_closings where shop_id=p_shop and id=p_id;
 if found then
  if existing.from_user<>p_actor or existing.to_user<>p_receiver or (existing.data->>'countedCash')::bigint<>p_counted or existing.data->>'note'<>coalesce(p_note,'') or coalesce((existing.data->>'openingId')::uuid,'00000000-0000-0000-0000-000000000000')<>coalesce(p_opening,'00000000-0000-0000-0000-000000000000') or (select array_agg(value::uuid order by value::uuid) from jsonb_array_elements_text(existing.data->'checkoutIds')) is distinct from (select array_agg(x order by x) from unnest(p_checkouts) x) then raise exception 'Handover ID is already used';end if;
  return existing.data;
 end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from public.checkout_records where shop_id=p_shop and (data->>'createdBy')::uuid=p_actor and drawer_closing_id is null;
 if ids is distinct from (select coalesce(array_agg(x order by x),'{}'::uuid[]) from unnest(p_checkouts) x) then raise exception 'Your unclosed transactions changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 select max(closed_at) into last_closed from public.drawer_closings where shop_id=p_shop and from_user=p_actor;
 select * into opening from public.drawer_closings where shop_id=p_shop and to_user=p_actor and (last_closed is null or closed_at>last_closed) order by closed_at desc,id desc limit 1;
 if opening.id is distinct from p_opening then raise exception 'Opening cash changed. Review the refreshed drawer totals before retrying.' using errcode='40001';end if;
 opening_cash=coalesce((opening.data->>'countedCash')::bigint,0);
 select coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Cash'),0),coalesce(sum((data->>'cashReceived')::bigint),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='POS'),0),coalesce(sum((data->>'cashReceived')::bigint) filter(where data->>'method'='Transfer'),0),coalesce(sum((data->>'walletUsed')::bigint),0),coalesce(sum((data->>'total')::bigint),0)
 into cash,collected,pos,transfer,wallet,sales from public.checkout_records where shop_id=p_shop and id=any(ids);
 at_time=clock_timestamp();
 result=jsonb_build_object('id',p_id,'fromUserId',p_actor,'fromUserLabel',actor.name,'toUserId',p_receiver,'toUserLabel',receiver.name,'closedAt',at_time,'checkoutIds',to_jsonb(ids),'openingId',opening.id,'openingCash',opening_cash,'cashCollected',cash,'totalCollected',collected,'posCollected',pos,'transferCollected',transfer,'walletUsed',wallet,'jobSales',sales,'expectedCash',opening_cash+cash,'countedCash',p_counted,'difference',p_counted-opening_cash-cash,'note',coalesce(p_note,''));
 insert into public.drawer_closings(shop_id,id,from_user,to_user,closed_at,data) values(p_shop,p_id,p_actor,p_receiver,at_time,result);
 update public.checkout_records set drawer_closing_id=p_id where shop_id=p_shop and id=any(ids);
 return result;
end;$$;
revoke all on function public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text) from public,anon,authenticated;
grant execute on function public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text) to service_role;
alter function public.get_ledger(uuid) rename to get_ledger_before_drawers;
create function public.get_ledger(p_shop uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare base jsonb;
begin
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied';end if;
 base=public.get_ledger_before_drawers(p_shop);
 return base||jsonb_build_object('checkouts',(select coalesce(jsonb_agg(data||jsonb_build_object('drawerClosingId',drawer_closing_id) order by created_at,id),'[]'::jsonb) from public.checkout_records where shop_id=p_shop),'drawerClosings',(select coalesce(jsonb_agg(data order by closed_at,id),'[]'::jsonb) from public.drawer_closings where shop_id=p_shop));
end;$$;
revoke all on function public.get_ledger(uuid) from public,anon;
grant execute on function public.get_ledger(uuid) to authenticated;
commit;
