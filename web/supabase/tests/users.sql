begin;
do $$
declare owner_id uuid=gen_random_uuid(); staff_id uuid=gen_random_uuid(); stranger_id uuid=gen_random_uuid(); shop uuid; other_shop uuid; staff_record uuid; v integer; entries jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data,created_at) values
 (owner_id,owner_id::text||'@example.invalid','{"full_name":"Test Administrator"}',now()),
 (staff_id,staff_id::text||'@example.invalid','{}',now()),
 (stranger_id,stranger_id::text||'@example.invalid','{}',now());
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 shop=public.create_shop('Users test');
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',staff_id,'name','Test Staff','username','test.staff','rank','Operator','role','cashier'));
 entries=public.list_shop_users(shop);
 if jsonb_array_length(entries)<>2 then raise exception 'Account creation failed'; end if;
 select id,version into staff_record,v from public.shop_members where shop_id=shop and user_id=staff_id;
 if not exists(select 1 from public.shop_members where id=staff_record and created_by=owner_id and modified_by=owner_id) then raise exception 'Audit failed'; end if;
 perform public.save_shop_user(shop,'edit',jsonb_build_object('id',staff_record,'version',v,'name','Edited Staff','username','edited.staff','rank','Supervisor','role','manager'));
 if not exists(select 1 from public.shop_members where id=staff_record and name='Edited Staff' and rank='Supervisor' and role='manager' and version=v+1) then raise exception 'Edit failed'; end if;
 begin
  perform public.save_shop_user(shop,'edit',jsonb_build_object('id',staff_record,'version',v,'name','Stale','username','stale.staff','rank','Operator','role','cashier'));
  raise exception 'Stale version accepted';
 exception when serialization_failure then null; end;
 perform public.save_shop_user(shop,'archive',jsonb_build_object('id',staff_record,'version',v+1));
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 if public.is_shop_member(shop) or jsonb_array_length(public.list_my_shops())<>0 then raise exception 'Archived user retains access'; end if;
 begin perform public.list_shop_users(shop); raise exception 'Archived user can list users'; exception when others then if sqlerrm='Archived user can list users' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform public.save_shop_user(shop,'restore',jsonb_build_object('id',staff_record,'version',v+2));
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 if not public.is_shop_member(shop) then raise exception 'Restored user lacks access'; end if;
 begin perform public.list_shop_users(shop); raise exception 'Manager can list users'; exception when others then if sqlerrm='Manager can list users' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',stranger_id::text,true);
 other_shop=public.create_shop('Other users test');
 begin perform public.list_shop_users(shop); raise exception 'Cross-business access allowed'; exception when others then if sqlerrm='Cross-business access allowed' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 begin
  perform public.save_shop_user(shop,'archive',jsonb_build_object('id',(select id from public.shop_members where shop_id=shop and user_id=owner_id),'version',1));
  raise exception 'Own administrator archived';
 exception when others then if sqlerrm='Own administrator archived' then raise; end if; end;
 begin
  perform public.save_shop_user(shop,'create','{}');
  raise exception 'Client-side provisioning allowed';
 exception when others then if sqlerrm='Client-side provisioning allowed' then raise; end if; end;
 begin
  perform public.save_shop_user(shop,'edit',jsonb_build_object('id',staff_record,'version',v+3,'name','Duplicate','username',(select username from public.shop_members where shop_id=shop and user_id=owner_id),'rank','Staff','role','cashier'));
  raise exception 'Duplicate username accepted';
 exception when unique_violation then null; end;
 perform public.save_shop_user(shop,'edit',jsonb_build_object('id',staff_record,'version',v+3,'name','Cashier','username','cashier.staff','rank','Cashier','role','cashier'));
 perform set_config('request.jwt.claim.sub',staff_id::text,true);
 begin
  perform public.apply_material_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',jsonb_build_object('id',gen_random_uuid(),'name','Forbidden material','available',0,'measurementUnit','pcs','requireSize',false)));
  raise exception 'Cashier can edit materials';
 exception when others then if sqlerrm='Cashier can edit materials' then raise; end if; end;
 if exists(select 1 from public.materials where shop_id=shop) then raise exception 'Cashier created material'; end if;
 raise notice 'User workflows, audit, permissions, archive/restore, self-protection and isolation passed';
end $$;
rollback;
