-- Business Settings → Messages: the "Part of an order ready" message (part_ready) can have its own
-- wording and sending, like the other messages.
do $m$
declare def text := pg_get_functiondef('private.check_messages()'::regprocedure);
  t text := $t$'delivery', 'options', 'reorder')$t$;
begin
  if position('part_ready' in def) > 0 then raise notice 'Messages already take part_ready'; return; end if;
  if position(t in def) = 0 then raise exception 'check_messages: message list not found'; end if;
  execute replace(def, t, $r$'delivery', 'options', 'reorder', 'part_ready')$r$);
end $m$;
