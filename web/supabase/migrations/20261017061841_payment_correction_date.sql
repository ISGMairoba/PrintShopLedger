-- Payment corrections can also change the payment date (paidOn). Older apps omit it.
do $mig$
declare src text := pg_get_functiondef('private.apply_supervised_event_v2(uuid,jsonb)'::regprocedure);
  a text := $a$or length(d->>'reference')>500 then raise exception 'Enter valid payment details';$a$;
  b text := $b$btrim(d->>'reference')=p.reference then raise exception 'Nothing changed';$b$;
  c text := $c$reference=btrim(d->>'reference') where shop_id=p_shop and id=p.id;$c$;
begin
  if (length(src)-length(replace(src,a,'')))/length(a)<>1 or (length(src)-length(replace(src,b,'')))/length(b)<>1 or (length(src)-length(replace(src,c,'')))/length(c)<>1 then raise exception 'apply_supervised_event_v2 changed; review the payment date migration';end if;
  src := replace(src,a,$x$or length(d->>'reference')>500 or (d ? 'paidOn' and (jsonb_typeof(d->'paidOn') is distinct from 'string' or d->>'paidOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception 'Enter valid payment details';
  if d ? 'paidOn' and to_char((d->>'paidOn')::date,'YYYY-MM-DD')<>d->>'paidOn' then raise exception 'Choose a valid payment date';end if;$x$);
  src := replace(src,b,$x$btrim(d->>'reference')=p.reference and coalesce(d->>'paidOn',p.paid_on::text)=p.paid_on::text then raise exception 'Nothing changed';$x$);
  src := replace(src,c,$x$reference=btrim(d->>'reference'),paid_on=coalesce((d->>'paidOn')::date,paid_on) where shop_id=p_shop and id=p.id;$x$);
  execute src;
end $mig$;
