-- Team work (plans/job-assignment.md), part A and the confirming of work records:
--   * Business Settings → Jobs & payments → Track team work (teamWork.enabled, off by default; only a
--     General Manager or higher can switch it). Its smaller choices are checked here too.
--   * Team: app users are on it automatically; anyone else is added by name (teamPeople).
--   * Assigning a whole job or one stage to one or more Team people (jobAssignments).
--   * Work records: who did a stage (Done by, with shares), when it was really done (Done at) against
--     when it was recorded (Recorded at, the server's clock), redo and outside work (workRecords).
--   * Confirming work records (Admin and above; nobody confirms their own unless no one else can).
-- With the switch off nothing here is offered; the stage moves keep their own record as before.

create table if not exists public.team_records (
  shop_id uuid not null references public.shops(id) on delete cascade,
  collection text not null check (collection in ('teamPeople', 'jobAssignments', 'workRecords', 'workCorrections', 'teamTerms')),
  id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  branch_id text,
  sync_xid xid8 not null default pg_current_xact_id(),
  primary key (shop_id, collection, id)
);
create index if not exists team_records_job on public.team_records (shop_id, (data->>'jobId')) where collection <> 'teamPeople';
create index if not exists team_records_xid on public.team_records (shop_id, sync_xid);
alter table public.team_records enable row level security;
drop policy if exists member_read on public.team_records;
create policy member_read on public.team_records for select to authenticated
  using (shop_id in (select private.my_shops()) and current_setting('psl.ledger', true) = 'on');
revoke insert, update, delete on public.team_records from anon, authenticated;
drop trigger if exists touch_sync_xid on public.team_records;
create trigger touch_sync_xid before insert or update on public.team_records
  for each row execute function private.touch_sync_xid();

-- The Team work choices, with their defaults.
create or replace function private.team_settings(p_shop uuid) returns jsonb
language sql stable security definer set search_path to '' as $f$
  select jsonb_build_object('enabled', false, 'askDoneBy', true, 'othersRank', 2, 'earlierRank', 2, 'doneAtDays', 7,
    'needsConfirming', true, 'confirmRank', 2, 'assignRank', 2, 'correctRank', 2, 'termsRank', 4, 'correctionDays', 7)
    || coalesce((select settings->'teamWork' from public.business_settings where shop_id = p_shop), '{}'::jsonb)
$f$;
revoke all on function private.team_settings(uuid) from public, anon, authenticated;

create or replace function private.check_team_settings() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare t jsonb := new.settings->'teamWork'; was jsonb; lvl int; k text;
begin
  if tg_op = 'UPDATE' then was := old.settings->'teamWork'; end if;
  -- Switching Team work on or off: General Manager or higher (the console, with no signed-in person, may).
  if coalesce((t->>'enabled')::boolean, false) is distinct from coalesce((was->>'enabled')::boolean, false) and auth.uid() is not null then
    select access_level into lvl from public.shop_members where shop_id = new.shop_id and user_id = auth.uid() and not archived;
    if coalesce(lvl, 0) < 4 then raise exception 'Only a General Manager or higher can switch Team work on or off'; end if;
  end if;
  if t is null then return new; end if;
  if jsonb_typeof(t) is distinct from 'object' then raise exception 'Invalid Team work settings'; end if;
  for k in select jsonb_object_keys(t) loop
    if k in ('enabled', 'askDoneBy', 'needsConfirming', 'commission') then
      if jsonb_typeof(t->k) is distinct from 'boolean' then raise exception 'Invalid Team work setting %', k; end if;
    elsif k in ('othersRank', 'earlierRank', 'confirmRank', 'assignRank', 'correctRank', 'termsRank') then
      if coalesce(t->>k, '') not in ('1', '2', '3', '4') then raise exception 'Choose a rank for %', k; end if;
    elsif k = 'usual' then
      -- The usual people per stage, assigned to new jobs at checkout: { stage: [person ids] }.
      if jsonb_typeof(t->k) is distinct from 'object' or exists (select 1 from jsonb_each(t->k) e
          where jsonb_typeof(e.value) <> 'array' or jsonb_array_length(e.value) > 20 or length(e.key) > 60
             or exists (select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x) <> 'string' or (x#>>'{}') !~ '^[0-9a-f-]{36}$')) then
        raise exception 'Invalid usual people per stage';
      end if;
    elsif k in ('doneAtDays', 'correctionDays') then
      if jsonb_typeof(t->k) is distinct from 'number' or (t->>k) !~ '^[0-9]+$' or (t->>k)::int not between 0 and 90 then
        raise exception 'Choose 0 to 90 days for %', k;
      end if;
    else raise exception 'Unknown Team work setting %', k;
    end if;
  end loop;
  return new;
end $f$;
drop trigger if exists check_team_settings on public.business_settings;
create trigger check_team_settings before insert or update on public.business_settings
  for each row execute function private.check_team_settings();

-- Whether a person is on this business's Team (an app user, or a person added by name).
create or replace function private.team_person(p_shop uuid, p_id uuid, p_active boolean default true) returns boolean
language sql stable security definer set search_path to '' as $f$
  select exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = p_id and m.access_level >= 1
                   and (not p_active or not m.archived))
      or exists (select 1 from public.team_records r where r.shop_id = p_shop and r.collection = 'teamPeople' and r.id = p_id
                   and (not p_active or not coalesce((r.data->>'archived')::boolean, false)))
$f$;
revoke all on function private.team_person(uuid, uuid, boolean) from public, anon, authenticated;

-- Checks a work record's Done by: shares (percent adding up to 100, or quantities up to the job's),
-- an outside vendor, a redo. Returns how many people credited are not the person saving it.
create or replace function private.team_check_work(p_shop uuid, p_job uuid, d jsonb) returns int
language plpgsql stable security definer set search_path to '' as $f$
declare j record; s jsonb; total numeric := 0; others int := 0; unit text := coalesce(d->>'unit', 'percent'); me uuid := auth.uid();
begin
  select * into j from public.jobs where shop_id = p_shop and id = p_job;
    if unit not in ('percent', 'quantity') or jsonb_typeof(d->'shares') is distinct from 'array' or jsonb_array_length(d->'shares') > 20 then
      raise exception 'Invalid shares';
    end if;
    if jsonb_array_length(d->'shares') = 0 and jsonb_typeof(d->'vendor') is distinct from 'object' then
      raise exception 'Choose who did the work, or an outside vendor';
    end if;
    for s in select value from jsonb_array_elements(d->'shares') loop
      if not private.team_person(p_shop, (s->>'personId')::uuid) then raise exception 'Choose people on the Team'; end if;
      if jsonb_typeof(s->'share') is distinct from 'number' or (s->>'share')::numeric <= 0 then raise exception 'Each share must be more than 0'; end if;
      total := total + (s->>'share')::numeric;
      if (s->>'personId')::uuid is distinct from me then others := others + 1; end if;
    end loop;
    if jsonb_array_length(d->'shares') > 0 then
      if unit = 'percent' and abs(total - 100) > 0.01 then raise exception 'The shares must add up to 100%%'; end if;
      if unit = 'quantity' and coalesce((j.metadata->>'quantity')::numeric, 0) > 0 and total > (j.metadata->>'quantity')::numeric then
        raise exception 'The quantities add up to more than the job''s %', j.metadata->>'quantity';
      end if;
    end if;
    if d ? 'redo' and (jsonb_typeof(d->'redo') <> 'object' or (nullif(d->'redo'->>'responsibleId', '') is not null
        and not private.team_person(p_shop, (d->'redo'->>'responsibleId')::uuid, false)) or length(coalesce(d->'redo'->>'note', '')) > 300) then
      raise exception 'Invalid redo';
    end if;
    if d ? 'vendor' and (jsonb_typeof(d->'vendor') <> 'object' or length(btrim(coalesce(d->'vendor'->>'name', ''))) not between 1 and 120
        or jsonb_typeof(d->'vendor'->'cost') <> 'number' or (d->'vendor'->>'cost')::numeric < 0 or (d->'vendor'->>'cost')::numeric > 100000000000) then
      raise exception 'Enter the vendor''s name and cost';
    end if;
  return others;
end $f$;
revoke all on function private.team_check_work(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.apply_team_event(p_shop uuid, p_event jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare
  k text := p_event->>'kind'; d jsonb := p_event->'data'; tw jsonb; lvl int; label text; me uuid := auth.uid();
  rid uuid; existing record; j record; flow jsonb; stage_at int; now_at int; done timestamptz; s jsonb; total numeric := 0;
  unit text; status text; ids uuid[]; x uuid; credited boolean; others int; nxt jsonb;
begin
  select n.lvl, n.label into lvl, label from private.notice_member(p_shop) n;
  if lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  tw := private.team_settings(p_shop);
  if not coalesce((tw->>'enabled')::boolean, false) then raise exception 'Team work is switched off for this business'; end if;
  if jsonb_typeof(d) is distinct from 'object' or nullif(d->>'id', '') is null or nullif(p_event->>'id', '') is null then
    raise exception 'Invalid team change';
  end if;
  begin rid := (d->>'id')::uuid; exception when others then raise exception 'Invalid team change'; end;
  -- An event already applied is not applied twice.
  if exists (select 1 from public.ledger_events e where e.shop_id = p_shop and e.id = (p_event->>'id')::uuid) then return; end if;

  if k = 'team.person_saved' then
    if lvl < 2 then raise exception 'Only an Admin or higher can change the Team'; end if;
    if exists (select 1 from public.shop_members where shop_id = p_shop and user_id = rid) then
      raise exception 'App users are on the Team already; change them on the Users page';
    end if;
    if length(btrim(coalesce(d->>'name', ''))) not between 1 and 80 or length(coalesce(d->>'role', '')) > 60
       or length(coalesce(d->>'phone', '')) > 40 or (d ? 'archived' and jsonb_typeof(d->'archived') <> 'boolean')
       or (d ? 'branchId' and jsonb_typeof(d->'branchId') not in ('string', 'null')) then
      raise exception 'Enter a name (up to 80 letters), role and phone';
    end if;
    select * into existing from public.team_records where shop_id = p_shop and collection = 'teamPeople' and id = rid for update;
    if coalesce((existing.data->>'version')::int, 0) <> coalesce((d->>'baseVersion')::int, 0) then
      raise exception 'This person was changed elsewhere. Close and try again.' using errcode = 'PT409';
    end if;
    nxt := jsonb_build_object('id', rid, 'name', btrim(d->>'name'), 'role', btrim(coalesce(d->>'role', '')),
      'phone', btrim(coalesce(d->>'phone', '')), 'branchId', d->'branchId', 'archived', coalesce((d->>'archived')::boolean, false),
      'version', coalesce((existing.data->>'version')::int, 0) + 1,
      'createdAt', coalesce(existing.data->>'createdAt', now()::text), 'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now());
    insert into public.team_records(shop_id, collection, id, data, branch_id) values (p_shop, 'teamPeople', rid, nxt, nullif(d->>'branchId', ''))
      on conflict (shop_id, collection, id) do update set data = excluded.data, branch_id = excluded.branch_id;

  elsif k = 'team.assigned' then
    -- The usual people for a stage (Business Settings) are assigned at checkout by whoever sells it.
    if lvl < (tw->>'assignRank')::int and not (coalesce((d->>'usual')::boolean, false) and coalesce(d->>'stage', '') <> ''
        and coalesce((d->>'baseVersion')::int, 0) = 0
        and (tw->'usual'->(d->>'stage')) @> (d->'personIds') and (d->'personIds') @> (tw->'usual'->(d->>'stage'))) then
      raise exception 'You cannot assign work';
    end if;
    select * into j from public.jobs where shop_id = p_shop and id = (d->>'jobId')::uuid;
    if not found then raise exception 'Job not found'; end if;
    flow := coalesce(j.metadata->'workflow', '["Added","In Queue","Printing","Completed","Collected"]'::jsonb);
    if coalesce(d->>'stage', '') <> '' and not flow ? (d->>'stage') then raise exception 'Choose a stage of this job'; end if;
    if jsonb_typeof(d->'personIds') is distinct from 'array' or jsonb_array_length(d->'personIds') > 20 then
      raise exception 'Choose up to 20 people';
    end if;
    for s in select value from jsonb_array_elements(d->'personIds') loop
      if not private.team_person(p_shop, (s#>>'{}')::uuid) then raise exception 'Choose people on the Team'; end if;
    end loop;
    select * into existing from public.team_records where shop_id = p_shop and collection = 'jobAssignments' and id = rid for update;
    if found and (existing.data->>'jobId' <> d->>'jobId' or coalesce(existing.data->>'stage', '') <> coalesce(d->>'stage', '')) then
      raise exception 'Invalid assignment';
    end if;
    if coalesce((existing.data->>'version')::int, 0) <> coalesce((d->>'baseVersion')::int, 0) then
      raise exception 'Someone else changed who is assigned. Close and try again.' using errcode = 'PT409';
    end if;
    nxt := jsonb_build_object('id', rid, 'jobId', j.id, 'stage', coalesce(d->>'stage', ''),
      'personIds', (select coalesce(jsonb_agg(distinct value), '[]'::jsonb) from jsonb_array_elements(d->'personIds')),
      'version', coalesce((existing.data->>'version')::int, 0) + 1, 'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now());
    insert into public.team_records(shop_id, collection, id, data, branch_id) values (p_shop, 'jobAssignments', rid, nxt, j.branch_id)
      on conflict (shop_id, collection, id) do update set data = excluded.data, branch_id = excluded.branch_id;

  elsif k = 'team.work_recorded' then
    if exists (select 1 from public.team_records where shop_id = p_shop and collection = 'workRecords' and id = rid) then
      raise exception 'This work is recorded already' using errcode = 'PT409';
    end if;
    select * into j from public.jobs where shop_id = p_shop and id = (d->>'jobId')::uuid;
    if not found then raise exception 'Job not found'; end if;
    flow := coalesce(j.metadata->'workflow', '["Added","In Queue","Printing","Completed","Collected"]'::jsonb);
    select ord into stage_at from jsonb_array_elements_text(flow) with ordinality f(v, ord) where v = d->>'stage';
    select ord into now_at from jsonb_array_elements_text(flow) with ordinality f(v, ord) where v = j.production_status;
    if stage_at is null or now_at is null or stage_at >= now_at then raise exception 'Record work for a stage the job has finished'; end if;
    -- Done at: not in the future, not before the window, and earlier than now only for those allowed.
    begin done := (d->>'doneAt')::timestamptz; exception when others then raise exception 'Enter when the work was done'; end;
    if done > now() + interval '5 minutes' then raise exception 'Done at cannot be in the future'; end if;
    if done < now() - make_interval(days => (tw->>'doneAtDays')::int) - interval '15 minutes' then
      raise exception 'Done at can be at most % days back', tw->>'doneAtDays';
    end if;
    if done < now() - interval '15 minutes' and lvl < (tw->>'earlierRank')::int then
      raise exception 'You cannot record an earlier Done at';
    end if;
    unit := coalesce(d->>'unit', 'percent');
    others := private.team_check_work(p_shop, j.id, d);
    -- Recording work for someone else: those allowed, or the people assigned when "Done by" is not asked.
    if others > 0 and lvl < (tw->>'othersRank')::int then
      if coalesce((d->>'auto')::boolean, false) and not coalesce((tw->>'askDoneBy')::boolean, true) then
        if exists (select 1 from jsonb_array_elements(d->'shares') s2 where not exists (
          select 1 from public.team_records a where a.shop_id = p_shop and a.collection = 'jobAssignments' and a.data->>'jobId' = j.id::text
            and a.data->'personIds' ? (s2.value->>'personId'))) then
          raise exception 'You can record only your own work';
        end if;
      else raise exception 'You can record only your own work';
      end if;
    end if;
    -- Confirmed at once when no confirming is needed, or when someone who confirms records another's work.
    credited := exists (select 1 from jsonb_array_elements(d->'shares') s3 where (s3.value->>'personId')::uuid = me);
    status := case when not coalesce((tw->>'needsConfirming')::boolean, true) then 'confirmed'
                   when lvl >= (tw->>'confirmRank')::int and not credited then 'confirmed' else 'recorded' end;
    nxt := jsonb_build_object('id', rid, 'jobId', j.id, 'stage', d->>'stage', 'unit', unit, 'shares', d->'shares',
      'doneAt', done, 'recordedAt', now(), 'recordedBy', me, 'recordedByLabel', label, 'recordedByRank', lvl, 'status', status, 'version', 1)
      || case when status = 'confirmed' then jsonb_build_object('confirmedBy', me, 'confirmedByLabel', label, 'confirmedAt', now()) else '{}' end
      || case when d ? 'redo' then jsonb_build_object('redo', d->'redo') else '{}' end
      || case when d ? 'vendor' then jsonb_build_object('vendor', jsonb_build_object('name', btrim(d->'vendor'->>'name'), 'cost', round((d->'vendor'->>'cost')::numeric))) else '{}' end
      || case when length(btrim(coalesce(d->>'note', ''))) > 0 then jsonb_build_object('note', left(btrim(d->>'note'), 300)) else '{}' end;
    insert into public.team_records(shop_id, collection, id, data, branch_id) values (p_shop, 'workRecords', rid, nxt, j.branch_id);

  elsif k = 'team.work_confirmed' then
    if lvl < (tw->>'confirmRank')::int then raise exception 'You cannot confirm work'; end if;
    if jsonb_typeof(d->'recordIds') is distinct from 'array' or jsonb_array_length(d->'recordIds') not between 1 and 200 then
      raise exception 'Choose up to 200 work records';
    end if;
    -- Someone else who can confirm (an active member of that rank) confirms your own work.
    select count(*) into others from public.shop_members where shop_id = p_shop and not archived and access_level >= (tw->>'confirmRank')::int and user_id <> me;
    for s in select value from jsonb_array_elements(d->'recordIds') loop
      select * into existing from public.team_records where shop_id = p_shop and collection = 'workRecords' and id = (s#>>'{}')::uuid for update;
      if not found then raise exception 'Work record not found'; end if;
      if existing.data->>'status' = 'confirmed' then continue; end if;
      if others > 0 and exists (select 1 from jsonb_array_elements(existing.data->'shares') s4 where (s4.value->>'personId')::uuid = me) then
        raise exception 'Someone else confirms work you are credited with';
      end if;
      update public.team_records set data = data || jsonb_build_object('status', 'confirmed', 'confirmedBy', me, 'confirmedByLabel', label,
          'confirmedAt', now(), 'version', (data->>'version')::int + 1)
        where shop_id = p_shop and collection = 'workRecords' and id = existing.id;
    end loop;
  elsif k = 'team.terms_set' then
    -- Commission terms per person (pay): General Manager and above by default (termsRank).
    if lvl < (tw->>'termsRank')::int then raise exception 'You cannot set commission terms'; end if;
    if not private.team_person(p_shop, rid, false) then raise exception 'Choose someone on the Team'; end if;
    if jsonb_typeof(d->'commission') not in ('object', 'null') or (jsonb_typeof(d->'commission') = 'object' and (
         coalesce(d->'commission'->>'kind', '') not in ('none', 'percent', 'perJob', 'perStage', 'perUnit')
         or jsonb_typeof(d->'commission'->'rate') is distinct from 'number' or (d->'commission'->>'rate')::numeric < 0
         or (d->'commission'->>'kind' = 'percent' and (d->'commission'->>'rate')::numeric > 100)
         or (d->'commission'->>'rate')::numeric > 100000000000
         or (d->'commission' ? 'salesRate' and (jsonb_typeof(d->'commission'->'salesRate') is distinct from 'number'
             or (d->'commission'->>'salesRate')::numeric not between 0 and 100)))) then
      raise exception 'Enter commission as a percent (0 to 100) or an amount';
    end if;
    select * into existing from public.team_records where shop_id = p_shop and collection = 'teamTerms' and id = rid for update;
    if coalesce((existing.data->>'version')::int, 0) <> coalesce((d->>'baseVersion')::int, 0) then
      raise exception 'These terms were changed elsewhere. Close and try again.' using errcode = 'PT409';
    end if;
    nxt := jsonb_build_object('id', rid, 'commission', d->'commission', 'version', coalesce((existing.data->>'version')::int, 0) + 1,
      'modifiedBy', me, 'modifiedByLabel', label, 'modifiedAt', now());
    insert into public.team_records(shop_id, collection, id, data) values (p_shop, 'teamTerms', rid, nxt)
      on conflict (shop_id, collection, id) do update set data = excluded.data;

  elsif k = 'team.work_corrected' then
    -- A correction (plans/job-assignment.md, owner's rule of 23 Nov): saved at once by someone cleared
    -- (correctRank), or sent for approval. An entry recorded by a higher rank needs that rank or above
    -- to approve, except a Manager's correction, which goes through and alerts whoever recorded it.
    select * into existing from public.team_records where shop_id = p_shop and collection = 'workRecords' and id = (d->>'recordId')::uuid for update;
    if not found then raise exception 'Work record not found'; end if;
    if coalesce((existing.data->>'version')::int, 1) <> coalesce((d->>'baseVersion')::int, -1) then
      raise exception 'This work record was changed elsewhere. Close and try again.' using errcode = 'PT409';
    end if;
    if length(btrim(coalesce(d->>'reason', ''))) not between 3 and 300 then raise exception 'Give a reason for the correction'; end if;
    select * into j from public.jobs where shop_id = p_shop and id = (existing.data->>'jobId')::uuid;
    if j.production_status = 'Collected' and coalesce((j.metadata->>'stageAt')::timestamptz, j.modified_at, now())
        < now() - make_interval(days => (tw->>'correctionDays')::int) then
      raise exception 'Work records can be corrected up to % days after the job is collected', tw->>'correctionDays';
    end if;
    if jsonb_typeof(d->'changes') is distinct from 'object' then raise exception 'Invalid correction'; end if;
    perform private.team_check_work(p_shop, j.id, d->'changes');
    begin done := (d->'changes'->>'doneAt')::timestamptz; exception when others then raise exception 'Enter when the work was done'; end;
    if done is null or done > now() + interval '5 minutes' or done < j.created_at - interval '1 minute' then
      raise exception 'Done at must be after the job was added and not in the future';
    end if;
    status := case
      when coalesce((existing.data->>'recordedByRank')::int, 0) > lvl and lvl = 3 and lvl >= (tw->>'correctRank')::int then 'alert'
      when coalesce((existing.data->>'recordedByRank')::int, 0) > lvl then 'request'
      when lvl >= (tw->>'correctRank')::int then 'direct'
      else 'request' end;
    nxt := jsonb_build_object('unit', coalesce(d->'changes'->>'unit', 'percent'), 'shares', d->'changes'->'shares', 'doneAt', done)
      || case when d->'changes' ? 'redo' then jsonb_build_object('redo', d->'changes'->'redo') else '{}' end
      || case when d->'changes' ? 'vendor' then jsonb_build_object('vendor', jsonb_build_object('name', btrim(d->'changes'->'vendor'->>'name'),
           'cost', round((d->'changes'->'vendor'->>'cost')::numeric))) else '{}' end;
    if status = 'request' then
      insert into public.team_records(shop_id, collection, id, data, branch_id) values (p_shop, 'workCorrections', rid,
        jsonb_build_object('id', rid, 'recordId', existing.id, 'jobId', j.id, 'baseVersion', (existing.data->>'version')::int,
          'changes', nxt, 'reason', btrim(d->>'reason'), 'requestedBy', me, 'requestedByLabel', label, 'requestedByRank', lvl,
          'approverRank', greatest((tw->>'correctRank')::int, coalesce((existing.data->>'recordedByRank')::int, 0)),
          'status', 'pending', 'requestedAt', now(), 'version', 1),
        existing.branch_id);
    else
      update public.team_records set data = (data - 'redo' - 'vendor') || nxt || jsonb_build_object('version', (data->>'version')::int + 1,
          'corrections', coalesce(data->'corrections', '[]') || jsonb_build_array(jsonb_build_object('at', now(), 'by', me, 'byLabel', label,
            'byRank', lvl, 'reason', btrim(d->>'reason'), 'before', data - 'corrections' - 'id' - 'jobId' - 'stage' - 'version',
            'alert', status = 'alert', 'alertFor', case when status = 'alert' then data->>'recordedBy' end)))
        where shop_id = p_shop and collection = 'workRecords' and id = existing.id;
    end if;

  elsif k = 'team.correction_decided' then
    select * into existing from public.team_records where shop_id = p_shop and collection = 'workCorrections' and id = (d->>'requestId')::uuid for update;
    if not found or existing.data->>'status' <> 'pending' then raise exception 'This request is not waiting for a decision'; end if;
    if lvl < (existing.data->>'approverRank')::int then raise exception 'This correction needs someone of a higher rank'; end if;
    if (existing.data->>'requestedBy')::uuid = me then raise exception 'Someone else decides your own correction'; end if;
    if jsonb_typeof(d->'approve') is distinct from 'boolean' then raise exception 'Approve or decline the correction'; end if;
    if (d->>'approve')::boolean then
      update public.team_records r set data = (r.data - 'redo' - 'vendor') || (existing.data->'changes') || jsonb_build_object(
          'version', (r.data->>'version')::int + 1, 'status', 'confirmed', 'confirmedBy', me, 'confirmedByLabel', label, 'confirmedAt', now(),
          'corrections', coalesce(r.data->'corrections', '[]') || jsonb_build_array(jsonb_build_object('at', now(), 'by', existing.data->'requestedBy',
            'byLabel', existing.data->>'requestedByLabel', 'byRank', existing.data->'requestedByRank', 'reason', existing.data->>'reason',
            'approvedBy', me, 'approvedByLabel', label, 'before', r.data - 'corrections' - 'id' - 'jobId' - 'stage' - 'version')))
        where r.shop_id = p_shop and r.collection = 'workRecords' and r.id = (existing.data->>'recordId')::uuid
          and (r.data->>'version')::int = (existing.data->>'baseVersion')::int;
      if not found then raise exception 'The work record changed after this request. Decline it and ask again.' using errcode = 'PT409'; end if;
    end if;
    update public.team_records set data = data || jsonb_build_object('status', case when (d->>'approve')::boolean then 'approved' else 'declined' end,
        'decidedBy', me, 'decidedByLabel', label, 'decidedAt', now(), 'note', left(btrim(coalesce(d->>'note', '')), 300),
        'version', (data->>'version')::int + 1)
      where shop_id = p_shop and collection = 'workCorrections' and id = existing.id;
  else
    raise exception 'Unknown team change';
  end if;
  insert into public.ledger_events(shop_id, id, actor_id, payload) values (p_shop, (p_event->>'id')::uuid, me, p_event);
end $f$;
revoke all on function public.apply_team_event(uuid, jsonb) from public, anon;
grant execute on function public.apply_team_event(uuid, jsonb) to authenticated;

-- The Team for the download: every app user and person added (a branch sees its own and the
-- unassigned), assignments and work records (a branch sees its jobs'), all or changed since p_since.
create or replace function private.team_for(p_shop uuid, p_keep text, p_since xid8 default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $f$
begin
  if not public.is_shop_member(p_shop) then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'teamPeople', (select coalesce(jsonb_agg(p order by p->>'name'), '[]'::jsonb) from (
        select jsonb_build_object('id', m.user_id, 'name', coalesce(nullif(btrim(m.name), ''), m.username), 'userId', m.user_id,
          'role', case m.rank when 1 then 'Cashier' when 2 then 'Admin' when 3 then 'Manager' when 4 then 'General Manager' else 'Developer' end,
          'rank', m.access_level, 'member', true, 'archived', m.archived, 'version', m.version) p
          from public.shop_members m where m.shop_id = p_shop and m.access_level >= 1
        union all
        select r.data from public.team_records r where r.shop_id = p_shop and r.collection = 'teamPeople'
          and (p_since is null or r.sync_xid >= p_since) and (p_keep is null or r.branch_id is null or r.branch_id = p_keep)) people),
    'jobAssignments', (select coalesce(jsonb_agg(r.data order by r.data->>'modifiedAt', r.id), '[]'::jsonb) from public.team_records r
        where r.shop_id = p_shop and r.collection = 'jobAssignments' and (p_since is null or r.sync_xid >= p_since)
          and (p_keep is null or coalesce(r.branch_id, 'main') = p_keep)),
    'workRecords', (select coalesce(jsonb_agg(r.data order by r.data->>'recordedAt', r.id), '[]'::jsonb) from public.team_records r
        where r.shop_id = p_shop and r.collection = 'workRecords' and (p_since is null or r.sync_xid >= p_since)
          and (p_keep is null or coalesce(r.branch_id, 'main') = p_keep)),
    'workCorrections', (select coalesce(jsonb_agg(r.data order by r.data->>'requestedAt', r.id), '[]'::jsonb) from public.team_records r
        where r.shop_id = p_shop and r.collection = 'workCorrections' and (p_since is null or r.sync_xid >= p_since)
          and (p_keep is null or coalesce(r.branch_id, 'main') = p_keep)),
    -- Commission terms are pay: only those who set them, and each person their own, see them.
    'teamTerms', (select coalesce(jsonb_agg(r.data order by r.id), '[]'::jsonb) from public.team_records r
        where r.shop_id = p_shop and r.collection = 'teamTerms' and (p_since is null or r.sync_xid >= p_since)
          and (r.id = auth.uid() or coalesce((select n.lvl from private.notice_member(p_shop) n), 0) >= (private.team_settings(p_shop)->>'termsRank')::int)));
end $f$;
revoke all on function private.team_for(uuid, text, xid8) from public, anon;
grant execute on function private.team_for(uuid, text, xid8) to authenticated;

-- The download.
CREATE OR REPLACE FUNCTION public.get_ledger(p_shop uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  prev text := coalesce(current_setting('psl.ledger', true), '');
  result jsonb;
  v record;
  own boolean := false;
  br boolean;
  keep text;
begin
  if current_setting('psl.skip_ledger', true) = 'on' then return null; end if;
  perform set_config('psl.ledger', 'on', true);
  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;

  select * into v from private.branch_view(p_shop);
  br := coalesce(v.has_branches, false);
  keep := case when br then v.keep_branch end;
  -- A branch that keeps its own customers sees only those it serves.
  if br and keep is not null and keep <> 'main' then
    select exists (select 1 from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
                   where b.shop_id = p_shop and x->>'id' = keep and x->>'customers' = 'own') into own;
  end if;

  result := jsonb_build_object(
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'description',description,'materialId',material_id,'price',price,
        'shelfItem',shelf_item,'private',private,'costing',costing,'packPrices',pack_prices,'priceTiers',price_tiers,'customPrice',custom_price,
        'materialOptions',to_jsonb(material_options),'confirmStage',confirm_stage,'production',production,'variantGroup',variant_group,
        'variantName',variant_name,'archived',archived,'version',version,'createdBy',created_by,'createdByLabel',created_by_label,
        'createdAt',created_at,'modifiedBy',modified_by,'modifiedByLabel',modified_by_label,'modifiedAt',modified_at,'lastEventId',last_event_id,
        'icon',coalesce(icon,''),'category',coalesce(category,''),'code',coalesce(code,''),'tags',coalesce(tags,'[]'::jsonb),
        'soldAt',coalesce(sold_at,'[]'::jsonb),'minQuantity',coalesce(min_quantity,0))
      order by description,id), '[]'::jsonb) from public.services where shop_id=p_shop),
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'available', available, 'minimumStock', minimum_stock,
        'measurementUnit', measurement_unit, 'requireSize', require_size, 'canSplit', can_split, 'archived', archived, 'version', version,
        'createdBy', created_by, 'createdByLabel', created_by_label, 'createdAt', created_at, 'modifiedBy', modified_by,
        'modifiedByLabel', modified_by_label, 'modifiedAt', modified_at, 'lastEventId', last_event_id)
        || case when cost_price is not null then jsonb_build_object('costPrice', cost_price) else '{}'::jsonb end
      order by created_at, id), '[]'::jsonb)
      from public.materials where shop_id = p_shop),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'address', c.address,
        'creditLimit', c.credit_limit, 'archived', c.archived, 'version', c.version, 'createdAt', c.created_at, 'createdBy', c.created_by,
        'createdByLabel', c.created_by_label, 'modifiedBy', c.modified_by, 'modifiedByLabel', c.modified_by_label, 'modifiedAt', c.modified_at,
        'lastEventId', c.last_event_id, 'calledAs', coalesce(c.called_as, ''), 'branchId', coalesce(c.branch_id, 'main'),
        'creditLimits', coalesce(c.credit_limits, '{}'::jsonb), 'linkedBranches', to_jsonb(coalesce(c.linked_branches, '{}'::text[])))
      order by c.created_at, c.id), '[]'::jsonb)
      from public.customers c where c.shop_id = p_shop
        and (not own or coalesce(c.branch_id, 'main') = keep or keep = any(c.linked_branches)
          or exists (select 1 from public.jobs j where j.shop_id = p_shop and j.customer_id = c.id and j.branch_id = keep)
          or exists (select 1 from public.checkout_records k where k.shop_id = p_shop and k.customer_id = c.id and k.branch_id = keep)
          or exists (select 1 from public.payments p where p.shop_id = p_shop and p.customer_id = c.id and p.branch_id = keep)
          or exists (select 1 from public.quotations q where q.shop_id = p_shop and q.data->>'customerId' = c.id::text and q.branch_id = keep))),
    'jobs', (select coalesce(jsonb_agg(j.metadata||jsonb_build_object('id',j.id,'customerId',j.customer_id,'service',j.service,
        'description',j.description,'amount',j.amount,'createdAt',j.created_at,'productionStatus',j.production_status,'version',j.version,
        'modifiedBy',j.modified_by,'modifiedByLabel',j.modified_by_label,'modifiedAt',j.modified_at,'lastEventId',j.last_event_id)
        || case when br and j.branch_id is not null then jsonb_build_object('branchId', j.branch_id) else '{}'::jsonb end
      order by j.created_at,j.id),'[]'::jsonb)
      from public.jobs j where j.shop_id=p_shop and (keep is null or coalesce(j.branch_id,'main') = keep)),
    'payments', (select coalesce(jsonb_agg(x.v order by x.v->>'createdAt', x.v->>'id'), '[]'::jsonb) from (
      select jsonb_build_object('id',p.id,'customerId',p.customer_id,'amount',p.amount,'method',p.method,'paidOn',p.paid_on,
          'reference',p.reference,'createdAt',p.created_at,'walletUsed',p.wallet_used,'walletAdded',p.wallet_added,'checkoutId',p.checkout_id,
          'allocations',coalesce((select jsonb_agg(jsonb_build_object('jobId',a.job_id,'amount',a.amount) order by a.job_id)
            from public.payment_allocations a where a.shop_id=p_shop and a.payment_id=p.id),'[]'::jsonb))
        || case when cr.data ? 'methodLabel' then jsonb_build_object('methodLabel', cr.data->'methodLabel') else '{}'::jsonb end
        || case when sa.id is not null then jsonb_build_object('refundId', sa.id, 'methodLabel', sa.data->>'methodLabel') else '{}'::jsonb end
        || case when p.method_label is not null then jsonb_build_object('methodLabel', p.method_label) else '{}'::jsonb end
        || case when br and p.branch_id is not null then jsonb_build_object('branchId', p.branch_id) else '{}'::jsonb end v
      from public.payments p
      left join public.checkout_records cr on cr.shop_id=p_shop and cr.id=p.id
      left join public.sale_adjustments sa on sa.shop_id=p_shop and sa.id=p.id and sa.data->>'action'='sale.refunded'
      where p.shop_id=p_shop and (keep is null or coalesce(p.branch_id,'main') = keep)) x),
    'checkouts', (select coalesce(jsonb_agg(data||jsonb_build_object('drawerClosingId',drawer_closing_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.checkout_records where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'drawerClosings', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by closed_at,id),'[]'::jsonb)
      from public.drawer_closings where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'materialHistory', (select coalesce(jsonb_agg(x.v order by x.v->>'changedAt', x.v->>'id'), '[]'::jsonb) from (
      select jsonb_build_object('id',id,'materialId',material_id,'materialName',material_name,'measurementUnit',measurement_unit,
          'action',action,'beforeAvailable',before_available,'afterAvailable',after_available,'reason',reason,'changedBy',actor_id,
          'changedByLabel',actor_label,'changedAt',created_at,'before',before_values,'after',after_values,'detailsComplete',details_complete,
          'jobId',job_id,'checkoutId',checkout_id,'expenseId',expense_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
        -- What the line moved at, by the server's valuation (Actual cost method).
        || case when unit_cost is not null then jsonb_build_object('unitCost', round(unit_cost, 4), 'costActual', coalesce(cost_actual, false)) else '{}'::jsonb end v
      from public.material_stock_changes where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)) x),
    'expenses', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by data->>'incurredOn',id),'[]'::jsonb)
      from public.expenses where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'expenseHistory', (select coalesce(jsonb_agg(data order by data->>'changedAt',id),'[]'::jsonb) from public.expense_changes where shop_id=p_shop),
    'saleAdjustments', (select coalesce(jsonb_agg(data||jsonb_build_object('drawerClosingId',drawer_closing_id)
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.sale_adjustments where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'materialWaste', (select coalesce(jsonb_agg(data
        || case when br and branch_id is not null then jsonb_build_object('branchId', branch_id) else '{}'::jsonb end
      order by created_at,id),'[]'::jsonb)
      from public.material_waste where shop_id=p_shop and (keep is null or coalesce(branch_id,'main') = keep)),
    'quotations', (select coalesce(jsonb_agg(q.data
        || case when br and q.branch_id is not null then jsonb_build_object('branchId', q.branch_id) else '{}'::jsonb end
      order by q.data->>'createdAt', q.id), '[]'::jsonb)
      from public.quotations q where q.shop_id=p_shop and (keep is null or coalesce(q.branch_id,'main') = keep)),
    'reminders', (select coalesce(jsonb_agg(r.data
        || case when br and r.branch_id is not null then jsonb_build_object('branchId', r.branch_id) else '{}'::jsonb end
      order by r.data->>'remindedAt', r.id), '[]'::jsonb)
      from public.customer_reminders r where r.shop_id=p_shop and (keep is null or coalesce(r.branch_id,'main') = keep))
  );

  -- Money records: one read, split by collection.
  result := result || (select jsonb_object_agg(k.key, coalesce(o.items, '[]'::jsonb))
    from unnest(array['payees','moneyAccounts','accountEntries','operationHistory','repeatingExpenses']) k(key)
    left join (select collection, jsonb_agg(data order by data->>'createdAt', id) items
               from public.business_operations_records where shop_id=p_shop group by collection) o on o.collection = k.key);

  if br then
    if keep is not null then result := private.branch_accounts(p_shop, result, keep); end if;
    result := jsonb_set(result, '{services}', private.branch_price_services(p_shop, result->'services'));
    result := jsonb_set(result, '{materials}', private.location_materials(p_shop, result->'materials'));
    result := result || jsonb_build_object('locationStock', private.visible_location_stock(p_shop, keep is null),
      'stockRequests', private.visible_stock_requests(p_shop, keep is null));
  end if;

  -- The server's stock valuation and late costs (Actual cost method).
  result := result || private.valuation_for(p_shop, keep);
  -- The Team (plans/job-assignment.md).
  result := result || private.team_for(p_shop, keep);
  perform set_config('psl.ledger', prev, true);
  return result;
end $function$;

-- Every sync carries what changed.
create or replace function public.get_ledger_changes(p_shop uuid, p_since text default null, p_slim boolean default false)
returns jsonb language plpgsql stable set search_path to '' as $g$
declare prev text := coalesce(current_setting('psl.ledger', true), ''); r jsonb; v record; keep text;
begin
  perform set_config('psl.ledger', 'on', true);
  r := public.get_ledger_changes_before_guard(p_shop, p_since, p_slim);
  if r ? 'ledger' and not coalesce((r->>'full')::boolean, false) then
    select * into v from private.branch_view(p_shop);
    keep := case when coalesce(v.has_branches, false) then v.keep_branch end;
    r := jsonb_set(r, '{ledger}', (r->'ledger') || private.valuation_for(p_shop, keep) || private.team_for(p_shop, keep, p_since::xid8));
  end if;
  perform set_config('psl.ledger', prev, true);
  return r;
end $g$;
