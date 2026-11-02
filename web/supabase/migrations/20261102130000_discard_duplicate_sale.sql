-- Conflict Inbox: Admin and higher may discard a stuck sale (for example a duplicate, recorded again
-- another way). A review reason is required and kept with the conflict, with who resolved it and when;
-- nothing from the discarded sale is recorded.
do $mig$
declare src text; a text := $x$ if c.source->>'kind'='checkout.completed' and jsonb_array_length(p_replacements)<>1 then raise exception 'A sale must be reviewed and retained, not discarded';end if;$x$;
begin
  src := pg_get_functiondef('private.resolve_sync_conflict(uuid,uuid,text,jsonb,text)'::regprocedure);
  if (length(src) - length(replace(src, a, ''))) / length(a) <> 1 then raise exception 'resolve_sync_conflict changed; review the discard migration'; end if;
  execute replace(src, a, $x$ if c.source->>'kind'='checkout.completed' and jsonb_array_length(p_replacements)>1 then raise exception 'Review a sale as one sale';end if;$x$);
end $mig$;
