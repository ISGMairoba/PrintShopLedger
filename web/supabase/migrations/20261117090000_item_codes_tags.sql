-- Quick sale tiles: items get an optional **code** (unique in the business, e.g. STA-001) and up to
-- 10 **tags**, set with the item's icon and category (service.display_set). Business Settings →
-- Appearance saves the item tile colours (settings.tiles).

alter table public.services add column if not exists code text not null default '',
  add column if not exists tags jsonb not null default '[]'::jsonb;
alter table public.services drop constraint if exists services_code_check;
alter table public.services add constraint services_code_check
  check (code = '' or code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$');
alter table public.services drop constraint if exists services_tags_check;
alter table public.services add constraint services_tags_check
  check (jsonb_typeof(tags) = 'array' and jsonb_array_length(tags) <= 10);
create unique index if not exists services_code_unique on public.services (shop_id, lower(code)) where code <> '';

-- 1. The business copy carries code and tags.
do $m$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_ledger_before_item_codes') then
    alter function public.get_ledger(uuid) rename to get_ledger_before_item_codes;
  end if;
end $m$;
create or replace function public.get_ledger(p_shop uuid) returns jsonb
language plpgsql stable set search_path to '' as $function$
declare result jsonb := public.get_ledger_before_item_codes(p_shop);
begin
  if result ? 'services' then
    result := jsonb_set(result, '{services}', (
      select coalesce(jsonb_agg(x.v || jsonb_build_object('code', coalesce(s.code, ''), 'tags', coalesce(s.tags, '[]'::jsonb)) order by x.n), '[]'::jsonb)
      from jsonb_array_elements(result->'services') with ordinality x(v, n)
      left join public.services s on s.shop_id = p_shop and s.id = (x.v->>'id')::uuid));
  end if;
  return result;
end $function$;
revoke all on function public.get_ledger(uuid) from public, anon;
grant execute on function public.get_ledger(uuid) to authenticated;
revoke all on function public.get_ledger_before_item_codes(uuid) from public, anon;
grant execute on function public.get_ledger_before_item_codes(uuid) to authenticated;

-- 2. An item's icon, category, code and tags (code and tags kept as they are when not sent).
create or replace function public.apply_service_display_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $function$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; s public.services%rowtype; payload jsonb; actor uuid; label text;
  v_icon text := btrim(coalesce(d->>'icon', '')); v_cat text := btrim(coalesce(d->>'category', ''));
  v_code text; v_tags jsonb;
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
  if length(v_cat) > 60 or v_cat ~ '[[:cntrl:]]' then raise exception 'Keep the category to 60 characters'; end if;
  -- Code: '' or up to 24 letters, digits and . _ / -; unique in the business (ignoring capitals).
  if d ? 'code' and jsonb_typeof(d->'code') is distinct from 'string' then raise exception 'Invalid item code'; end if;
  v_code := case when d ? 'code' then btrim(d->>'code') else s.code end;
  if v_code <> '' and v_code !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$' then raise exception 'Item codes use up to 24 letters, digits, dots, dashes or slashes'; end if;
  if v_code <> '' and exists (select 1 from public.services o where o.shop_id = p_shop and o.id <> s.id and lower(o.code) = lower(v_code)) then
    raise exception 'Another item already has the code %', v_code using errcode = 'PT409';
  end if;
  -- Tags: up to 10, each 1–30 characters, no repeats (ignoring capitals).
  v_tags := case when d ? 'tags' then d->'tags' else s.tags end;
  if jsonb_typeof(v_tags) is distinct from 'array' or jsonb_array_length(v_tags) > 10
     or exists (select 1 from jsonb_array_elements(v_tags) t where jsonb_typeof(t) <> 'string' or length(btrim(t #>> '{}')) not between 1 and 30 or t #>> '{}' ~ '[[:cntrl:]]')
     or (select count(distinct lower(btrim(t))) from jsonb_array_elements_text(v_tags) t) <> jsonb_array_length(v_tags) then
    raise exception 'Give an item up to 10 tags of up to 30 characters each';
  end if;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.services set icon = v_icon, category = v_cat, code = v_code, tags = v_tags, version = version + 1, modified_by = auth.uid(),
    modified_by_label = coalesce(label, modified_by_label), modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = s.id;
end $function$;
revoke all on function public.apply_service_display_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_service_display_event(uuid, jsonb) to authenticated;

-- 3. Appearance saves the item tile colours (settings.tiles).
do $m$
declare def text := pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
  t text := $t$('Appearance','backgrounds'),$t$;
begin
  if position($x$'tiles'$x$ in def) > 0 then return; end if;
  if position(t in def) = 0 then raise exception 'settings_tab_keys: Appearance not found'; end if;
  execute replace(def, t, t || $r$('Appearance','tiles'),$r$);
end $m$;

create or replace function private.check_item_tiles() returns trigger
language plpgsql set search_path to '' as $function$
declare v jsonb := new.settings->'tiles';
begin
  if v is null then return new; end if;
  if jsonb_typeof(v) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(v) k where k not in ('mode', 'by', 'count', 'seed', 'colors'))
     or coalesce(v->>'mode', 'varied') not in ('varied', 'single')
     or coalesce(v->>'by', 'category') not in ('category', 'item')
     or (v ? 'count' and (jsonb_typeof(v->'count') is distinct from 'number' or (v->>'count')::numeric not in (3, 4, 5, 6, 7, 8)))
     or (v ? 'seed' and (jsonb_typeof(v->'seed') is distinct from 'number' or (v->>'seed')::numeric < 0 or (v->>'seed')::numeric >= 1000000 or (v->>'seed')::numeric <> trunc((v->>'seed')::numeric)))
     or (v ? 'colors' and (jsonb_typeof(v->'colors') is distinct from 'array' or jsonb_array_length(v->'colors') > 8
         or exists (select 1 from jsonb_array_elements(v->'colors') c where jsonb_typeof(c) <> 'string' or c #>> '{}' !~* '^#[0-9a-f]{6}$'))) then
    raise exception 'Invalid item tile settings';
  end if;
  return new;
end $function$;
drop trigger if exists check_item_tiles on public.business_settings;
create trigger check_item_tiles before insert or update on public.business_settings
  for each row execute function private.check_item_tiles();
