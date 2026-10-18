-- Installer credit ("Installed by … | phone") shown on receipts, full pages, reports and/or text
-- shares. It lives in the business settings record as settings.poweredBy.
--
-- Only Developer can change it: save_business_settings copies just the keys on an Admin's or
-- Manager's tabs (private.settings_tab_keys), and poweredBy is on none of them, so for ranks below
-- Developer the saved value is kept whatever they send. This migration only checks its shape.

create or replace function private.valid_powered_by(p_settings jsonb) returns boolean
language sql immutable set search_path='' as $$
 select not (p_settings ? 'poweredBy') or (
  jsonb_typeof(p_settings->'poweredBy')='object'
  and not exists(select 1 from jsonb_object_keys(p_settings->'poweredBy') k
   where k not in ('text','receipts','pages','reports','shares'))
  and coalesce(jsonb_typeof(p_settings->'poweredBy'->'text'),'string')='string'
  and char_length(coalesce(p_settings->'poweredBy'->>'text',''))<=60
  and coalesce(p_settings->'poweredBy'->>'text','') !~ '[[:cntrl:]]'
  and coalesce(jsonb_typeof(p_settings->'poweredBy'->'receipts'),'boolean')='boolean'
  and coalesce(jsonb_typeof(p_settings->'poweredBy'->'pages'),'boolean')='boolean'
  and coalesce(jsonb_typeof(p_settings->'poweredBy'->'reports'),'boolean')='boolean'
  and coalesce(jsonb_typeof(p_settings->'poweredBy'->'shares'),'boolean')='boolean'
 )
$$;

alter table public.business_settings add constraint business_settings_powered_by
 check(private.valid_powered_by(settings)) not valid;
alter table public.business_settings validate constraint business_settings_powered_by;
