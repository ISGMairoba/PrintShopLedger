-- Small changes (19 Nov):
-- * Business Settings → Security → "Lock when the app opens" (security.lockOnOpen, on by default).
-- * Business Settings → Messages → "Order collected" (messages.items.collected), sent with
--   Tell customer on a collected order.

do $m$
declare d text := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  t text := $x$key not in ('autoLockMinutes','syncMinutes','historyKeep'))$x$;
  g text := $x$ if config->'security' ? 'syncMinutes' and$x$;
begin
  if position('lockOnOpen' in d) > 0 then return; end if;
  if position(t in d) = 0 or position(g in d) = 0 then raise exception 'check_dynamic_business_settings: security check not found'; end if;
  d := replace(d, t, $x$key not in ('autoLockMinutes','syncMinutes','historyKeep','lockOnOpen'))$x$);
  d := replace(d, g, $x$ if config->'security' ? 'lockOnOpen' and jsonb_typeof(config->'security'->'lockOnOpen') is distinct from 'boolean' then raise exception 'Choose whether the app locks when opened';end if;
$x$ || g);
  execute d;
end $m$;

do $m$
declare d text := pg_get_functiondef('private.check_messages()'::regprocedure);
  t text := $x$'reorder', 'part_ready')$x$;
begin
  if position('''collected''' in d) > 0 then return; end if;
  if position(t in d) = 0 then raise exception 'check_messages: message list not found'; end if;
  execute replace(d, t, $x$'reorder', 'part_ready', 'collected')$x$);
end $m$;
