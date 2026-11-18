-- Fix for 20261118230000_security_boundaries: the job-action and old-ledger front functions were
-- made to return jsonb, but the functions behind them return nothing (void), so every call failed
-- with "invalid input syntax for type json" (job status, materials, checks, hold, handovers, and
-- payment corrections through apply_ledger_event). They return void again, keeping the checks.
do $m$
declare n text;
begin
  foreach n in array array['apply_job_status_event', 'apply_job_material_event', 'apply_job_extra_materials_event',
                           'apply_job_check_event', 'apply_job_hold_event', 'apply_job_handover_event'] loop
    execute format('drop function if exists public.%I(uuid, jsonb)', n);
    execute format($w$
      create function public.%1$I(p_shop uuid, p_event jsonb) returns void
      language plpgsql security definer set search_path to '' as $f$
      begin
        perform private.assert_job_branch(p_shop, p_event->'data'->>'id');
        perform private.%2$I(p_shop, p_event);
      end $f$;$w$, n, n || '_core');
    execute format('revoke all on function public.%I(uuid, jsonb) from public, anon', n);
    execute format('grant execute on function public.%I(uuid, jsonb) to authenticated', n);
  end loop;
end $m$;

drop function if exists public.apply_ledger_event(uuid, jsonb);
create function public.apply_ledger_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  if p_event->>'kind' in ('job.created', 'payment.recorded') then
    raise exception 'Sales and payments are recorded through checkout. Update the app and try again.' using errcode = '42501';
  end if;
  perform private.apply_ledger_event_core(p_shop, p_event);
end $f$;
revoke all on function public.apply_ledger_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_ledger_event(uuid, jsonb) to authenticated;
