-- Run as database owner. Synthetic users and records are rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid();
begin
  insert into auth.users(id,email,raw_user_meta_data) values(u,u::text||'@example.invalid','{"full_name":"Service test owner"}'),(outsider,outsider::text||'@example.invalid','{}');
  insert into public.shops(id,name) values(s,'Service test'),(other_shop,'Other service test');
  insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level) values(s,u,'manager','Owner','manager',3,3),(other_shop,outsider,'manager','Other owner','manager',3,3);
  perform set_config('test.service_user',u::text,true);
  perform set_config('test.service_outsider',outsider::text,true);
  perform set_config('test.service_shop',s::text,true);
  perform set_config('test.service_other_shop',other_shop::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.service_user'),true);
do $$
declare
  s uuid:=current_setting('test.service_shop')::uuid;
  u uuid:=current_setting('test.service_user')::uuid;
  outsider uuid:=current_setting('test.service_outsider')::uuid;
  other_shop uuid:=current_setting('test.service_other_shop')::uuid;
  m uuid:=gen_random_uuid(); other_m uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  e jsonb; original public.services%rowtype; actual public.services%rowtype; rejected boolean;
begin
  perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',
    jsonb_build_object('id',m,'name','Paper','available',10,'measurementUnit','sheet','requireSize',false,'modifiedBy',u)));
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  perform public.apply_material_event(other_shop,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',
    jsonb_build_object('id',other_m,'name','Private paper','available',0,'measurementUnit','sheet','requireSize',false,'modifiedBy',outsider)));
  perform set_config('request.jwt.claim.sub',u::text,true);
  e:=jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',
    jsonb_build_object('id',a,'description',' Colour printing ','materialId',m,'price',150050,'modifiedBy',u,'modifiedByLabel','Forged','modifiedAt','1900-01-01'));
  perform public.apply_service_event(s,e);
  perform public.apply_service_event(s,e);
  select * into original from public.services where id=a;
  if original.description<>'Colour printing' or original.price<>150050 or original.version<>1 or original.created_by_label<>'Service test owner' or original.created_at<now()-interval '1 minute' then raise exception 'Creation or trusted audit failed'; end if;
  perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',
    jsonb_build_object('id',b,'description','Black printing','materialId',m,'price',10000,'modifiedBy',u)));
  if (select count(*) from public.services where shop_id=s and material_id=m)<>2 then raise exception 'Shared material failed'; end if;
  if (select available from public.materials where id=m)<>10 or (select count(*) from public.material_stock_changes where shop_id=s)<>1 then raise exception 'Service operations changed material stock'; end if;
  e:=jsonb_build_object('id',gen_random_uuid(),'kind','service.updated','data',
    jsonb_build_object('id',a,'baseVersion',1,'description','Colour copy','materialId',m,'price',0,'modifiedBy',u));
  perform public.apply_service_event(s,e);
  select * into actual from public.services where id=a;
  if actual.price<>0 or actual.created_at<>original.created_at or actual.created_by<>original.created_by or actual.version<>2 then raise exception 'Update or creation audit preservation failed'; end if;
  if (select price from public.services where id=b)<>10000 then raise exception 'Other service price changed'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_set(e,'{id}',to_jsonb(gen_random_uuid()))); exception when sqlstate 'PT409' then rejected:=true; end;
  if not rejected then raise exception 'Stale service edit accepted'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_set(e,'{data,price}','1')); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Event ID reused for different payload'; end if;
  e:=jsonb_build_object('id',gen_random_uuid(),'kind','service.archived','data',jsonb_build_object('id',a,'baseVersion',2,'modifiedBy',u));
  perform public.apply_service_event(s,e);
  select * into actual from public.services where id=a;
  if not actual.archived or actual.material_id<>m or actual.price<>0 then raise exception 'Archive lost details'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.updated','data',
    jsonb_build_object('id',a,'baseVersion',3,'description','Blocked','materialId',m,'price',100,'modifiedBy',u)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Archived service edit accepted'; end if;
  perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.restored','data',jsonb_build_object('id',a,'baseVersion',3,'modifiedBy',u)));
  if (select archived from public.services where id=a) then raise exception 'Restore failed'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',
    jsonb_build_object('id',gen_random_uuid(),'description','Cross-business','materialId',other_m,'price',100,'modifiedBy',u)));
  exception when no_data_found then rejected:=true; end;
  if not rejected then raise exception 'Cross-business material link accepted'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.updated','data',
    jsonb_build_object('id',a,'baseVersion',4,'description','Invalid price','materialId',m,'price',0.5,'modifiedBy',u)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Fractional kobo accepted'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.archived','data',
    jsonb_build_object('id',a,'baseVersion',4,'modifiedBy',outsider)));
  exception when others then rejected:=true; end;
  if not rejected then raise exception 'Forged audit actor accepted'; end if;
  perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.archived','data',jsonb_build_object('id',m,'baseVersion',1,'modifiedBy',u)));
  perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.updated','data',
    jsonb_build_object('id',a,'baseVersion',4,'description','Existing link','materialId',m,'price',200,'modifiedBy',u)));
  rejected:=false;
  begin perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',
    jsonb_build_object('id',gen_random_uuid(),'description','Inactive material','materialId',m,'price',100,'modifiedBy',u)));
  exception when no_data_found then rejected:=true; end;
  if not rejected then raise exception 'New archived material link accepted'; end if;
  if jsonb_array_length(public.get_ledger(s)->'services')<>2 then raise exception 'Services missing from sync response'; end if;
  rejected:=false;
  begin update public.services set price=999 where id=a; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct service write allowed'; end if;
  rejected:=false;
  begin delete from public.services where id=a; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Direct service deletion allowed'; end if;
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  if exists(select 1 from public.services where shop_id=s) then raise exception 'Cross-business service read allowed'; end if;
  rejected:=false;
  begin perform public.apply_service_event(s,e); exception when others then rejected:=true; end;
  if not rejected then raise exception 'Cross-business service write allowed'; end if;
end $$;
rollback;

