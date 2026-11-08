-- Lenders: a payee can keep the next loan repayment date ("repaymentDue", a date or '' for none),
-- set from Payees → Edit. Left out of an update, it stays as it was. Admins get a reminder in the
-- app three days before (lenders.mjs).

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_operations_event(uuid,jsonb)'::regprocedure);
  pat := $re$nxt:=nxt\|\|jsonb_build_object\('phone',btrim\(d->>'phone'\),'address',btrim\(d->>'address'\),'note',btrim\(d->>'note'\)\);$re$;
  if regexp_count(d, pat) <> 1 then raise exception 'apply_operations_event payee pattern not found'; end if;
  execute regexp_replace(d, pat, $$nxt:=nxt||jsonb_build_object('phone',btrim(d->>'phone'),'address',btrim(d->>'address'),'note',btrim(d->>'note'));
    if d ? 'repaymentDue' then
     if jsonb_typeof(d->'repaymentDue') is distinct from 'string' or (d->>'repaymentDue'<>'' and d->>'repaymentDue' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'Choose a valid repayment date';end if;
     if d->>'repaymentDue'<>'' then perform (d->>'repaymentDue')::date;end if;
     nxt:=nxt||jsonb_build_object('repaymentDue',d->>'repaymentDue');
    end if;$$);
end $patch$;
