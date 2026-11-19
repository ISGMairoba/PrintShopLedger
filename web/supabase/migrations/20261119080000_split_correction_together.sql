-- A split payment's correction is saved together (audit AUD-13). Its parts (one payment correction
-- each) were sent one after another; a failure part-way left some parts corrected and others not.
-- apply_supervised_events applies them in order in one transaction: all are saved or none.
-- Each part goes through apply_supervised_event (all its checks); the business copy is built once,
-- at the end, rather than after every part (psl.skip_ledger, set only here, for this transaction).
do $m$
declare d text := pg_get_functiondef('public.get_ledger(uuid)'::regprocedure);
  t text := $x$perform set_config('psl.ledger', 'on', true);$x$;
begin
  if position('psl.skip_ledger' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'get_ledger: start not found'; end if;
  execute replace(d, t, $x$if current_setting('psl.skip_ledger', true) = 'on' then return null; end if;
  $x$ || t);
end $m$;

create or replace function public.apply_supervised_events(p_shop uuid, p_events jsonb) returns jsonb
language plpgsql set search_path to '' as $f$
declare ev jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) not between 1 and 10 then
    raise exception 'Send between 1 and 10 changes';
  end if;
  if exists (select 1 from jsonb_array_elements(p_events) x where x->>'kind' is distinct from 'payment.corrected') then
    raise exception 'Only payment corrections can be saved together';
  end if;
  perform set_config('psl.skip_ledger', 'on', true);
  for ev in select value from jsonb_array_elements(p_events) loop
    perform public.apply_supervised_event(p_shop, ev);
  end loop;
  perform set_config('psl.skip_ledger', '', true);
  return public.get_ledger(p_shop);
end $f$;
revoke all on function public.apply_supervised_events(uuid, jsonb) from public, anon;
grant execute on function public.apply_supervised_events(uuid, jsonb) to authenticated;
