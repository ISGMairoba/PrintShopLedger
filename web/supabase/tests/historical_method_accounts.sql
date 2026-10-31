begin;
do $test$
declare u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();shop uuid;c uuid:=gen_random_uuid();j uuid:=gen_random_uuid();p1 uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();personal_id uuid:=gen_random_uuid();refund_id uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid;ev jsonb;result jsonb;failed boolean;n integer;
begin
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(u,'method-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-method-test@staff.printshopledger.invalid',now(),'{}',now());
shop:=(public.complete_business_registration(u,dev,'Method accounts test','Tester',repeat('a',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('a',64))->>'shopId')::uuid;
perform set_config('request.jwt.claim.sub',u::text,true);
update public.business_settings set settings=jsonb_set(settings,'{options,paymentMethods}','[{"label":"Old card","kind":"POS","enabled":true},{"label":"Old transfer","kind":"Transfer","enabled":true}]') where shop_id=shop;
perform public.apply_customer_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',c,'name','Customer','phone','0801','address','','creditLimit',0,'modifiedBy',u)));
insert into public.payments(shop_id,id,customer_id,amount,method,method_label,paid_on,reference,created_at) values(shop,p1,c,1000,'POS','Old card','2026-09-01','','2026-09-01'),(shop,p2,c,2000,'Transfer','Old transfer','2026-09-02','','2026-09-02');
insert into public.jobs(shop_id,id,customer_id,service,description,amount,created_at,metadata) values(shop,j,c,'Print','Refund fixture',1000,now(),'{}');
insert into public.sale_adjustments(shop_id,id,job_id,actor_id,data) values(shop,refund_id,j,u,jsonb_build_object('id',refund_id,'action','sale.refunded','refundAmount',100,'method','Transfer','methodLabel','Old transfer','paidOn','2026-09-03'));
insert into public.expenses(shop_id,id,data) values(shop,gen_random_uuid(),jsonb_build_object('payments',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'amount',300,'paidOn','2026-09-03','method','Transfer','methodLabel','Old transfer','source','Business bank account'),jsonb_build_object('id',personal_id,'amount',500,'paidOn','2026-09-03','method','POS','methodLabel','Old card','source','Personal funds'))));
-- Manager cannot create or configure an account, even through the API.
ev:=jsonb_build_object('id',gen_random_uuid(),'kind','account.created','data',jsonb_build_object('id',a,'name','Existing wallet','accountType','pos','openingDate','2026-10-01','openingBalance',5000,'methods',jsonb_build_array('Old card'),'modifiedBy',u));
failed:=false;begin perform public.apply_operations_event(shop,ev);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Manager created an account';end if;
update public.shop_members set role='developer',rank=4,access_level=4 where shop_id=shop and user_id=u;
perform public.apply_operations_event(shop,ev);
result:=private.backfill_method_accounts(shop);
if (result->>'accountsCreated')::integer<>1 or (result->>'transactionsAssigned')::integer<>4 then raise exception 'Unexpected import counts: %',result;end if;
select id into b from public.business_operations_records where shop_id=shop and collection='moneyAccounts' and data->>'name'='Old transfer';
if b is null or private.operations_balance(shop,b,'2026-10-31')<>1600 then raise exception 'Historical receipts/expenses/refunds not combined correctly: %, %',private.operations_balance(shop,b,'2026-10-31'),private.operations_transactions(shop);end if;
if private.operations_balance(shop,a,'2026-10-31')<>5000 then raise exception 'Opening balance was double counted';end if;
if exists(select 1 from public.business_operations_records where shop_id=shop and collection='accountEntries' and data->>'transactionId'='expense:'||personal_id) then raise exception 'Personal funds charged to business account';end if;
result:=private.backfill_method_accounts(shop);if (result->>'accountsCreated')::integer<>0 or (result->>'transactionsAssigned')::integer<>0 then raise exception 'Repeated migration duplicated records';end if;
-- Developers can still link several future methods to one account.
ev:=jsonb_build_object('id',gen_random_uuid(),'kind','account.updated','data',jsonb_build_object('id',a,'baseVersion',1,'name','Existing wallet','accountType','pos','methods',jsonb_build_array('Old card','New transfer'),'modifiedBy',u));
perform public.apply_operations_event(shop,ev);
update public.shop_members set role='manager',rank=3,access_level=3 where shop_id=shop and user_id=u;
ev:=jsonb_set(jsonb_set(ev,'{id}',to_jsonb(gen_random_uuid())),'{data,baseVersion}','2');failed:=false;begin perform public.apply_operations_event(shop,ev);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Manager changed account links';end if;
-- Reviewing a Developer's pending command must not bypass the reviewer's permissions.
insert into public.shop_members(shop_id,user_id,name,username,role,rank,access_level) values(shop,dev,'Test Developer','test-developer','developer',4,4) on conflict do nothing;
ev:=jsonb_set(ev,'{data,modifiedBy}',to_jsonb(dev));failed:=false;begin perform private.apply_reviewed_operation(shop,ev,dev);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Manager used review to bypass Developer-only setup';end if;
-- The other account operations remain available to management.
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.transferred','data',jsonb_build_object('id',gen_random_uuid(),'accountId',b,'toAccountId',a,'amount',100,'paidOn','2026-10-31','reason','Bank transfer','modifiedBy',u)));
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.reconciled','data',jsonb_build_object('id',gen_random_uuid(),'accountId',b,'expectedBalance',1500,'actualBalance',1450,'paidOn','2026-10-31','reason','Verified against bank','modifiedBy',u)));
if private.operations_balance(shop,b,'2026-10-31')<>1450 then raise exception 'Manager reconciliation unavailable';end if;
if has_function_privilege('authenticated','private.backfill_method_accounts(uuid)','EXECUTE') then raise exception 'Import helper exposed';end if;
end $test$;
rollback;
