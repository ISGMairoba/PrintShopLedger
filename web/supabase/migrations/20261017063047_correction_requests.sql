-- Correction requests: a cashier asks for a correction on one of their own sales; an Admin,
-- Manager or Developer approves it (the correction is then applied as usual, recorded as requested
-- by the cashier and approved by them) or rejects it with a note. Only through the functions below.
create table if not exists public.correction_requests(
 shop_id uuid not null references public.shops(id) on delete cascade,
 id uuid not null,
 job_id uuid not null,
 kind text not null,
 event jsonb not null,
 reason text not null,
 requested_by uuid not null,
 requested_by_label text not null,
 requested_at timestamptz not null default clock_timestamp(),
 status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
 decided_by uuid,
 decided_by_label text,
 decided_at timestamptz,
 note text,
 primary key (shop_id,id)
);
alter table public.correction_requests enable row level security;
revoke all on public.correction_requests from anon, authenticated;
create unique index if not exists correction_requests_one_pending on public.correction_requests(shop_id,job_id) where status='pending';

-- The parts of a correction the cashier chose (not the version checks or who saves it).
create or replace function private.request_core(d jsonb) returns jsonb language sql immutable set search_path='' as $$
 select (d - array['baseVersion','expectedAccount','expectedPayment','materialVersions','serviceVersion','materialVersion','modifiedBy','modifiedByLabel','modifiedAt','requestId','requestedBy','requestedByLabel','paymentEdits'])
  || case when d ? 'paymentEdits' then jsonb_build_object('paymentEdits',(select coalesce(jsonb_agg(x-'expectedPayment' order by o),'[]'::jsonb) from jsonb_array_elements(d->'paymentEdits') with ordinality t(x,o))) else '{}'::jsonb end;
$$;

create or replace function private.correction_request_list(p_shop uuid, p_all boolean) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'jobId',r.job_id,'kind',r.kind,'event',r.event,'reason',r.reason,'requestedBy',r.requested_by,'requestedByLabel',r.requested_by_label,'requestedAt',r.requested_at,'status',r.status,'decidedBy',r.decided_by,'decidedByLabel',r.decided_by_label,'decidedAt',r.decided_at,'note',r.note) order by r.requested_at desc),'[]'::jsonb)
 from (select * from public.correction_requests x where x.shop_id=p_shop and (p_all or x.requested_by=auth.uid()) order by x.requested_at desc limit 300) r;
$$;

create or replace function public.list_correction_requests(p_shop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lvl integer;
begin
 select access_level into lvl from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived;
 if not found then raise exception 'Only active staff can see correction requests';end if;
 return private.correction_request_list(p_shop,lvl>=2);
end $$;

create or replace function public.submit_correction_request(p_shop uuid, p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();lvl integer;label text;d jsonb:=p_event->'data';k text:=p_event->>'kind';e uuid;j public.jobs%rowtype;reason text:=btrim(p_event->'data'->>'reason');
begin
 select access_level,name into lvl,label from public.shop_members where shop_id=p_shop and user_id=u and not archived for share;
 if not found then raise exception 'Only active staff can request a correction';end if;
 if jsonb_typeof(p_event) is distinct from 'object' or length(p_event::text)>100000 or (p_event->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid correction request';end if;
 e=(p_event->>'id')::uuid;
 if k not in ('sale.corrected','sale.details_corrected','sale.combined_corrected','sale.cancelled','sale.refunded','payment.corrected') or jsonb_typeof(d) is distinct from 'object' then raise exception 'Choose a correction type';end if;
 if reason is null or length(reason) not between 1 and 500 then raise exception 'Give a reason for the correction';end if;
 if (d->>'modifiedBy') is distinct from u::text then raise exception 'Invalid correction identity';end if;
 if (d->>'jobId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Job not found';end if;
 select * into j from public.jobs where shop_id=p_shop and id=(d->>'jobId')::uuid for share;
 if not found then raise exception 'Job not found';end if;
 if lvl<2 and not exists(select 1 from public.checkout_records c where c.shop_id=p_shop and c.id::text=j.metadata->>'checkoutId' and c.data->>'createdBy'=u::text) then raise exception 'You can request corrections only for your own sales';end if;
 if exists(select 1 from public.correction_requests where shop_id=p_shop and id=e) or exists(select 1 from public.ledger_events where shop_id=p_shop and id=e) then
  if exists(select 1 from public.correction_requests where shop_id=p_shop and id=e and event=p_event and requested_by=u) then return private.correction_request_list(p_shop,lvl>=2);end if;
  raise exception 'Request ID is already used';
 end if;
 if exists(select 1 from public.correction_requests where shop_id=p_shop and job_id=j.id and status='pending') then raise exception 'A correction for this job is already waiting for approval';end if;
 insert into public.correction_requests(shop_id,id,job_id,kind,event,reason,requested_by,requested_by_label) values(p_shop,e,j.id,k,p_event,reason,u,coalesce(label,''));
 return private.correction_request_list(p_shop,lvl>=2);
end $$;

create or replace function public.withdraw_correction_request(p_shop uuid, p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare lvl integer;
begin
 select access_level into lvl from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived;
 if not found then raise exception 'Only active staff can withdraw a request';end if;
 update public.correction_requests set status='withdrawn',decided_by=auth.uid(),decided_at=clock_timestamp() where shop_id=p_shop and id=p_request and requested_by=auth.uid() and status='pending';
 if not found then raise exception 'This request is no longer waiting' using errcode='PT409';end if;
 return private.correction_request_list(p_shop,lvl>=2);
end $$;

create or replace function public.reject_correction_request(p_shop uuid, p_request uuid, p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare label text;
begin
 select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can decide a request';end if;
 if p_note is null or length(btrim(p_note)) not between 1 and 500 then raise exception 'Say why the request is rejected';end if;
 update public.correction_requests set status='rejected',decided_by=auth.uid(),decided_by_label=label,decided_at=clock_timestamp(),note=btrim(p_note) where shop_id=p_shop and id=p_request and status='pending';
 if not found then raise exception 'This request is no longer waiting' using errcode='PT409';end if;
 return private.correction_request_list(p_shop,true);
end $$;

-- Approve: the approver's app refreshes the version checks to the latest records and saves the
-- cashier's correction unchanged; it is applied exactly like a correction the approver made.
create or replace function public.approve_correction_request(p_shop uuid, p_request uuid, p_event jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.correction_requests%rowtype;label text;d jsonb:=p_event->'data';result jsonb;
begin
 select name into label from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2 for share;
 if not found then raise exception 'Only an active Admin, Manager or Developer can approve this action';end if;
 select * into r from public.correction_requests where shop_id=p_shop and id=p_request for update;
 if not found then raise exception 'Request not found';end if;
 if r.status='approved' and exists(select 1 from public.ledger_events where shop_id=p_shop and id=r.id and payload=p_event) then return public.get_ledger(p_shop);end if;
 if r.status<>'pending' then raise exception 'This request is no longer waiting' using errcode='PT409';end if;
 if p_event->>'id' is distinct from r.id::text or p_event->>'kind' is distinct from r.kind or d->>'requestId' is distinct from r.id::text or d->>'requestedBy' is distinct from r.requested_by::text or d->>'requestedByLabel' is distinct from r.requested_by_label or private.request_core(d) is distinct from private.request_core(r.event->'data') then raise exception 'The approved correction must match the request';end if;
 result=private.apply_supervised_event(p_shop,p_event);
 update public.correction_requests set status='approved',decided_by=auth.uid(),decided_by_label=label,decided_at=clock_timestamp() where shop_id=p_shop and id=r.id;
 return result;
end $$;

revoke all on function private.request_core(jsonb), private.correction_request_list(uuid,boolean) from public, anon, authenticated;
revoke all on function public.list_correction_requests(uuid), public.submit_correction_request(uuid,jsonb), public.withdraw_correction_request(uuid,uuid), public.reject_correction_request(uuid,uuid,text), public.approve_correction_request(uuid,uuid,jsonb) from public, anon;
grant execute on function public.list_correction_requests(uuid), public.submit_correction_request(uuid,jsonb), public.withdraw_correction_request(uuid,uuid), public.reject_correction_request(uuid,uuid,text), public.approve_correction_request(uuid,uuid,jsonb) to authenticated;
