begin;
do $$
declare owner_id uuid=gen_random_uuid(); cashier_id uuid=gen_random_uuid(); outsider uuid=gen_random_uuid(); shop uuid; original_version integer;
begin
 insert into auth.users(id,email,raw_user_meta_data,created_at) select id,id::text||'@example.invalid','{}',now() from unnest(array[owner_id,cashier_id,outsider]) id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 shop=public.create_shop('Self credentials test');
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',cashier_id,'name','Cashier','username','cashier','role','cashier'));
 select version into original_version from public.shop_members where shop_id=shop and user_id=cashier_id;
 perform public.update_self_username(shop,cashier_id,'  cashier.updated  ');
 if not exists(select 1 from public.shop_members where shop_id=shop and user_id=cashier_id and username='cashier.updated' and version=original_version+1 and rank=1 and access_level=1 and modified_by=cashier_id) then raise exception 'Self update or audit failed'; end if;
 begin
  perform public.update_self_username(shop,cashier_id,'manager');raise exception 'Duplicate accepted';
 exception when unique_violation then null; end;
 begin
  perform public.update_self_username(shop,cashier_id,'bad username');raise exception 'Invalid accepted';
 exception when others then if sqlerrm='Invalid accepted' then raise; end if; end;
 begin
  perform public.update_self_username(shop,outsider,'outsider');raise exception 'Outsider accepted';
 exception when others then if sqlerrm='Outsider accepted' then raise; end if; end;
 update public.shop_members set access_level=0 where shop_id=shop and user_id=cashier_id;
 begin
  perform public.update_self_username(shop,cashier_id,'revoked');raise exception 'Revoked accepted';
 exception when others then if sqlerrm='Revoked accepted' then raise; end if; end;
 if has_function_privilege('authenticated','public.update_self_username(uuid,uuid,text)','EXECUTE') or has_function_privilege('anon','public.update_self_username(uuid,uuid,text)','EXECUTE') then raise exception 'RPC must be server only'; end if;
end $$;
rollback;
