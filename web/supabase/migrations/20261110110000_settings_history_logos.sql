-- Business settings history: logo images (logo, logoVariants) make up most of each saved copy
-- (49 MB of 61 MB on 9 Nov), though they rarely change. A history copy now leaves out a logo that
-- is the same as in the copy before it and lists it in "$unchanged"; the latest earlier copy that
-- has it holds the image. Older copies are trimmed the same way.

create or replace function private.audit_business_settings() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare s jsonb := new.settings; same text[] := '{}'; k text;
begin
  update public.shops set name = btrim(new.settings->>'businessName') where id = new.shop_id;
  if tg_op = 'UPDATE' then
    foreach k in array array['logo', 'logoVariants'] loop
      if s ? k and old.settings ? k and s->k = old.settings->k then
        s := s - k;
        same := same || k;
      end if;
    end loop;
    if cardinality(same) > 0 then s := s || jsonb_build_object('$unchanged', to_jsonb(same)); end if;
  end if;
  insert into public.business_settings_history(shop_id, version, settings, modified_at, modified_by)
  values (new.shop_id, new.version, s, new.modified_at, new.modified_by);
  return new;
end $function$;

-- Earlier copies: leave out each logo that is the same as in the copy just before it.
with ordered as (
  select id,
    settings->'logo' is not null and settings->'logo' = lag(settings->'logo') over w as same_logo,
    settings->'logoVariants' is not null and settings->'logoVariants' = lag(settings->'logoVariants') over w as same_variants
  from public.business_settings_history
  where not settings ? '$unchanged'
  window w as (partition by shop_id order by version, modified_at, id)
)
update public.business_settings_history h
set settings = (h.settings
    - case when o.same_logo then 'logo' else '' end
    - case when o.same_variants then 'logoVariants' else '' end)
  || jsonb_build_object('$unchanged', to_jsonb(array_remove(array[
       case when o.same_logo then 'logo' end, case when o.same_variants then 'logoVariants' end], null)))
from ordered o
where o.id = h.id and (o.same_logo or o.same_variants);
