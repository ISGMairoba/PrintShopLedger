-- Part orders: a job of many items (200 jotters) made and collected in batches.
-- * job.done_recorded: how many are done so far (0 to the job's quantity, never below what is
--   collected). Not needed once the job is Completed: then everything is done.
-- * job.handed_over: the customer takes some of what is ready, with who collected and a note. The
--   handover that takes the last items closes the job (Completed → Collected); before Completed
--   the last items cannot be handed over, so stage checks (materials, holds) are never skipped.
-- * The business decides whether a part must be paid for first: settings.options.handoverPayment
--   'require' needs the job's payments to cover its share of the price for everything collected
--   after the handover; anything else (the usual 'warn') only warns in the app.
-- Anyone in the business who can move jobs may record both. The app applies the same rules
-- (src/job-handover.mjs); keep them in step.
create or replace function public.apply_job_handover_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare d jsonb := p_event->'data'; e uuid := (p_event->>'id')::uuid; k text := p_event->>'kind'; j public.jobs%rowtype; payload jsonb; actor uuid; label text;
  meta jsonb; prog jsonb; total numeric; collected numeric; done numeric; qty numeric; ready numeric; finished boolean;
  who text; note text; hid uuid; rule text; paid bigint; due numeric; last boolean := false;
begin
  perform private.assert_sync_dependencies(p_shop, p_event);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;
  if k not in ('job.done_recorded', 'job.handed_over') or (d->>'modifiedBy')::uuid is distinct from auth.uid() or e is null then raise exception 'Invalid audit identity'; end if;
  perform 1 from public.shops where id = p_shop for update;
  select le.payload, le.actor_id into payload, actor from public.ledger_events le where shop_id = p_shop and id = e;
  if found then if payload <> p_event or actor <> auth.uid() then raise exception 'Operation ID already used'; end if; return; end if;
  select * into j from public.jobs where shop_id = p_shop and id = (d->>'id')::uuid for update;
  if not found then raise exception 'Job not found'; end if;
  if j.version is distinct from (d->>'baseVersion')::integer then raise exception 'Job changed. Review the latest version.' using errcode = 'PT409'; end if;
  meta := j.metadata;
  if jsonb_typeof(meta->'quantity') is distinct from 'number' or (meta->>'quantity')::numeric < 2 or (meta->>'quantity')::numeric <> trunc((meta->>'quantity')::numeric)
     or j.production_status in ('Collected', 'Cancelled') then
    raise exception 'This job cannot be handed over in parts' using errcode = 'PT409';
  end if;
  total := (meta->>'quantity')::numeric;
  finished := j.production_status = 'Completed';
  prog := coalesce(meta->'progress', '{"done":0,"handovers":[]}'::jsonb);
  select coalesce(sum((h->>'quantity')::numeric), 0) into collected from jsonb_array_elements(coalesce(prog->'handovers', '[]')) h;
  done := case when finished then total else greatest(coalesce((prog->>'done')::numeric, 0), collected) end;
  select name into label from public.shop_members where shop_id = p_shop and user_id = auth.uid();
  if k = 'job.done_recorded' then
    if finished then raise exception 'This job is already finished' using errcode = 'PT409'; end if;
    if jsonb_typeof(d->'done') is distinct from 'number' or (d->>'done')::numeric <> trunc((d->>'done')::numeric) or (d->>'done')::numeric not between 0 and total then
      raise exception 'Enter a whole number from 0 to %', total;
    end if;
    if (d->>'done')::numeric < collected then raise exception '% are already collected', collected using errcode = 'PT409'; end if;
    prog := prog || jsonb_build_object('done', (d->>'done')::numeric, 'doneByLabel', label, 'doneAt', now());
  else
    if meta ? 'hold' then raise exception 'This job is on hold. Resume it first.' using errcode = 'PT409'; end if;
    if jsonb_typeof(d->'quantity') is distinct from 'number' or (d->>'quantity')::numeric <> trunc((d->>'quantity')::numeric) or (d->>'quantity')::numeric < 1 then
      raise exception 'Enter how many the customer is taking';
    end if;
    qty := (d->>'quantity')::numeric;
    ready := done - collected;
    if qty > ready then raise exception 'Only % ready to hand over', ready using errcode = 'PT409'; end if;
    last := collected + qty >= total;
    if last and not finished then raise exception 'This hands over everything. Mark the job Completed first.' using errcode = 'PT409'; end if;
    who := btrim(coalesce(d->>'collectedBy', '')); note := btrim(coalesce(d->>'note', ''));
    if length(who) > 80 or length(note) > 300 or who ~ '[\x00-\x1f\x7f]' or note ~ '[\x00-\x1f\x7f]' then raise exception 'Keep the name to 80 and the note to 300 characters'; end if;
    if coalesce(d->>'handoverId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid handover'; end if;
    hid := (d->>'handoverId')::uuid;
    if exists (select 1 from jsonb_array_elements(coalesce(prog->'handovers', '[]')) h where h->>'id' = hid::text) then raise exception 'Invalid handover'; end if;
    select b.settings->'options'->>'handoverPayment' into rule from public.business_settings b where b.shop_id = p_shop;
    if rule = 'require' then
      select coalesce(sum(pa.amount), 0) into paid from public.payment_allocations pa where pa.shop_id = p_shop and pa.job_id = j.id;
      due := ceil(j.amount * (collected + qty) / total);
      if paid < due then raise exception 'This part is not paid for yet. Receive the payment first.' using errcode = 'PT409'; end if;
    end if;
    prog := jsonb_set(prog, '{handovers}', (
      select coalesce(jsonb_agg(x.v order by x.n), '[]') from (
        select v, n from jsonb_array_elements(coalesce(prog->'handovers', '[]') || jsonb_build_array(jsonb_build_object(
          'id', hid, 'quantity', qty, 'collectedBy', who, 'note', note, 'at', now(), 'byLabel', label))) with ordinality h(v, n)
        order by n desc limit 200) x));
    if not prog ? 'done' then prog := prog || '{"done":0}'; end if;
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, e, auth.uid(), p_event);
  update public.jobs set
    metadata = meta || jsonb_build_object('progress', prog) || case when last then jsonb_build_object('stageAt', now(), 'stageHeldMs', 0) else '{}'::jsonb end,
    production_status = case when last then 'Collected' else production_status end,
    version = version + 1, modified_by = auth.uid(), modified_by_label = label, modified_at = now(), last_event_id = e
   where shop_id = p_shop and id = j.id;
end $f$;
revoke all on function public.apply_job_handover_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_job_handover_event(uuid, jsonb) to authenticated;
