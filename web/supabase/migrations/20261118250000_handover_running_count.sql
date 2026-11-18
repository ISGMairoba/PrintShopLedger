-- Part orders keep a running count of items collected (progress.collected), so the total stays
-- right after the handover list is cut to its latest 200 (plans/audit-1-review.md, AUD-07).
-- Jobs from before this add up their handovers once, as before.
do $m$
declare f regprocedure := 'private.apply_job_handover_event_core(uuid,jsonb)'::regprocedure;
  d text := pg_get_functiondef(f); t text; n text; i integer;
  pairs text[] := array[
    -- Removing the latest handover: the count before, then less the removed items.
    $x$select coalesce(sum((h->>'quantity')::numeric), 0) into collected from jsonb_array_elements(prog->'handovers') h;$x$,
    $x$collected := coalesce((prog->>'collected')::numeric, (select coalesce(sum((h->>'quantity')::numeric), 0) from jsonb_array_elements(prog->'handovers') h));$x$,
    $x$prog := jsonb_set(prog, '{handovers}', (prog->'handovers') - (cnt - 1));$x$,
    $x$prog := jsonb_set(prog, '{handovers}', (prog->'handovers') - (cnt - 1)) || jsonb_build_object('collected', collected - (removed->>'quantity')::numeric);$x$,
    -- Recording done or a handover: the count so far.
    $x$select coalesce(sum((h->>'quantity')::numeric), 0) into collected from jsonb_array_elements(coalesce(prog->'handovers', '[]')) h;$x$,
    $x$collected := coalesce((prog->>'collected')::numeric, (select coalesce(sum((h->>'quantity')::numeric), 0) from jsonb_array_elements(coalesce(prog->'handovers', '[]')) h));$x$,
    -- A handover adds its items.
    $x$order by n desc limit 200) x));$x$,
    $x$order by n desc limit 200) x)) || jsonb_build_object('collected', collected + qty);$x$];
begin
  if position('''collected'', collected + qty' in d) > 0 then return; end if;
  for i in 1 .. array_length(pairs, 1) by 2 loop
    t := pairs[i]; n := pairs[i + 1];
    if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then
      raise exception 'apply_job_handover_event_core: pattern % not found once', (i + 1) / 2;
    end if;
    d := replace(d, t, n);
  end loop;
  execute d;
end $m$;
