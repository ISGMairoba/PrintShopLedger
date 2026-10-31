-- Keep the new section available when branch setup has replaced the tab-key mapping.
do $patch$
declare src text;
begin
 src:=pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
 if strpos(src,'Payment methods')=0 then
  execute replace(src,$m$('Dropdowns & workflow','options')$m$,$m$('Payment methods','options'),('Dropdowns & workflow','options')$m$);
 end if;
end $patch$;
