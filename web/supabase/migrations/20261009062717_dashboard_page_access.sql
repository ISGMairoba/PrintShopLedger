-- Add Dashboard to the configurable page registry without changing saved permissions.
-- Existing restricted role lists remain unchanged; Developer can grant Dashboard.
do $migration$
declare definition text;
begin
 definition=pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
 if position('known text[]:=array[''Point of Service''' in definition)=0 then raise exception 'Unexpected page registry definition';end if;
 definition=replace(definition,'known text[]:=array[''Point of Service''','known text[]:=array[''Dashboard'',''Point of Service''');
 definition=replace(definition,'in (''Users'',''Conflict Inbox'',''Sale Adjustments'',''Material Waste'')','in (''Dashboard'',''Users'',''Conflict Inbox'',''Sale Adjustments'',''Material Waste'')');
 execute definition;
end;$migration$;
