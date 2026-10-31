begin;
-- Validate references after the stored-event retry check, so archiving never breaks an acknowledged retry.
do $patch$
declare src text;guard text;marker text;
begin
 src:=pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
 guard:=$guard$
 if nullif(d->>'payeeId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='payees' and id=(d->>'payeeId')::uuid and (not coalesce((data->>'archived')::boolean,false) or id::text=(select data->>'payeeId' from public.expenses where shop_id=p_shop and id=(d->>'id')::uuid))) then raise exception 'Choose an active payee from this business';end if;
 if nullif(d->'payment'->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->'payment'->>'accountId')::uuid and not (data->>'archived')::boolean and (d->'payment'->>'paidOn')::date>=(data->>'openingDate')::date) then raise exception 'Choose an active payment account with a valid opening date';end if;
$guard$;
 marker:=$m$if found then if prior<>p_event or prior_actor<>u then raise exception 'Operation ID already used';end if;return;end if;$m$;
 if strpos(src,guard)=0 or strpos(src,marker)=0 then raise exception 'Payment retry marker changed';end if;
 src:=replace(src,guard,'');src:=replace(src,marker,marker||guard);execute src;
 src:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 guard:=$guard$
 if nullif(d->>'accountId','') is not null and not exists(select 1 from public.business_operations_records where shop_id=p_shop and collection='moneyAccounts' and id=(d->>'accountId')::uuid and not (data->>'archived')::boolean and (d->>'paidOn')::date>=(data->>'openingDate')::date) then raise exception 'Choose an active payment account with a valid opening date';end if;
$guard$;
 marker:=$m$if found then if existing<>p_event or existing_actor<>u then raise exception 'Operation ID already used';end if;return;end if;$m$;
 if strpos(src,guard)=0 or strpos(src,marker)=0 then raise exception 'Payment retry marker changed';end if;
 src:=replace(src,guard,'');src:=replace(src,marker,marker||guard);execute src;
end $patch$;
commit;
