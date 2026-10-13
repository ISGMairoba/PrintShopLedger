-- Payment reminders: a record each time staff remind a customer about money owed, so everyone
-- sees who was reminded, when and for how much. Reminders never change balances.
create table if not exists public.customer_reminders (
  id uuid not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  data jsonb not null,
  primary key (shop_id, id)
);
alter table public.customer_reminders enable row level security;
create policy member_read on public.customer_reminders for select to authenticated using (public.is_shop_member(shop_id));
grant select on public.customer_reminders to authenticated;

create or replace function public.apply_reminder_event(p_shop uuid, p_event jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := p_event->'data';
  eid uuid := (p_event->>'id')::uuid;
  rid uuid := (d->>'id')::uuid;
  cid uuid := (d->>'customerId')::uuid;
  u uuid := auth.uid();
  prior jsonb; prior_actor uuid; label text;
begin
  if u is null or not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=1) then
    raise exception 'Business access denied';
  end if;
  if p_event->>'kind' is distinct from 'customer.reminded' or eid is null or rid is null or cid is null then
    raise exception 'Invalid reminder';
  end if;
  if (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Audit identity must match signed-in staff'; end if;
  select payload, actor_id into prior, prior_actor from public.ledger_events where shop_id=p_shop and id=eid;
  if found then
    if prior<>p_event or prior_actor<>u then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  if not exists(select 1 from public.customers where shop_id=p_shop and id=cid) then raise exception 'Choose a customer from this business'; end if;
  if not private.valid_quotation_money(d->'amountOwed') then raise exception 'Invalid amount owed'; end if;
  if coalesce(d->>'channel','') not in ('whatsapp','download') then raise exception 'Invalid reminder channel'; end if;
  if exists(select 1 from public.customer_reminders where shop_id=p_shop and id=rid) then raise exception 'Reminder ID already used'; end if;
  select coalesce(nullif(btrim(mb.name),''), au.email, u::text) into label
    from public.shop_members mb join auth.users au on au.id=mb.user_id where mb.shop_id=p_shop and mb.user_id=u;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, eid, u, p_event);
  insert into public.customer_reminders(id, shop_id, data) values (rid, p_shop, jsonb_build_object(
    'id', rid, 'customerId', cid, 'amountOwed', (d->>'amountOwed')::bigint, 'channel', d->>'channel',
    'remindedBy', u, 'remindedByLabel', label, 'remindedAt', now(), 'lastEventId', eid));
end $$;
revoke all on function public.apply_reminder_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_reminder_event(uuid, jsonb) to authenticated, service_role;

do $$ begin
  if to_regprocedure('public.get_ledger_before_reminders(uuid)') is null then
    alter function public.get_ledger(uuid) rename to get_ledger_before_reminders;
  end if;
end $$;
create or replace function public.get_ledger(p_shop uuid)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  return public.get_ledger_before_reminders(p_shop) || jsonb_build_object('reminders',
    (select coalesce(jsonb_agg(r.data order by r.data->>'remindedAt', r.id), '[]'::jsonb)
       from public.customer_reminders r where r.shop_id=p_shop));
end $$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated, service_role;
