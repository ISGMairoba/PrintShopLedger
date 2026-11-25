-- Rollback-only fixture: steps timed by ratio.
begin;
do $test$
begin
  if not private.valid_steps('[{"name":"Design","share":25,"minutes":1440,"unit":"d"},{"name":"Printing","share":75,"minutes":4320,"unit":"d"}]') then
    raise exception 'Shares adding up to 100 were refused'; end if;
  if not private.valid_steps('[{"name":"Design","share":33.33},{"name":"Printing","share":66.67}]') then
    raise exception 'Shares without a turnaround were refused'; end if;
  if private.valid_steps('[{"name":"Design","share":25},{"name":"Printing","share":50}]') then
    raise exception 'Shares adding up to 75 were allowed'; end if;
  if private.valid_steps('[{"name":"Design","share":25},{"name":"Printing"}]') then
    raise exception 'A step without a share was allowed next to shares'; end if;
  if private.valid_steps('[{"name":"Design","share":120}]') then raise exception 'A share over 100 was allowed'; end if;
  if not private.valid_steps('[{"name":"Design","minutes":60,"unit":"h"}]') then raise exception 'Fixed times were refused'; end if;
  if (private.service_production('{"steps":[{"name":"A","share":40},{"name":"B","share":60}]}'::jsonb)->'steps'->0->>'share') <> '40' then
    raise exception 'The service did not keep its shares'; end if;
end $test$;
rollback;
