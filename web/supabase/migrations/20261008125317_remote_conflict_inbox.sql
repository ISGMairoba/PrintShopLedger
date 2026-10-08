create table private.sync_conflicts(
 shop_id uuid not null references public.shops(id),event_id uuid not null,actor_id uuid not null,source jsonb not null,message text not null,
 status text not null default 'pending' check(status in ('pending','resolved')),submitted_at timestamptz not null default now(),
 resolved_at timestamptz,reviewer_id uuid,reviewer_label text,decision text,reason text,replacements jsonb,
 primary key(shop_id,event_id)
);
alter table private.sync_conflicts enable row level security;
revoke all on private.sync_conflicts from public,anon,authenticated;
create index sync_conflicts_pending on private.sync_conflicts(shop_id,submitted_at) where status='pending';

-- A small resource snapshot prevents decisions based on outdated records.
create function private.conflict_token(p_shop uuid,p_source jsonb) returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_object('source',p_source,
 'customers',(select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') from public.customers c where c.shop_id=p_shop and c.id::text in (p_source->'data'->>'customerId',case when p_source->>'kind' like 'customer.%' then p_source->'data'->>'id' end)),
 'account',case when p_source->>'kind'='checkout.completed' and exists(select 1 from public.customers where shop_id=p_shop and id::text=p_source->'data'->>'customerId') then public.checkout_account_token(p_shop,(p_source->'data'->>'customerId')::uuid) end,
 'materials',(select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from public.materials m where m.shop_id=p_shop and (m.id::text=case when p_source->>'kind' like 'material.%' then p_source->'data'->>'id' end or exists(select 1 from jsonb_array_elements(coalesce(p_source->'data'->'jobs','[]')) j where j->>'materialId'=m.id::text) or exists(select 1 from jsonb_array_elements(coalesce(p_source->'data'->'materials','[]')) j where j->>'materialId'=m.id::text) or m.id::text=p_source->'data'->>'materialId' or exists(select 1 from public.services s where s.shop_id=p_shop and s.id::text=p_source->'data'->>'id' and s.material_id=m.id))),
 'services',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.services s where s.shop_id=p_shop and (s.id::text=case when p_source->>'kind' like 'service.%' then p_source->'data'->>'id' end or exists(select 1 from jsonb_array_elements(coalesce(p_source->'data'->'jobs','[]')) j where j->>'serviceId'=s.id::text))),
 'expense',(select data from public.expenses where shop_id=p_shop and id::text=p_source->'data'->>'id' and p_source->>'kind' like 'expense.%'),
 'job',(select to_jsonb(j) from public.jobs j where shop_id=p_shop and id::text=p_source->'data'->>'id' and p_source->>'kind'='job.status_changed')
 )::text)
$$;
revoke all on function private.conflict_token(uuid,jsonb) from public,anon,authenticated;

create function private.submit_sync_conflict(p_shop uuid,p_event jsonb,p_message text) returns void language plpgsql security definer set search_path='' as $$
declare a uuid:=(case when p_event->>'kind'='checkout.completed' then p_event->'data'->>'createdBy' else p_event->'data'->>'modifiedBy' end)::uuid;e uuid:=(p_event->>'id')::uuid;old private.sync_conflicts%rowtype;
begin
 if not public.is_shop_member(p_shop) or a is distinct from auth.uid() then raise exception 'Business access denied' using errcode='42501';end if;
 if e is null or p_event->>'kind' is null or p_event->>'kind' not in ('checkout.completed','job.status_changed','customer.created','customer.updated','customer.archived','customer.restored','material.created','material.updated','material.archived','material.restored','material.stock_added','material.stock_set','service.created','service.updated','service.archived','service.restored','expense.created','expense.updated','expense.payment_recorded','expense.voided') or octet_length(p_event::text)>200000 then raise exception 'Invalid conflict operation';end if;
 perform 1 from public.shops where id=p_shop for update;
 select * into old from private.sync_conflicts where shop_id=p_shop and event_id=e;
 if found then if old.actor_id<>a or old.source<>p_event then raise exception 'Conflict operation ID already used';end if;return;end if;
 if exists(select 1 from public.ledger_events where shop_id=p_shop and id=e) then return;end if;
 if (select count(*) from private.sync_conflicts where shop_id=p_shop and actor_id=a and status='pending')>=1000 then raise exception 'The pending conflict inbox is full. Ask a supervisor to review it.';end if;
 insert into private.sync_conflicts(shop_id,event_id,actor_id,source,message) values(p_shop,e,a,p_event,left(coalesce(p_message,'Review required'),1000));
end $$;

create function private.list_sync_conflicts(p_shop uuid,p_events uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare admin boolean;
begin
 if not public.is_shop_member(p_shop) then raise exception 'Business access denied' using errcode='42501';end if;
 admin:=exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2);
 if coalesce(array_length(p_events,1),0)>1000 then raise exception 'Too many conflict IDs';end if;
 return (select coalesce(jsonb_agg(to_jsonb(r) order by case when r.status='pending' then 0 else 1 end,r.submitted_at),'[]') from (select c.*,m.name actor_label from private.sync_conflicts c left join public.shop_members m on m.shop_id=c.shop_id and m.user_id=c.actor_id where c.shop_id=p_shop and (admin or c.actor_id=auth.uid()) and (p_events is null or c.event_id=any(p_events)) order by case when c.status='pending' then 0 else 1 end,c.submitted_at desc limit 1000) r);
end $$;

create function private.get_sync_conflict(p_shop uuid,p_event uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c private.sync_conflicts%rowtype;
begin
 if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level>=2) then raise exception 'Admin review required' using errcode='42501';end if;
 select * into c from private.sync_conflicts where shop_id=p_shop and event_id=p_event;
 if not found then raise exception 'Conflict is no longer available';end if;
 return jsonb_build_object('conflict',to_jsonb(c),'ledger',public.get_ledger(p_shop),'token',private.conflict_token(p_shop,c.source));
end $$;

-- Only the verified review function may execute the approved operation for its original actor.
create function private.apply_reviewed_operation(p_shop uuid,p_event jsonb,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 case
 when p_event->>'kind'='checkout.completed' then perform public.apply_checkout_event(p_shop,p_event);
 when p_event->>'kind'='job.status_changed' then perform public.apply_job_status_event(p_shop,p_event);
 when p_event->>'kind' like 'customer.%' then perform public.apply_customer_event(p_shop,p_event);
 when p_event->>'kind' like 'material.%' then perform public.apply_material_event(p_shop,p_event);
 when p_event->>'kind' like 'service.%' then perform public.apply_service_event(p_shop,p_event);
 when p_event->>'kind' like 'expense.%' then perform public.apply_expense_event(p_shop,p_event);
 else raise exception 'Unsupported review operation';end case;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);raise;
end $$;
revoke all on function private.apply_reviewed_operation(uuid,jsonb,uuid) from public,anon,authenticated;

create function private.resolve_sync_conflict(p_shop uuid,p_event uuid,p_token text,p_replacements jsonb,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare c private.sync_conflicts%rowtype;reviewer uuid:=auth.uid();label text;r jsonb;family text;
begin
 perform 1 from public.shops where id=p_shop for update;
 select name into label from public.shop_members where shop_id=p_shop and user_id=reviewer and not archived and access_level>=2;
 if not found then raise exception 'Admin review required' using errcode='42501';end if;
 select * into c from private.sync_conflicts where shop_id=p_shop and event_id=p_event for update;
 if not found then raise exception 'Conflict is no longer available';end if;
 if c.status='resolved' then raise exception 'Another supervisor already resolved this conflict. Refresh the inbox.' using errcode='PT409';end if;
 if private.conflict_token(p_shop,c.source) is distinct from p_token then raise exception 'The reviewed records changed. Refresh and review the latest values.' using errcode='PT409';end if;
 if length(btrim(coalesce(p_reason,''))) not between 1 and 500 or jsonb_typeof(p_replacements) is distinct from 'array' or jsonb_array_length(p_replacements)>3 then raise exception 'Enter a review reason and valid operations';end if;
 if c.source->>'kind'='checkout.completed' and jsonb_array_length(p_replacements)<>1 then raise exception 'A sale must be reviewed and retained, not discarded';end if;
 if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=c.actor_id and not archived and access_level>0) then raise exception 'The original staff account no longer has business access';end if;
 family:=split_part(c.source->>'kind','.',1);
 for r in select value from jsonb_array_elements(p_replacements) loop
  if r->>'id'=p_event::text or split_part(r->>'kind','.',1) is distinct from family or (case when r->>'kind'='checkout.completed' then r->'data'->>'createdBy' else r->'data'->>'modifiedBy' end)::uuid is distinct from c.actor_id or (family<>'checkout' and r->'data'->>'id' is distinct from c.source->'data'->>'id') then raise exception 'Invalid reviewed operation identity';end if;
  if family='checkout' then perform private.approve_checkout_review(p_shop,r);end if;
  perform private.apply_reviewed_operation(p_shop,r,c.actor_id);
 end loop;
 -- Receipt for the original operation makes a delayed old-device retry harmless.
 insert into public.ledger_events(shop_id,id,actor_id,payload) values(p_shop,p_event,c.actor_id,c.source);
 update private.sync_conflicts set status='resolved',resolved_at=now(),reviewer_id=reviewer,reviewer_label=label,decision=case when jsonb_array_length(p_replacements)=0 then 'business' else 'reviewed' end,reason=btrim(p_reason),replacements=p_replacements where shop_id=p_shop and event_id=p_event;
end $$;

create function public.submit_sync_conflict(p_shop uuid,p_event jsonb,p_message text) returns void language sql security invoker set search_path='' as $$select private.submit_sync_conflict(p_shop,p_event,p_message)$$;
create function public.list_sync_conflicts(p_shop uuid,p_events uuid[] default null) returns jsonb language sql security invoker set search_path='' as $$select private.list_sync_conflicts(p_shop,p_events)$$;
create function public.get_sync_conflict(p_shop uuid,p_event uuid) returns jsonb language sql security invoker set search_path='' as $$select private.get_sync_conflict(p_shop,p_event)$$;
create function public.resolve_sync_conflict(p_shop uuid,p_event uuid,p_token text,p_replacements jsonb,p_reason text) returns void language sql security invoker set search_path='' as $$select private.resolve_sync_conflict(p_shop,p_event,p_token,p_replacements,p_reason)$$;
revoke all on function private.submit_sync_conflict(uuid,jsonb,text),private.list_sync_conflicts(uuid,uuid[]),private.get_sync_conflict(uuid,uuid),private.resolve_sync_conflict(uuid,uuid,text,jsonb,text),public.submit_sync_conflict(uuid,jsonb,text),public.list_sync_conflicts(uuid,uuid[]),public.get_sync_conflict(uuid,uuid),public.resolve_sync_conflict(uuid,uuid,text,jsonb,text) from public,anon;
grant execute on function private.submit_sync_conflict(uuid,jsonb,text),private.list_sync_conflicts(uuid,uuid[]),private.get_sync_conflict(uuid,uuid),private.resolve_sync_conflict(uuid,uuid,text,jsonb,text),public.submit_sync_conflict(uuid,jsonb,text),public.list_sync_conflicts(uuid,uuid[]),public.get_sync_conflict(uuid,uuid),public.resolve_sync_conflict(uuid,uuid,text,jsonb,text) to authenticated;
