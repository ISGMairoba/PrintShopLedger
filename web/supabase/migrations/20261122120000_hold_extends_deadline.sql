-- Holding a job can extend its deadline: "Hold and extend deadline" keeps extendDeadline on the hold,
-- and resuming moves dueAt later by the time on hold, with a due-date history entry (as the app does
-- in job-hold.mjs). Everything else about holds is unchanged.

-- A due time as written by the app (ISO text), or null when missing or unreadable.
create or replace function private.due_time(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}T' then return null; end if;
  return p::timestamptz;
exception when others then return null;
end $$;
revoke all on function private.due_time(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION private.apply_job_hold_event_core(p_shop uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; k text := p_event->>'kind'; j public.jobs%rowtype; payload jsonb; actor uuid; label text;
  note text; hold jsonb; held_ms bigint; meta jsonb; due timestamptz; moved text;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if k not in ('job.held', 'job.resumed') or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  meta := j.metadata;
  if k = 'job.held' then
    if meta ? 'hold' then raise exception 'This job is already on hold' using errcode = 'PT409'; end if;
    if j.production_status in ('Completed', 'Collected', 'Cancelled') then raise exception 'Only jobs still in production can be put on hold' using errcode = 'PT409'; end if;
    if coalesce(d->>'reason', '') not in ('Waiting for design approval', 'Waiting for balance payment', 'Waiting for materials', 'Customer not reachable', 'Other') then raise exception 'Choose why the job is on hold'; end if;
    note := btrim(coalesce(d->>'note', ''));
    if length(note) > 300 then raise exception 'Keep the note to 300 characters'; end if;
    if d->>'reason' = 'Other' and note = '' then raise exception 'Say what the job is waiting for'; end if;
    meta := meta || jsonb_build_object('hold', jsonb_build_object('reason', d->>'reason', 'note', note, 'heldBy', auth.uid(), 'heldByLabel', label, 'heldAt', now(), 'stage', j.production_status)
      -- Extend the deadline by the time on hold (applied when resumed): only for a job with a deadline.
      || case when d->'extendDeadline' = 'true'::jsonb and private.due_time(meta->>'dueAt') is not null
              then jsonb_build_object('extendDeadline', true) else '{}'::jsonb end);
  else
    if not meta ? 'hold' then raise exception 'This job is not on hold' using errcode = 'PT409'; end if;
    hold := meta->'hold';
    held_ms := greatest(0, (extract(epoch from now() - (hold->>'heldAt')::timestamptz) * 1000)::bigint);
    due := private.due_time(meta->>'dueAt');
    if hold->'extendDeadline' = 'true'::jsonb and due is not null and held_ms > 0 then
      moved := to_char((due + held_ms * interval '1 millisecond') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      meta := meta || jsonb_build_object('dueAt', moved, 'dueHistory', coalesce(meta->'dueHistory', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', e, 'from', meta->>'dueAt', 'to', moved,
        'reason', 'On hold: ' || (hold->>'reason') || ' (deadline extended by the time on hold)',
        'changedBy', label, 'changedAt', now())));
    end if;
    meta := (meta - 'hold') || jsonb_build_object(
      'stageHeldMs', coalesce((meta->>'stageHeldMs')::bigint, 0) + case when hold->>'stage' = j.production_status then held_ms else 0 end,
      'holdHistory', (select coalesce(jsonb_agg(x.v order by x.n), '[]') from (
          select v, n from jsonb_array_elements(coalesce(meta->'holdHistory', '[]') || jsonb_build_array(hold || jsonb_build_object('resumedBy', auth.uid(), 'resumedByLabel', label, 'resumedAt', now()))) with ordinality h(v, n)
          order by n desc limit 50) x));
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.jobs set metadata = meta, version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = j.id;
end $function$;
revoke all on function private.apply_job_hold_event_core(uuid, jsonb) from public, anon, authenticated;
