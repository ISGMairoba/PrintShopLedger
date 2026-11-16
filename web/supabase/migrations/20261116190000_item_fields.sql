-- Fields for the new Quick sale screen and messages:
-- * items (services): an icon (a name from the app's icon set) and a category;
-- * customers: "Called as", the name messages greet them by ({customer});
-- * staff: initials for their round avatar (up to 2 letters).
-- Each is set with its own small operation, so the existing item and customer operations stay as
-- they are: service.display_set (Admin and up, like editing items) and customer.called_as_set
-- (anyone in the business, like editing customers); set_my_initials for the signed-in person.

alter table public.services add column if not exists icon text not null default '',
  add column if not exists category text not null default '';
alter table public.services drop constraint if exists services_display_check;
alter table public.services add constraint services_display_check
  check (icon ~ '^[a-z][a-zA-Z0-9]{0,39}$' or icon = '') ;
alter table public.services drop constraint if exists services_category_check;
alter table public.services add constraint services_category_check
  check (length(category) <= 60 and category !~ '[\x00-\x1f\x7f]');
alter table public.customers add column if not exists called_as text not null default '';
alter table public.customers drop constraint if exists customers_called_as_check;
alter table public.customers add constraint customers_called_as_check
  check (length(called_as) <= 80 and called_as !~ '[\x00-\x1f\x7f]');
alter table public.shop_members add column if not exists initials text not null default '';
alter table public.shop_members drop constraint if exists shop_members_initials_check;
alter table public.shop_members add constraint shop_members_initials_check
  check (initials ~ '^[[:alpha:][:digit:]]{0,2}$');

-- 1. The business copy carries the new fields (a wrapper, like the other ledger additions).
do $m$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_ledger_before_item_fields') then
    alter function public.get_ledger(uuid) rename to get_ledger_before_item_fields;
  end if;
end $m$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $function$
declare result jsonb := public.get_ledger_before_item_fields(p_shop);
begin
  if result ? 'services' then
    result := jsonb_set(result, '{services}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('icon', coalesce(s.icon, ''), 'category', coalesce(s.category, '')) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'services') with ordinality x(v, n)
      left join public.services s on s.shop_id = p_shop and s.id = (x.v->>'id')::uuid));
  end if;
  if result ? 'customers' then
    result := jsonb_set(result, '{customers}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('calledAs', coalesce(c.called_as, '')) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'customers') with ordinality x(v, n)
      left join public.customers c on c.shop_id = p_shop and c.id = (x.v->>'id')::uuid));
  end if;
  return result;
end $function$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
revoke all on function public.get_ledger_before_item_fields(uuid) from public, anon;
grant execute on function public.get_ledger_before_item_fields(uuid) to authenticated;

-- 2. An item's icon and category.
create or replace function public.apply_service_display_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $function$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; s public.services%rowtype; payload jsonb; actor uuid; label text;
  v_icon text := btrim(coalesce(d->>'icon', '')); v_cat text := btrim(coalesce(d->>'category', ''));
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level >= 2) then raise exception 'Business access denied'; end if;
  if p_event->>'kind' is distinct from 'service.display_set' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select * into s from public.services where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Item not found'; end if;
  if s.version is distinct from (d->>'baseVersion')::integer then raise exception 'Item changed elsewhere. Review the latest version.' using errcode = 'PT409'; end if;
  if v_icon !~ '^([a-z][a-zA-Z0-9]{0,39})?$' then raise exception 'Choose an icon from the list'; end if;
  if length(v_cat) > 60 or v_cat ~ '[\x00-\x1f\x7f]' then raise exception 'Keep the category to 60 characters'; end if;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.services set icon = v_icon, category = v_cat, version = version + 1, modified_by = auth.uid(),
    modified_by_label = coalesce(label, modified_by_label), modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = s.id;
end $function$;

-- 3. A customer's "Called as" name.
create or replace function public.apply_customer_called_as_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $function$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; c public.customers%rowtype; payload jsonb; actor uuid; label text;
  v_called text := btrim(coalesce(d->>'calledAs', ''));
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if p_event->>'kind' is distinct from 'customer.called_as_set' or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select * into c from public.customers where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Customer not found'; end if;
  if c.version is distinct from (d->>'baseVersion')::integer then raise exception 'Customer changed elsewhere. Review the latest version.' using errcode = 'PT409'; end if;
  if length(v_called) > 80 or v_called ~ '[\x00-\x1f\x7f]' then raise exception 'Keep "Called as" to 80 characters'; end if;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.customers set called_as = v_called, version = version + 1, modified_by = auth.uid(),
    modified_by_label = coalesce(label, modified_by_label), modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = c.id;
end $function$;

-- 4. My initials, and the businesses list says them.
create or replace function public.set_my_initials(p_shop uuid, p_initials text) returns text
language plpgsql security definer set search_path to '' as $function$
declare v text := upper(btrim(coalesce(p_initials, '')));
begin
  if v !~ '^[[:alpha:][:digit:]]{0,2}$' then raise exception 'Use up to 2 letters or numbers'; end if;
  update public.shop_members set initials = v, modified_at = now(), modified_by = auth.uid(), version = version + 1
   where shop_id = p_shop and user_id = auth.uid() and not archived;
  if not found then raise exception 'Business access denied'; end if;
  return v;
end $function$;
create or replace function public.list_my_shops() returns jsonb
language sql stable set search_path to '' as $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',m.role,'rank',m.rank,'accessLevel',m.access_level,'userId',m.user_id,'username',m.username,'staffName',m.name,'initials',m.initials) order by s.created_at),'[]'::jsonb)
 from public.shops s join public.shop_members m on m.shop_id=s.id where m.user_id=auth.uid() and not m.archived and m.access_level>0;
$function$;
revoke all on function public.apply_service_display_event(uuid, jsonb), public.apply_customer_called_as_event(uuid, jsonb), public.set_my_initials(uuid, text) from public, anon;
grant execute on function public.apply_service_display_event(uuid, jsonb), public.apply_customer_called_as_event(uuid, jsonb), public.set_my_initials(uuid, text) to authenticated;
