begin;
do $patch$
declare src text;marker text;
begin
 src:=pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
 marker:=$m$('Dropdowns & workflow','options')$m$;
 if strpos(src,marker)=0 then raise exception 'Settings tab mapping changed';end if;
 execute replace(src,marker,$m$('Payment methods','options'),('Dropdowns & workflow','options')$m$);
 src:=pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
 marker:=$m$'Dropdowns & workflow','Jobs & payments'$m$;
 if strpos(src,marker)=0 then raise exception 'Settings tab validation changed';end if;
 src:=replace(src,marker,$m$'Payment methods','Dropdowns & workflow','Jobs & payments'$m$);
 src:=replace(src,$m$config->'pageAccessVersion' is distinct from '2'::jsonb$m$,$m$config->'pageAccessVersion' not in ('2'::jsonb,'3'::jsonb)$m$);
 execute src;
 src:=pg_get_functiondef('public.save_business_settings(uuid,integer,jsonb)'::regprocedure);
 marker:='keys:=private.settings_tab_keys(coalesce(saved';
 if strpos(src,marker)=0 then raise exception 'Settings save permissions changed';end if;
 src:=replace(src,'keys text[];k text;','keys text[];k text;tabs jsonb;');
 src:=replace(src,marker,$m$tabs:=coalesce(saved->'settingsTabs'->lvl::text,'["Profile & logo","Appearance","Receipts","Payment methods","Dropdowns & workflow","Jobs & payments","Pricing templates","Corrections","Security","Branches"]'::jsonb);
  if coalesce((saved->>'settingsTabsVersion')::int,0)<1 and tabs ? 'Dropdowns & workflow' and not tabs ? 'Payment methods' then tabs:=tabs||'"Payment methods"'::jsonb;end if;
  keys:=private.settings_tab_keys(coalesce(saved$m$);
 src:=regexp_replace(src,'keys:=private.settings_tab_keys\(coalesce\(saved[^;]+;','keys:=private.settings_tab_keys(tabs);');
 marker:=$m$if p_settings ? k then saved:=jsonb_set(saved,array[k],p_settings->k);end if;$m$;
 if strpos(src,marker)=0 then raise exception 'Settings merge changed';end if;
 src:=replace(src,marker,$m$if p_settings ? k then
    if k='options' and not (tabs ? 'Dropdowns & workflow') then
     saved:=jsonb_set(saved,'{options}',(saved->'options')||jsonb_build_object('paymentMethods',p_settings->'options'->'paymentMethods'));
    elsif k='options' and not (tabs ? 'Payment methods') then
     saved:=jsonb_set(saved,'{options}',(p_settings->'options')||jsonb_build_object('paymentMethods',saved->'options'->'paymentMethods'));
    else saved:=jsonb_set(saved,array[k],p_settings->k);end if;
   end if;$m$);
 execute src;
 src:=pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
 marker:=$m$v:=coalesce(old->>'openingBalance',d->>'openingBalance')::numeric;on_day:=coalesce(old->>'openingDate',d->>'openingDate')::date;$m$;
 if strpos(src,marker)=0 then raise exception 'Account opening field validation changed';end if;
 execute replace(src,marker,$m$v:=coalesce(d->>'openingBalance',old->>'openingBalance')::numeric;on_day:=coalesce(d->>'openingDate',old->>'openingDate')::date;$m$);
end $patch$;
commit;
