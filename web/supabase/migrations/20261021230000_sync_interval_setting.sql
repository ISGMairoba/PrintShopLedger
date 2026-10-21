-- Business Settings → Security also sets how often devices check for other devices' changes
-- (security.syncMinutes, 1 to 60; missing = 2 minutes).
do $mig$
declare src text; pairs text[][]; i int;
begin
 src:=pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
 pairs:=array[
  array[$a$key<>'autoLockMinutes')$a$, $b$key not in ('autoLockMinutes','syncMinutes'))$b$],
  array[$a$then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;$a$, $b$then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;
 if config->'security' ? 'syncMinutes' and (jsonb_typeof(config->'security'->'syncMinutes') is distinct from 'number'
   or (config->'security'->>'syncMinutes')::numeric<>trunc((config->'security'->>'syncMinutes')::numeric)
   or (config->'security'->>'syncMinutes')::numeric not between 1 and 60) then raise exception 'Choose a sync check time from 1 to 60 minutes';end if;$b$]
 ];
 for i in 1..array_length(pairs,1) loop
  if (length(src)-length(replace(src,pairs[i][1],'')))/length(pairs[i][1])<>1 then raise exception 'check_dynamic_business_settings changed (part %); review the sync interval migration',i;end if;
  src:=replace(src,pairs[i][1],pairs[i][2]);
 end loop;
 execute src;
end $mig$;
