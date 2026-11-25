-- Team work, PR D (plans/job-assignment.md): paying commission out, with advances and deductions.
-- * team.payout_recorded: money paid to a Team person (kind 'payout'), linked to the expense that
--   paid it (category Commission, from a money account), or a deduction (kind 'deduction', no money).
-- * A person's commission balance is what their confirmed work earned (all time) less what was paid
--   and deducted. Paying more than is owed is an advance (the balance goes below zero) and later
--   commission pays it back. A correction of work already paid changes what was earned, so it
--   shows as a plus or minus on the next payout: work records are never rewritten by a payout.
-- * Who pays or deducts: those who set commission terms (teamWork.termsRank, General Manager by
--   default). Payouts are pay: only they, and each person their own, see them (as with terms).

alter table public.team_records drop constraint if exists team_records_collection_check;
alter table public.team_records add constraint team_records_collection_check
  check (collection in ('teamPeople', 'jobAssignments', 'workRecords', 'workCorrections', 'teamTerms', 'teamPayouts'));

create or replace function private.team_payout(p_shop uuid, d jsonb, p_level int, p_label text, p_settings jsonb)
returns void language plpgsql security definer set search_path to '' as $f$
declare rid uuid := (d->>'id')::uuid; amount numeric;
begin
  if p_level < (p_settings->>'termsRank')::int then raise exception 'You cannot pay commission'; end if;
  if not coalesce((p_settings->>'commission')::boolean, false) then raise exception 'Commission is switched off (Business Settings → Team work)'; end if;
  if (d->>'personId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not private.team_person(p_shop, (d->>'personId')::uuid, false) then raise exception 'Choose someone on the Team'; end if;
  if coalesce(d->>'kind', '') not in ('payout', 'deduction') then raise exception 'Invalid commission payment'; end if;
  amount := (d->>'amount')::numeric;
  if jsonb_typeof(d->'amount') is distinct from 'number' or amount <= 0 or amount > 100000000000 or amount <> trunc(amount) then
    raise exception 'Enter an amount greater than zero'; end if;
  if (d->>'paidOn') !~ '^\d{4}-\d{2}-\d{2}$' or (d->>'paidOn')::date > current_date + 1 then raise exception 'Enter the date'; end if;
  if length(coalesce(d->>'note', '')) > 200 then raise exception 'Keep the note to 200 characters'; end if;
  if d->>'kind' = 'payout' then
    if (d->>'expenseId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.expenses e where e.shop_id = p_shop and e.id = (d->>'expenseId')::uuid) then
      raise exception 'Record the payment (the expense) first'; end if;
  elsif d ? 'expenseId' then raise exception 'A deduction moves no money';
  end if;
  if exists (select 1 from public.team_records where shop_id = p_shop and collection = 'teamPayouts' and id = rid) then
    raise exception 'This payment is already recorded' using errcode = 'PT409'; end if;
  insert into public.team_records(shop_id, collection, id, data, branch_id) values (p_shop, 'teamPayouts', rid,
    jsonb_build_object('id', rid, 'personId', d->>'personId', 'kind', d->>'kind', 'amount', amount, 'paidOn', d->>'paidOn',
      'note', btrim(coalesce(d->>'note', '')), 'expenseId', d->'expenseId', 'balanceBefore', d->'balanceBefore',
      'recordedBy', auth.uid(), 'recordedByLabel', p_label, 'recordedAt', now(), 'version', 1), null);
end $f$;
revoke all on function private.team_payout(uuid, jsonb, int, text, jsonb) from public, anon;
grant execute on function private.team_payout(uuid, jsonb, int, text, jsonb) to authenticated;

do $patch$
declare d text; n text;
begin
  d := pg_get_functiondef('public.apply_team_event(uuid,jsonb)'::regprocedure);
  n := regexp_replace(d, 'else\s*raise exception ''Unknown team change'';',
    'elsif k = ''team.payout_recorded'' then
    perform private.team_payout(p_shop, d, lvl, label, tw);
  else
    raise exception ''Unknown team change'';');
  if n = d then raise exception 'apply_team_event pattern not found'; end if;
  execute n;

  d := pg_get_functiondef('private.team_for(uuid,text,xid8)'::regprocedure);
  n := regexp_replace(d, '''teamTerms'',\s*\(select',
    '''teamPayouts'', (select coalesce(jsonb_agg(r.data order by r.data->>''paidOn'', r.data->>''recordedAt'', r.id), ''[]''::jsonb) from public.team_records r
        where r.shop_id = p_shop and r.collection = ''teamPayouts'' and (p_since is null or r.sync_xid >= p_since)
          and (r.data->>''personId'' = auth.uid()::text or coalesce((select n.lvl from private.notice_member(p_shop) n), 0) >= (private.team_settings(p_shop)->>''termsRank'')::int)),
    ''teamTerms'', (select');
  if n = d then raise exception 'team_for pattern not found'; end if;
  execute n;
end $patch$;
