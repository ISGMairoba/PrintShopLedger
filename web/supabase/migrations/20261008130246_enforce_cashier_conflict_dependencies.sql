create function private.sync_resource_keys(p_shop uuid,p_event jsonb,p_hold boolean default false,p_message text default '') returns text[] language plpgsql stable set search_path='' as $$
declare d jsonb:=p_event->'data';family text:=split_part(p_event->>'kind','.',1);keys text[]:='{}';j jsonb;m uuid;job public.jobs%rowtype;
begin
 if family='checkout' then
  keys:=array_append(keys,'customer:'||(d->>'customerId'));
  for j in select value from jsonb_array_elements(coalesce(d->'jobs','[]')) loop
   keys:=array_append(keys,'job:'||(j->>'id'));keys:=array_append(keys,'material:'||(j->>'materialId'));
   select material_id into m from public.services where shop_id=p_shop and id::text=j->>'serviceId';keys:=array_append(keys,'material:'||m);
   if not p_hold or p_message ~* 'service|price' then keys:=array_append(keys,'service:'||(j->>'serviceId'));end if;
  end loop;
  for j in select value from jsonb_array_elements(coalesce(d->'allocations','[]')) loop keys:=array_append(keys,'job:'||(j->>'jobId'));end loop;
 elsif family in ('customer','material','service','expense','job') then
  keys:=array_append(keys,family||':'||(d->>'id'));
  if family='service' then select material_id into m from public.services where shop_id=p_shop and id::text=d->>'id';keys:=array_append(keys,'material:'||m);keys:=array_append(keys,'material:'||(d->>'materialId'));end if;
  if family='expense' then
   for j in select value from jsonb_array_elements(coalesce(d->'materials','[]')) union all select value from public.expenses e cross join lateral jsonb_array_elements(e.data->'materials') where e.shop_id=p_shop and e.id::text=d->>'id' loop keys:=array_append(keys,'material:'||(j->>'materialId'));end loop;
  end if;
  if family='job' then select * into job from public.jobs where shop_id=p_shop and id::text=d->>'id';keys:=array_append(keys,'customer:'||job.customer_id);keys:=array_append(keys,'material:'||(job.metadata->>'materialId'));end if;
 end if;
 return array_remove(keys,null);
end $$;
revoke all on function private.sync_resource_keys(uuid,jsonb,boolean,text) from public,anon,authenticated;
create function private.assert_sync_dependencies(p_shop uuid,p_event jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=auth.uid() and not archived and access_level=1) then return;end if;
 if current_setting('printshopledger.review_actor',true)=p_shop::text||':'||auth.uid()::text then return;end if;
 if exists(select 1 from public.ledger_events where shop_id=p_shop and id::text=p_event->>'id' and actor_id=auth.uid() and payload=p_event) then return;end if;
 if exists(select 1 from private.sync_conflicts c where c.shop_id=p_shop and c.status='pending' and private.sync_resource_keys(p_shop,c.source,true,c.message)&&private.sync_resource_keys(p_shop,p_event)) then raise exception 'Affected stock or customer accounts are awaiting Admin review. Choose unaffected records.' using errcode='PT409';end if;
end $$;
revoke all on function private.assert_sync_dependencies(uuid,jsonb) from public,anon;
grant execute on function private.assert_sync_dependencies(uuid,jsonb) to authenticated;
-- Preserve existing validation and idempotency; add cashier holds to operational writes.
-- Expenses already require Admin access and use a SQL wrapper around the private implementation.
do $$declare name text;definition text;begin
 foreach name in array array['apply_checkout_event','apply_job_status_event','apply_customer_event','apply_material_event','apply_service_event','apply_expense_event'] loop
  definition:=pg_get_functiondef(('public.'||name||'(uuid,jsonb)')::regprocedure);
  definition:=regexp_replace(definition,'\mbegin\M',E'begin\n perform private.assert_sync_dependencies(p_shop,p_event);','i');
  execute definition;
 end loop;
end $$;
create or replace function private.apply_reviewed_operation(p_shop uuid,p_event jsonb,p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
declare old_sub text:=current_setting('request.jwt.claim.sub',true);old_claims text:=current_setting('request.jwt.claims',true);old_review text:=current_setting('printshopledger.review_actor',true);
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated')::text,true);
 perform set_config('printshopledger.review_actor',p_shop::text||':'||p_actor::text,true);
 case
 when p_event->>'kind'='checkout.completed' then perform public.apply_checkout_event(p_shop,p_event);
 when p_event->>'kind'='job.status_changed' then perform public.apply_job_status_event(p_shop,p_event);
 when p_event->>'kind' like 'customer.%' then perform public.apply_customer_event(p_shop,p_event);
 when p_event->>'kind' like 'material.%' then perform public.apply_material_event(p_shop,p_event);
 when p_event->>'kind' like 'service.%' then perform public.apply_service_event(p_shop,p_event);
 when p_event->>'kind' like 'expense.%' then perform public.apply_expense_event(p_shop,p_event);
 else raise exception 'Unsupported review operation';end case;
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('printshopledger.review_actor',coalesce(old_review,''),true);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);perform set_config('request.jwt.claims',coalesce(old_claims,''),true);perform set_config('printshopledger.review_actor',coalesce(old_review,''),true);raise;
end $$;
revoke all on function private.apply_reviewed_operation(uuid,jsonb,uuid) from public,anon,authenticated;
