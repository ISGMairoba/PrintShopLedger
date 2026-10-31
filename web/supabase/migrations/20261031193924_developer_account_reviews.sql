begin;
-- A supervisor reviewing someone else's pending operation cannot bypass Developer-only setup.
do $patch$
declare src text;marker text;
begin
 src:=pg_get_functiondef('private.apply_reviewed_operation(uuid,jsonb,uuid)'::regprocedure);
 marker:=E'begin\n';
 if strpos(src,marker)=0 then raise exception 'Review permission marker changed';end if;
 src:=replace(src,marker,marker||$guard$
 if p_event->>'kind' in ('account.created','account.updated') and not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level=4) then raise exception 'Only a Developer can review account creation or payment-method links' using errcode='42501';end if;
$guard$);execute src;
end $patch$;
commit;
