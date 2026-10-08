begin;
do $$
declare owner_id uuid=gen_random_uuid(); cashier uuid=gen_random_uuid(); admin_id uuid=gen_random_uuid(); outsider uuid=gen_random_uuid();shop uuid;result jsonb;
 settings jsonb='{"businessName":"Mairoba QA","address":"Kano","phones":"080111","email":"studio@example.com","website":"https://example.com","socials":"@studio","logo":"","primary":"#124b40","accent":"#d9a126","theme":"system","receipt":{"showLogo":true,"showAddress":true,"showContacts":true,"footer":"Thank you"}}';
begin
 insert into auth.users(id,email,raw_user_meta_data,created_at)select id,id::text||'@example.invalid','{}',now()from unnest(array[owner_id,cashier,admin_id,outsider])id;
 perform set_config('request.jwt.claim.sub',owner_id::text,true);shop=public.create_shop('Branding QA');
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',cashier,'name','Cashier','username','cashier','role','cashier'));
 perform public.provision_shop_user(shop,owner_id,jsonb_build_object('userId',admin_id,'name','Admin','username','admin','role','admin'));
 result=public.save_business_settings(shop,0,settings);
 if result->>'version'<>'1' or not exists(select 1 from public.shops where id=shop and name='Mairoba QA')then raise exception 'Profile save failed';end if;
 begin perform public.save_business_settings(shop,0,settings);raise exception 'Stale create accepted';exception when serialization_failure then null;end;
 result=public.save_business_settings(shop,1,jsonb_set(settings,'{theme}','"dark"'));
 if result->>'version'<>'2' or(select count(*)from public.business_settings_history where shop_id=shop)<>2 then raise exception 'Audit missing';end if;
 begin perform public.save_business_settings(shop,2,jsonb_set(settings,'{logo}','"javascript:bad"'));raise exception 'Bad logo accepted';exception when others then if sqlerrm='Bad logo accepted' then raise;end if;end;
 if(select version from public.business_settings where shop_id=shop)<>2 then raise exception 'Failed save changed version';end if;
 perform set_config('branding.test_owner',owner_id::text,true);
 perform set_config('branding.test_shop',shop::text,true);
 foreach owner_id in array array[cashier,admin_id,outsider]loop
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  begin perform public.save_business_settings(shop,2,settings);raise exception 'Unauthorized save accepted';exception when others then if sqlerrm='Unauthorized save accepted' then raise;end if;end;
 end loop;
 if has_function_privilege('anon','public.save_business_settings(uuid,integer,jsonb)','EXECUTE')then raise exception 'Anonymous RPC access';end if;
end $$;
-- Exercise real row policies and SECURITY INVOKER privileges, not just postgres checks.
set local role authenticated;
do $$begin
 if exists(select 1 from public.business_settings)then raise exception 'Outsider can read business settings';end if;
 perform set_config('request.jwt.claim.sub',current_setting('branding.test_owner'),true);
 if not exists(select 1 from public.business_settings where shop_id=current_setting('branding.test_shop')::uuid)then raise exception 'Manager cannot read settings';end if;
 perform public.save_business_settings(current_setting('branding.test_shop')::uuid,2,
   (select jsonb_set(settings,'{businessName}','"Authenticated manager QA"') from public.business_settings where shop_id=current_setting('branding.test_shop')::uuid));
 if not exists(select 1 from public.shops where id=current_setting('branding.test_shop')::uuid and name='Authenticated manager QA')then raise exception 'Authenticated manager cannot update business name';end if;
 if(select count(*) from public.business_settings_history where shop_id=current_setting('branding.test_shop')::uuid)<>3 then raise exception 'Authenticated manager audit missing';end if;
end $$;
rollback;
