begin;
do $test$
declare u uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); e jsonb; v jsonb;
begin
insert into auth.users(id,email,raw_user_meta_data) values(u,'ledger-test-'||u||'@example.invalid','{"full_name":"Database Test"}');
insert into public.shops(id,name) values(s,'Rollback test'),(other,'Other rollback test');
insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level) values(s,u,'manager','Database Test','manager',3,3);
perform set_config('request.jwt.claim.sub',u::text,true);
e:=jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',c,'name','Test Name','phone','0801','address','Road','creditLimit',12345,'modifiedBy',u,'modifiedByLabel','Forged Label'));
perform public.apply_customer_event(s,e);perform public.apply_customer_event(s,e);
if (select count(*) from public.customers where shop_id=s)<>1 then raise exception 'Idempotency failed'; end if;
if (select created_by_label from public.customers where shop_id=s and id=c)<>'Database Test' then raise exception 'Trusted audit failed'; end if;
perform public.apply_ledger_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','job.created','data',jsonb_build_object('id',j,'customerId',c,'description','Test job','service','Printing','amount',10000,'createdAt',now())));
perform public.apply_ledger_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','payment.recorded','data',jsonb_build_object('id',p,'customerId',c,'amount',4000,'method','Cash','paidOn',current_date,'createdAt',now(),'allocations',jsonb_build_array(jsonb_build_object('jobId',j,'amount',4000)))));
perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.updated','data',jsonb_build_object('id',c,'baseVersion',1,'name','Updated','phone','0802','creditLimit',0,'modifiedBy',u)));
perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.archived','data',jsonb_build_object('id',c,'baseVersion',2,'modifiedBy',u)));
if not (select archived from public.customers where shop_id=s and id=c) then raise exception 'Archive failed'; end if;
if (select amount from public.jobs where shop_id=s and id=j) - (select sum(amount) from public.payment_allocations where shop_id=s and job_id=j)<>6000 then raise exception 'Payment balance changed'; end if;
begin
perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.restored','data',jsonb_build_object('id',c,'baseVersion',1,'modifiedBy',u)));
raise exception 'Stale version accepted';
exception when serialization_failure then null; end;
perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.restored','data',jsonb_build_object('id',c,'baseVersion',3,'modifiedBy',u)));
begin
perform public.get_ledger(other);raise exception 'Cross-business access accepted';
exception when others then if sqlerrm='Cross-business access accepted' then raise; end if; end;
begin
perform public.apply_customer_event(other,e);raise exception 'Cross-business write accepted';
exception when others then if sqlerrm='Cross-business write accepted' then raise; end if; end;
v:=public.get_ledger(s);
if (v->'customers'->0->>'creditLimit')::bigint<>0 or (v->'customers'->0->>'version')::integer<>4 then raise exception 'Customer snapshot failed'; end if;
perform public.apply_ledger_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',gen_random_uuid(),'name','Legacy','phone','','createdAt',now())));
end $test$;
select 'Customer database checks passed; all test records rolled back' as result;
rollback;
