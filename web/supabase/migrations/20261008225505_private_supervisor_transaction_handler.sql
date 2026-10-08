begin;
alter function public.apply_supervised_event(uuid,jsonb) set schema private;
create function public.apply_supervised_event(p_shop uuid,p_event jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select private.apply_supervised_event(p_shop,p_event);
$$;
revoke all on function public.apply_supervised_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_supervised_event(uuid,jsonb) to authenticated;
commit;
