begin;
-- Only the guarded implementation can write financial and stock records.
-- The exposed RPC runs with caller privileges and delegates to this private function.
alter function public.apply_expense_event(uuid,jsonb) set schema private;
revoke all on function private.apply_expense_event(uuid,jsonb) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.apply_expense_event(uuid,jsonb) to authenticated;
create function public.apply_expense_event(p_shop uuid,p_event jsonb) returns void
language sql security invoker set search_path='' as $$
 select private.apply_expense_event(p_shop,p_event);
$$;
revoke all on function public.apply_expense_event(uuid,jsonb) from public,anon;
grant execute on function public.apply_expense_event(uuid,jsonb) to authenticated;
commit;
