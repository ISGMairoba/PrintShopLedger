-- Managers who already have a saved tab list get the new Security tab (keeping the last editor).
do $tabs$
declare r record;
begin
 for r in select shop_id,modified_by from public.business_settings
  where jsonb_typeof(settings->'settingsTabs'->'3')='array' and not (settings->'settingsTabs'->'3') ? 'Security' loop
  perform set_config('request.jwt.claims',json_build_object('sub',r.modified_by)::text,true);
  update public.business_settings
   set settings=jsonb_set(settings,'{settingsTabs,3}',(settings->'settingsTabs'->'3')||'["Security"]'::jsonb)
   where shop_id=r.shop_id;
 end loop;
end $tabs$;
