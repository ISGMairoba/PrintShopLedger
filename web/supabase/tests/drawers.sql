-- Rollback-only fixtures: checks atomic closing, receipt isolation, retry safety and drawer cash.
begin;
do $$
declare a uuid=gen_random_uuid();b uuid=gen_random_uuid();outsider uuid=gen_random_uuid();s uuid;c uuid=gen_random_uuid();
 r1 uuid=gen_random_uuid();r2 uuid=gen_random_uuid();r3 uuid=gen_random_uuid();r4 uuid=gen_random_uuid();br uuid=gen_random_uuid();br2 uuid=gen_random_uuid();
 opening uuid=gen_random_uuid();closing uuid=gen_random_uuid();result jsonb;again jsonb;ids uuid[];
begin
 insert into auth.users(id,email,raw_user_meta_data,created_at) select id,id::text||'@example.invalid','{}',now() from unnest(array[a,b,outsider]) id;
 perform set_config('request.jwt.claim.sub',a::text,true);
 s=public.create_shop('Drawer test');
 perform public.provision_shop_user(s,a,jsonb_build_object('userId',b,'name','Receiver','username','receiver','role','cashier'));
 perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',c,'name','Drawer customer','phone','08012345678','address','','creditLimit',0,'modifiedBy',a)));
 insert into public.checkout_records(shop_id,id,customer_id,data)
 select s,id,c,jsonb_build_object('id',id,'createdBy',actor,'cashReceived',cash,'method',method,'walletUsed',wallet,'total',total) from (values
 (r1,a,7000,'Cash',0,20000),(r2,a,3000,'POS',0,3000),(r3,a,5000,'Transfer',0,5000),(r4,a,0,'Cash',2000,0),(br,b,1000,'Cash',0,1000)) fixture(id,actor,cash,method,wallet,total);
 perform public.finish_drawer_handover(s,b,a,opening,1000,array[br],null,'Opening cash');
 insert into public.checkout_records(shop_id,id,customer_id,data) values(s,br2,c,jsonb_build_object('createdBy',b,'cashReceived',3000,'method','Cash','walletUsed',0,'total',3000));
 ids=array[r1,r2,r3,r4];
 begin perform public.finish_drawer_handover(s,a,b,closing,7500,array[r1],opening,'Shortage');raise exception 'Stale close accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select 1 from public.drawer_closings where id=closing) or exists(select 1 from public.checkout_records where id=r1 and drawer_closing_id is not null) then raise exception 'Failed close made partial changes';end if;
 result=public.finish_drawer_handover(s,a,b,closing,7500,ids,opening,'Shortage');
 if (result->>'cashCollected')::bigint<>7000 or (result->>'expectedCash')::bigint<>8000 or (result->>'difference')::bigint<>-500 or (result->>'totalCollected')::bigint<>15000 or (result->>'walletUsed')::bigint<>2000 then raise exception 'Cash totals wrong: %',result;end if;
 if (select count(*) from public.checkout_records where shop_id=s and drawer_closing_id=closing)<>4 or exists(select 1 from public.checkout_records where id=br2 and drawer_closing_id is not null) then raise exception 'Closing touched wrong transactions';end if;
 again=public.finish_drawer_handover(s,a,b,closing,7500,ids,opening,'Shortage');
 if again<>result or (select count(*) from public.drawer_closings where id=closing)<>1 then raise exception 'Retry duplicated closing';end if;
 begin perform public.finish_drawer_handover(s,a,b,gen_random_uuid(),7500,ids,opening,'');raise exception 'Closed receipts reused';exception when sqlstate 'PT409' then null;end;
 begin perform public.finish_drawer_handover(s,a,outsider,gen_random_uuid(),0,'{}',null,'');raise exception 'Outsider receiver accepted';exception when others then if sqlerrm='Outsider receiver accepted' then raise;end if;end;
 update public.shop_members set access_level=0 where shop_id=s and user_id=a;
 begin perform public.finish_drawer_handover(s,b,a,gen_random_uuid(),10500,array[br2],closing,'');raise exception 'Revoked receiver accepted';exception when others then if sqlerrm='Revoked receiver accepted' then raise;end if;end;
 update public.shop_members set access_level=3 where shop_id=s and user_id=a;
 result=public.finish_drawer_handover(s,b,a,gen_random_uuid(),10500,array[br2],closing,'');
 if (result->>'openingCash')::bigint<>7500 or (result->>'expectedCash')::bigint<>10500 then raise exception 'Incoming drawer cash not carried';end if;
 if has_function_privilege('authenticated','public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text)','EXECUTE') or has_function_privilege('anon','public.finish_drawer_handover(uuid,uuid,uuid,uuid,bigint,uuid[],uuid,text)','EXECUTE') then raise exception 'Browser can bypass password verification';end if;
 -- Exercise actual RLS under the browser role, including get_ledger's wrapper.
 perform set_config('request.jwt.claim.sub',a::text,true);
 execute 'set local role authenticated';
 if jsonb_array_length(public.get_ledger(s)->'drawerClosings')<>3 then raise exception 'Member cannot read their handovers';end if;
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 if exists(select 1 from public.drawer_closings where shop_id=s) then raise exception 'Drawer RLS exposed other business';end if;
 begin perform public.get_ledger(s);raise exception 'Outsider ledger permitted';exception when others then if sqlerrm='Outsider ledger permitted' then raise;end if;end;
 execute 'reset role';
 raise notice 'Drawer cash, isolation, atomic failure, retries, opening cash, active access and RLS checks passed';
end $$;
rollback;
