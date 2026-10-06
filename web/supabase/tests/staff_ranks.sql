begin;
do $$
declare owner_id uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); cashier_id uuid=gen_random_uuid();
 manager_id uuid=gen_random_uuid(); developer_id uuid=gen_random_uuid(); outsider uuid=gen_random_uuid();
 shop uuid; other_shop uuid; target public.shop_members%rowtype; a uuid; actor_rank integer; t record; permitted boolean;
begin
 insert into auth.users(id,email,raw_user_meta_data,created_at)
 select id,id::text||'@example.invalid','{}',now() from unnest(array[owner_id,admin_id,cashier_id,manager_id,developer_id,outsider]) id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 shop=public.create_shop('Rank test business');
 if not exists(select 1 from public.shop_members where shop_id=shop and user_id=owner_id and role='manager' and rank=3 and access_level=3 and username='manager') then raise exception 'Default Manager not created'; end if;
 if jsonb_array_length(public.list_business_shops())<>1 then raise exception 'Business account mapping failed'; end if;
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',admin_id,'name','Admin','username','admin','role','admin'));
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',cashier_id,'name','Cashier','username','cashier','role','cashier'));
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',manager_id,'name','Manager','username','manager.two','role','manager'));
 -- Developer bootstrap is fixture-only; clients cannot promote themselves.
 insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
 values(shop,developer_id,'developer','Developer','developer',4,4,owner_id,owner_id);
 foreach a in array array[owner_id,admin_id,cashier_id,manager_id,developer_id] loop
  perform set_config('request.jwt.claim.sub',a::text,true);
  select rank into actor_rank from public.shop_members where shop_id=shop and user_id=a;
  for t in select * from public.shop_members where shop_id=shop loop
   permitted=actor_rank>=2 and (actor_rank=4 or a=t.user_id or actor_rank>t.rank);
   begin
    perform public.save_shop_user(shop,'edit',jsonb_build_object('id',t.id,'version',t.version,'name',t.name,'username',t.username,'role',t.role));
    if not permitted then raise exception 'Rank rule allowed forbidden edit'; end if;
   exception when others then
    if permitted or sqlerrm='Rank rule allowed forbidden edit' then raise; end if;
   end;
   select * into target from public.shop_members where id=t.id;
   begin
    perform public.authorize_staff_password_reset(shop,target.id,target.version);
    if not permitted then raise exception 'Rank rule allowed forbidden reset'; end if;
   exception when others then
    if permitted or sqlerrm='Rank rule allowed forbidden reset' then raise; end if;
   end;
  end loop;
 end loop;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 select * into target from public.shop_members where shop_id=shop and user_id=cashier_id;
 perform public.save_shop_user(shop,'revoke',jsonb_build_object('id',target.id,'version',target.version));
 if not exists(select 1 from public.shop_members where id=target.id and rank=1 and access_level=0 and modified_by=admin_id) then raise exception 'Revoke/audit failed'; end if;
 perform set_config('request.jwt.claim.sub',cashier_id::text,true);
 if public.is_shop_member(shop) then raise exception 'Revoked user still has business access'; end if;
 begin perform public.list_shop_users(shop);raise exception 'Cashier can view users';exception when others then if sqlerrm='Cashier can view users' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.save_shop_user(shop,'grant',jsonb_build_object('id',target.id,'version',target.version+1));
 if not exists(select 1 from public.shop_members where id=target.id and access_level=rank) then raise exception 'Grant failed';end if;
 perform public.save_shop_user(shop,'archive',jsonb_build_object('id',target.id,'version',target.version+2));
 perform public.save_shop_user(shop,'restore',jsonb_build_object('id',target.id,'version',target.version+3));
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 select * into target from public.shop_members where shop_id=shop and user_id=manager_id;
 begin perform public.save_shop_user(shop,'archive',jsonb_build_object('id',target.id,'version',target.version));raise exception 'Manager can archive peer';exception when others then if sqlerrm='Manager can archive peer' then raise;end if;end;
 begin perform public.save_shop_user(shop,'revoke',jsonb_build_object('id',target.id,'version',target.version));raise exception 'Manager can revoke peer';exception when others then if sqlerrm='Manager can revoke peer' then raise;end if;end;
 begin
  select * into target from public.shop_members where shop_id=shop and user_id=owner_id;
  perform public.save_shop_user(shop,'edit',jsonb_build_object('id',target.id,'version',target.version,'name',target.name,'username',target.username,'role','developer'));
  raise exception 'Manager elevated self';
 exception when others then if sqlerrm='Manager elevated self' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',developer_id::text,true);
 select * into target from public.shop_members where shop_id=shop and user_id=manager_id;
 perform public.save_shop_user(shop,'archive',jsonb_build_object('id',target.id,'version',target.version));
 perform public.save_shop_user(shop,'restore',jsonb_build_object('id',target.id,'version',target.version+1));
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 other_shop=public.create_shop('Other business');
 begin perform public.list_shop_users(shop);raise exception 'Cross-business users access';exception when others then if sqlerrm='Cross-business users access' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 if jsonb_array_length(public.list_business_shops())<>0 then raise exception 'Staff can become business identity';end if;
 raise notice 'Rank matrix, resets, default Manager, peer protection, grant/revoke, archive/restore and business isolation passed';
end $$;
rollback;
