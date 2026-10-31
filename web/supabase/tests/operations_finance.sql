-- Rollback-only integration fixtures; no business data is retained.
begin;
do $test$
declare shop uuid;u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();other_user uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();payee uuid:=gen_random_uuid();expense uuid:=gen_random_uuid();payment uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();job uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();ev jsonb;led jsonb;cursor text;failed boolean;expected bigint;conf jsonb;
begin
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(u,'operations-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-operations@staff.printshopledger.invalid',now(),'{}',now()),(other_user,'operations-other@example.invalid',now(),'{}',now());
shop=(public.complete_business_registration(u,dev,'Operations test','Tester',repeat('a',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('a',64))->>'shopId')::uuid;
perform set_config('request.jwt.claim.sub',u::text,true);
cursor:=public.get_ledger_changes(shop,null)->>'cursor';
update public.shop_members set access_level=4,rank=4,role='developer' where shop_id=shop and user_id=u;
ev:=jsonb_build_object('id',eid,'kind','account.created','data',jsonb_build_object('id',a,'name','Bank A','accountType','bank','openingDate','2026-10-01','openingBalance',10000,'methods',jsonb_build_array('Transfer'),'modifiedBy',u));
perform public.apply_operations_event(shop,ev);perform public.apply_operations_event(shop,ev);
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.created','data',jsonb_build_object('id',b,'name','Cash','accountType','cash','openingDate','2026-10-01','openingBalance',5000,'methods',jsonb_build_array('Cash'),'modifiedBy',u)));
update public.shop_members set access_level=3,rank=3,role='manager' where shop_id=shop and user_id=u;
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','payee.created','data',jsonb_build_object('id',payee,'name','Paper supplier','phone','0801','address','Market','note','','modifiedBy',u)));
perform public.apply_expense_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','expense.created','data',jsonb_build_object('id',expense,'description','Paper','category','Materials','payeeId',payee,'payee','Paper supplier','note','','receiptReference','','amount',2000,'incurredOn','2026-10-31','materials','[]'::jsonb,'stockIds','{}'::jsonb,'modifiedBy',u,'payment',jsonb_build_object('id',payment,'amount',1200,'paidOn','2026-10-31','method','Transfer','methodLabel','Transfer','source','Business bank account','reference','','accountId',a))));
led:=public.get_ledger(shop);
if jsonb_array_length(led->'moneyAccounts')<>2 or jsonb_array_length(led->'payees')<>1 or led->'expenses'->0->>'payeeId'<>payee::text or led->'expenses'->0->'payments'->0->>'accountId'<>a::text then raise exception 'Account or payee references lost: %',led->'expenses';end if;
if private.operations_balance(shop,a,'2026-10-31')<>8800 then raise exception 'Expense balance incorrect';end if;
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.transferred','data',jsonb_build_object('id',gen_random_uuid(),'accountId',a,'toAccountId',b,'amount',3000,'paidOn','2026-10-31','reason','Cash withdrawal','modifiedBy',u)));
if private.operations_balance(shop,a,'2026-10-31')<>5800 or private.operations_balance(shop,b,'2026-10-31')<>8000 then raise exception 'Transfer not conserved';end if;
failed:=false;begin perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.reconciled','data',jsonb_build_object('id',gen_random_uuid(),'accountId',a,'expectedBalance',8800,'actualBalance',5700,'paidOn','2026-10-31','reason','Counted','modifiedBy',u)));exception when sqlstate 'PT409' then failed:=true;end;if not failed then raise exception 'Stale reconciliation accepted';end if;
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.reconciled','data',jsonb_build_object('id',gen_random_uuid(),'accountId',a,'expectedBalance',5800,'actualBalance',5700,'paidOn','2026-10-31','reason','Counted','modifiedBy',u)));
if private.operations_balance(shop,a,'2026-10-31')<>5700 then raise exception 'Reconciliation incorrect';end if;
perform public.apply_customer_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',customer,'name','Ada','phone','080123','address','','creditLimit',0,'modifiedBy',u)));
-- A wallet deposit is incoming money once; later wallet spending is not another receipt.
eid:=gen_random_uuid();
perform public.apply_checkout_event(shop,jsonb_build_object('id',eid,'kind','checkout.completed','data',jsonb_build_object('id',eid,'customerId',customer,'accountId',a,'createdBy',u,'createdAt',now(),'paidOn','2026-10-31','method','Transfer','methodLabel','Transfer','reference','','useWallet',false,'cashReceived',5000,'walletUsed',0,'walletAdded',5000,'walletAfter',5000,'total',0,'allocated',0,'outstandingBefore',0,'outstandingAfter',0,'expectedAccount',public.checkout_account_token(shop,customer),'jobs','[]'::jsonb,'allocations','[]'::jsonb)));
if private.operations_balance(shop,a,'2026-10-31')<>10700 then raise exception 'Checkout account balance incorrect';end if;
perform set_config('request.jwt.claim.sub',other_user::text,true);
set local role authenticated;
if exists(select 1 from public.business_operations_records where shop_id=shop) then raise exception 'RLS leaked operations';end if;
reset role;
perform set_config('request.jwt.claim.sub',u::text,true);
set local role authenticated;
led:=public.get_ledger(shop);
if jsonb_array_length(led->'moneyAccounts')<>2 then raise exception 'Member could not read accounts';end if;
reset role;
insert into public.jobs(shop_id,id,customer_id,service,description,amount,created_at,metadata) values(shop,job,customer,'Print','Deadline test',1000,now(),jsonb_build_object('dueAt','','productionStatus','Added'));
ev:=jsonb_build_object('id',gen_random_uuid(),'kind','job.due_changed','data',jsonb_build_object('id',job,'jobIds',jsonb_build_array(job),'expectedDueDates',jsonb_build_object(job::text,''),'dueAt','2026-11-03T12:00:00Z','reason','Customer agreed','modifiedBy',u));perform public.apply_operations_event(shop,ev);perform public.apply_operations_event(shop,ev);
if (select jsonb_array_length(metadata->'dueHistory') from public.jobs where shop_id=shop and id=job)<>1 then raise exception 'Deadline history missing or duplicated';end if;
ev:=jsonb_set(ev,'{id}',to_jsonb(gen_random_uuid()));failed:=false;begin perform public.apply_operations_event(shop,ev);exception when sqlstate 'PT409' then failed:=true;end;if not failed then raise exception 'Stale deadline accepted';end if;
perform public.submit_sync_conflict(shop,ev,'Stale deadline');conf:=public.get_sync_conflict(shop,(ev->>'id')::uuid);perform public.resolve_sync_conflict(shop,(ev->>'id')::uuid,conf->>'token','[]'::jsonb,'Keep current deadline');
led:=public.get_ledger_changes(shop,cursor);if jsonb_array_length(led->'ledger'->'moneyAccounts')<>2 or jsonb_array_length(led->'ledger'->'operationHistory')<6 then raise exception 'Delta missing finance operations';end if;
-- Another signed-in user must not see or modify this business.
perform set_config('request.jwt.claim.sub',other_user::text,true);failed:=false;begin perform public.apply_operations_event(shop,ev);exception when others then failed:=true;end;if not failed then raise exception 'Cross-business operation allowed';end if;
failed:=false;begin perform public.get_ledger(shop);exception when others then failed:=true;end;if not failed then raise exception 'Cross-business ledger allowed';end if;
perform set_config('request.jwt.claim.sub',u::text,true);
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.archived','data',jsonb_build_object('id',a,'baseVersion',1,'modifiedBy',u)));
-- A delayed network retry must succeed even though the account is now archived.
perform public.apply_checkout_event(shop,(select payload from public.ledger_events where shop_id=shop and id=eid));
perform public.apply_expense_event(shop,(select payload from public.ledger_events where shop_id=shop and payload->>'kind'='expense.created' limit 1));
update public.shop_members set access_level=1,rank=1,role='cashier' where shop_id=shop and user_id=u;
failed:=false;begin perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.archived','data',jsonb_build_object('id',a,'baseVersion',1,'modifiedBy',u)));exception when others then failed:=true;end;if not failed then raise exception 'Cashier changed accounts';end if;
if has_table_privilege('authenticated','public.business_operations_records','INSERT') or has_function_privilege('anon','public.apply_operations_event(uuid,jsonb)','EXECUTE') then raise exception 'Operations permissions too broad';end if;
end $test$;
rollback;
