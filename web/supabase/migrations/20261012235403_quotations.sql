-- Quotations: priced offers a customer can accept later. A quotation does not touch stock, jobs or
-- money; converting one goes through a normal checkout. Any active staff member may save
-- quotations (the app shows the page to whoever can use Point of Service).
-- Edits from two devices: the later save wins. Saves never fail on version, so offline work
-- can always sync; a converted quotation keeps its converted state and link.

create table if not exists public.quotations (
  id uuid not null,
  shop_id uuid not null references public.shops(id) on delete cascade,
  data jsonb not null,
  primary key (shop_id, id)
);
alter table public.quotations enable row level security;
create policy member_read on public.quotations for select to authenticated using (public.is_shop_member(shop_id));
grant select on public.quotations to authenticated;

create or replace function private.valid_quotation_money(v jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(v) = 'number' and (v#>>'{}')::numeric between 0 and 100000000000
    and (v#>>'{}')::numeric = trunc((v#>>'{}')::numeric)
$$;

create or replace function public.apply_quotation_event(p_shop uuid, p_event jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := p_event->'data';
  k text := p_event->>'kind';
  eid uuid := (p_event->>'id')::uuid;
  qid uuid := (d->>'id')::uuid;
  u uuid := auth.uid();
  old jsonb; nxt jsonb; prior jsonb; prior_actor uuid; label text; audit jsonb; line jsonb;
  lines jsonb := '[]';
begin
  if u is null or not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=1) then
    raise exception 'Business access denied';
  end if;
  if eid is null or qid is null then raise exception 'Missing quotation identifier'; end if;
  if (d->>'modifiedBy')::uuid is distinct from u then raise exception 'Audit identity must match signed-in staff'; end if;
  select payload, actor_id into prior, prior_actor from public.ledger_events where shop_id=p_shop and id=eid;
  if found then
    if prior<>p_event or prior_actor<>u then raise exception 'Operation ID already used'; end if;
    return;
  end if;
  select data into old from public.quotations where shop_id=p_shop and id=qid for update;
  select coalesce(nullif(btrim(mb.name),''), au.email, u::text) into label
    from public.shop_members mb join auth.users au on au.id=mb.user_id where mb.shop_id=p_shop and mb.user_id=u;
  audit := jsonb_build_object('modifiedBy',u,'modifiedByLabel',label,'modifiedAt',now(),'lastEventId',eid);

  if k='quotation.saved' then
    if (d->>'customerId') is not null and not exists(select 1 from public.customers where shop_id=p_shop and id=(d->>'customerId')::uuid) then
      raise exception 'Choose a customer from this business';
    end if;
    if jsonb_typeof(d->'customerName') is distinct from 'string' or length(btrim(d->>'customerName')) not between 1 and 160
       or jsonb_typeof(d->'customerPhone') is distinct from 'string' or length(d->>'customerPhone')>40
       or jsonb_typeof(d->'note') is distinct from 'string' or length(d->>'note')>1000 then
      raise exception 'Enter the customer name (up to 160 characters), phone and note';
    end if;
    if coalesce(d->>'validUntil','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid until date'; end if;
    perform (d->>'validUntil')::date;
    if jsonb_typeof(d->'lines') is distinct from 'array' or jsonb_array_length(d->'lines') not between 1 and 50 then
      raise exception 'A quotation needs 1 to 50 items';
    end if;
    for line in select value from jsonb_array_elements(d->'lines') loop
      if (line->>'id')::uuid is null or (line->>'serviceId')::uuid is null
         or jsonb_typeof(line->'description') is distinct from 'string' or length(btrim(line->>'description')) not between 1 and 500
         or jsonb_typeof(line->'service') is distinct from 'string' or length(line->>'service')>500
         or jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity')::numeric<=0 or (line->>'quantity')::numeric>1000000
         or not private.valid_quotation_money(line->'unitPrice') or not private.valid_quotation_money(line->'grossAmount')
         or not private.valid_quotation_money(line->'discountAmount') or not private.valid_quotation_money(line->'amount')
         or (line->>'amount')::numeric <> (line->>'grossAmount')::numeric - (line->>'discountAmount')::numeric then
        raise exception 'A quotation item is invalid';
      end if;
      lines := lines || jsonb_build_array(line);
    end loop;
    if not private.valid_quotation_money(d->'subtotal') or not private.valid_quotation_money(d->'discountTotal') or not private.valid_quotation_money(d->'total')
       or (d->>'total')::numeric <> (d->>'subtotal')::numeric - (d->>'discountTotal')::numeric
       or (d->>'total')::numeric <> (select sum((v->>'amount')::numeric) from jsonb_array_elements(lines) v) then
      raise exception 'Quotation totals do not add up';
    end if;
    nxt := coalesce(old, '{}'::jsonb) || jsonb_build_object(
      'id', qid,
      'customerId', d->'customerId',
      'customerName', btrim(d->>'customerName'),
      'customerPhone', btrim(d->>'customerPhone'),
      'lines', lines,
      'orderDiscount', coalesce(d->'orderDiscount', 'null'::jsonb),
      'subtotal', (d->>'subtotal')::bigint,
      'discountTotal', (d->>'discountTotal')::bigint,
      'total', (d->>'total')::bigint,
      'validUntil', d->>'validUntil',
      'note', btrim(d->>'note'),
      'status', coalesce(old->>'status', 'open'),
      'version', coalesce((old->>'version')::integer, 0) + 1,
      'createdBy', coalesce(old->'createdBy', to_jsonb(u)),
      'createdByLabel', coalesce(old->'createdByLabel', to_jsonb(label)),
      'createdAt', coalesce(old->'createdAt', to_jsonb(now()))
    ) || audit;
  elsif k in ('quotation.archived', 'quotation.restored') then
    if old is null then raise exception 'Quotation not found'; end if;
    nxt := old || audit || jsonb_build_object(
      'status', case when old->>'status'='converted' then 'converted' when k='quotation.archived' then 'archived' else 'open' end,
      'version', (old->>'version')::integer + 1);
  elsif k='quotation.converted' then
    if old is null then raise exception 'Quotation not found'; end if;
    if (d->>'checkoutId')::uuid is null then raise exception 'Converted quotation needs its checkout'; end if;
    nxt := old || audit || jsonb_build_object(
      'status', 'converted',
      'checkoutId', coalesce(old->'checkoutId', d->'checkoutId'),
      'convertedAt', coalesce(old->'convertedAt', to_jsonb(now())),
      'convertedByLabel', coalesce(old->'convertedByLabel', to_jsonb(label)),
      'version', (old->>'version')::integer + 1);
  else
    raise exception 'Unknown quotation operation';
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, eid, u, p_event);
  if old is null then insert into public.quotations(id, shop_id, data) values (qid, p_shop, nxt);
  else update public.quotations set data=nxt where shop_id=p_shop and id=qid; end if;
end $$;
revoke all on function public.apply_quotation_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_quotation_event(uuid, jsonb) to authenticated, service_role;

-- The ledger download includes quotations.
do $$ begin
  if to_regprocedure('public.get_ledger_before_quotations(uuid)') is null then
    alter function public.get_ledger(uuid) rename to get_ledger_before_quotations;
  end if;
end $$;
create or replace function public.get_ledger(p_shop uuid)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  return public.get_ledger_before_quotations(p_shop) || jsonb_build_object('quotations',
    (select coalesce(jsonb_agg(q.data order by q.data->>'createdAt', q.id), '[]'::jsonb) from public.quotations q where q.shop_id=p_shop));
end $$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated, service_role;
