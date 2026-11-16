-- Installed app icon: the background may also be 'transparent' (no background, the logo only).
create or replace function private.check_app_icon() returns trigger
language plpgsql set search_path to '' as $function$
declare a jsonb := new.settings->'appIcon';
begin
  if a is null then return new; end if;
  if jsonb_typeof(a) <> 'object' or exists (select 1 from jsonb_object_keys(a) k where k not in ('layout', 'background', 'png'))
     or coalesce(a->>'layout', '') not in ('none', 'complete', 'stacked', 'horizontal', 'wordmark', 'icon')
     or (coalesce(a->>'background', '') !~* '^#[0-9a-f]{6}$' and a->>'background' is distinct from 'transparent')
     or jsonb_typeof(a->'png') is distinct from 'string' or length(a->>'png') > 400000
     or (a->>'png' <> '' and a->>'png' !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$') then
    raise exception 'Invalid app icon';
  end if;
  return new;
end $function$;
