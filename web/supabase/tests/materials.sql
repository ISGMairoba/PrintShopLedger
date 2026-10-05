-- Run as the database owner. All synthetic users and records are rolled back.
begin;
do $$
declare u uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); s uuid := gen_random_uuid(); other_shop uuid := gen_random_uuid();
begin
  insert into auth.users(id, email, raw_user_meta_data) values (u, u::text || '@example.invalid', '{"full_name":"Material test owner"}'), (outsider, outsider::text || '@example.invalid', '{}');
  insert into public.shops(id,name) values(s,'Material test'),(other_shop,'Other material test');
  insert into public.shop_members(shop_id,user_id,role) values(s,u,'admin'),(other_shop,outsider,'admin');
  perform set_config('test.material_user',u::text,true);
  perform set_config('test.material_outsider',outsider::text,true);
  perform set_config('test.material_shop',s::text,true);
  perform set_config('test.material_other_shop',other_shop::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.material_user'),true);
do $$
declare
  s uuid := current_setting('test.material_shop')::uuid;
  u uuid := current_setting('test.material_user')::uuid;
  m uuid := gen_random_uuid();
  e jsonb;
  original public.materials%rowtype;
  actual public.materials%rowtype;
  rejected boolean;
begin
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',
    jsonb_build_object('id',m,'name',' Banner ','available',12.375,'measurementUnit',' metre ','requireSize',true,'modifiedBy',u,'modifiedByLabel','Forged label','modifiedAt','1900-01-01'));
  perform public.apply_material_event(s,e);
  perform public.apply_material_event(s,e);
  select * into original from public.materials where id=m;
  if original.name <> 'Banner' or original.version <> 1 or original.available <> 12.375 or original.created_by_label <> 'Material test owner' or original.created_at < now()-interval '1 minute' then raise exception 'Creation, idempotency or trusted audit failed'; end if;
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.updated','data',
    jsonb_build_object('id',m,'baseVersion',1,'name','Paper','available',20,'measurementUnit','sheet','requireSize',false,'modifiedBy',u));
  perform public.apply_material_event(s,e);
  select * into actual from public.materials where id=m;
  if actual.version <> 2 or actual.require_size or actual.created_at <> original.created_at or actual.created_by <> original.created_by then raise exception 'Update or audit preservation failed'; end if;
  rejected := false;
  begin perform public.apply_material_event(s,jsonb_set(e,'{id}',to_jsonb(gen_random_uuid()))); exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'Stale edit accepted'; end if;
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.archived','data',jsonb_build_object('id',m,'baseVersion',2,'modifiedBy',u));
  perform public.apply_material_event(s,e);
  select * into actual from public.materials where id=m;
  if not actual.archived or actual.available <> 12.375 or actual.version <> 3 then raise exception 'Archive lost quantity'; end if;
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.restored','data',jsonb_build_object('id',m,'baseVersion',3,'modifiedBy',u));
  perform public.apply_material_event(s,e);
  if (public.get_ledger(s)->'materials'->0->>'archived')::boolean then raise exception 'Restore failed'; end if;
  rejected := false;
  begin
    perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.updated','data',
      jsonb_build_object('id',m,'baseVersion',4,'name','Bad','available',-1,'measurementUnit','sheet','requireSize',false,'modifiedBy',u)));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Negative stock accepted'; end if;
  rejected := false;
  begin
    perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.updated','data',
      jsonb_build_object('id',m,'baseVersion',4,'name','Bad','available',0.0001,'measurementUnit','sheet','requireSize',false,'modifiedBy',u)));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Invalid precision accepted'; end if;
  rejected := false;
  begin
    perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.archived','data',
      jsonb_build_object('id',m,'baseVersion',4,'modifiedBy',current_setting('test.material_outsider'))));
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Forged actor accepted'; end if;
  rejected := false;
  begin update public.materials set available=999 where id=m; exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Direct material write accepted'; end if;
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.stock_added','data',jsonb_build_object('id',m,'baseVersion',4,'quantity',2.625,'reason','Delivery','modifiedBy',u));
  perform public.apply_material_event(s,e);
  perform public.apply_material_event(s,e);
  select * into actual from public.materials where id=m;
  if actual.available <> 15 or actual.version <> 5 then raise exception 'Stock addition or retry failed'; end if;
  if (select count(*) from public.material_stock_changes where material_id=m) <> 1 then raise exception 'Stock history retry duplicated'; end if;
  if not exists(select 1 from public.material_stock_changes where material_id=m and before_available=12.375 and after_available=15 and reason='Delivery' and actor_id=u) then raise exception 'Stock history missing'; end if;
  e := jsonb_build_object('id',gen_random_uuid(),'kind','material.stock_set','data',jsonb_build_object('id',m,'baseVersion',5,'quantity',0,'modifiedBy',u));
  perform public.apply_material_event(s,e);
  select * into actual from public.materials where id=m;
  if actual.available <> 0 or actual.version <> 6 or actual.created_at <> original.created_at then raise exception 'Direct stock count replacement failed'; end if;
    perform set_config('request.jwt.claim.sub',current_setting('test.material_outsider'),true);
  if exists(select 1 from public.materials where shop_id=s) then raise exception 'Cross-business material read allowed'; end if;
  rejected := false;
  begin perform public.apply_material_event(s,e); exception when others then rejected := true; end;
  if not rejected then raise exception 'Cross-business write allowed'; end if;
end $$;
rollback;
