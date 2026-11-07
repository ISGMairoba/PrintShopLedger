-- "Too long at this stage": a job records when it entered its current stage (stageAt), set when it
-- moves to the next stage. Jobs already at a stage count from their last change.
do $patch$
declare d text := pg_get_functiondef('public.apply_job_status_event(uuid,jsonb)'::regprocedure);
  pat text := $$update public.jobs set production_status=next_status,$$;
begin
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then raise exception 'apply_job_status_event pattern not found exactly once'; end if;
  execute replace(d, pat, $$update public.jobs set metadata=metadata||jsonb_build_object('stageAt',now()),production_status=next_status,$$);
end $patch$;
