-- A split sale's refund goes back by several methods (owner, 23 Nov: cash first by default): one
-- refund per method, saved together, all or none. apply_supervised_events now also takes refunds,
-- all for one job; each still goes through every check of a single refund, in order, so each one's
-- version and balance check sees the refund before it.
create or replace function public.apply_supervised_events(p_shop uuid, p_events jsonb) returns jsonb
language plpgsql set search_path to '' as $f$
declare ev jsonb;
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) not between 1 and 10 then
    raise exception 'Send between 1 and 10 changes';
  end if;
  if not (
    not exists (select 1 from jsonb_array_elements(p_events) x where x->>'kind' is distinct from 'payment.corrected')
    or (not exists (select 1 from jsonb_array_elements(p_events) x where x->>'kind' is distinct from 'sale.refunded')
        and (select count(distinct x->'data'->>'jobId') from jsonb_array_elements(p_events) x) = 1)) then
    raise exception 'Only payment corrections, or one job''s refunds, can be saved together';
  end if;
  perform set_config('psl.skip_ledger', 'on', true);
  for ev in select value from jsonb_array_elements(p_events) loop
    perform public.apply_supervised_event(p_shop, ev);
  end loop;
  perform set_config('psl.skip_ledger', '', true);
  return public.get_ledger(p_shop);
end $f$;
