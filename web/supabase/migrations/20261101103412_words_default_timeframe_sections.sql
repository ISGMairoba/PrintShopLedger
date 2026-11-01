begin;
do $patch$
declare src text;
begin
 src:=pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
 if strpos(src,$m$('Jobs & payments','terms')$m$)=0 or strpos(src,$m$('Jobs & payments','periods')$m$)=0 then raise exception 'Settings mapping changed';end if;
 src:=replace(src,$m$('Jobs & payments','terms')$m$,$m$('Words','terms')$m$);
 src:=replace(src,$m$('Jobs & payments','periods')$m$,$m$('Default time frames','periods')$m$);execute src;
 src:=pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
 if strpos(src,$m$'Jobs & payments','Pricing templates'$m$)=0 then raise exception 'Settings tab validation changed';end if;
 execute replace(src,$m$'Jobs & payments','Pricing templates'$m$,$m$'Jobs & payments','Default time frames','Words','Pricing templates'$m$);
 src:=pg_get_functiondef('public.save_business_settings(uuid,integer,jsonb)'::regprocedure);
 if strpos(src,'keys:=private.settings_tab_keys(tabs);')=0 then raise exception 'Settings permission upgrade changed';end if;
 execute replace(src,'keys:=private.settings_tab_keys(tabs);',$m$if coalesce((saved->>'settingsTabsVersion')::int,0)<2 and tabs ? 'Jobs & payments' then tabs:=tabs||'["Default time frames","Words"]'::jsonb;end if;
  keys:=private.settings_tab_keys(tabs);$m$);
end $patch$;
commit;
