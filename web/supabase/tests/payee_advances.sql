-- Rollback-only fixture. Paying a payee once, with advances: an advance out of an account, an expense
-- paid from it (no account moves), money given back, and nothing taking the advance below zero.
begin;
do $test$
declare shop uuid;u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();a uuid:=gen_random_uuid();payee uuid:=gen_random_uuid();
  x1 uuid:=gen_random_uuid();x2 uuid:=gen_random_uuid();adv uuid:=gen_random_uuid();refused text;bal bigint;
begin
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(u,'payee-advance-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-payee-advance@staff.printshopledger.invalid',now(),'{}',now());
shop=(public.complete_business_registration(u,dev,'Payee advance test','Tester',repeat('d',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('d',64))->>'shopId')::uuid;
perform test.without_default_accounts(shop);
perform set_config('request.jwt.claim.sub',u::text,true);
update public.shop_members set access_level=5,rank=5,role='developer' where shop_id=shop and user_id=u;
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.created','data',jsonb_build_object('id',a,'name','Bank','accountType','bank','openingDate','2026-10-01','openingBalance',100000,'methods',jsonb_build_array('Transfer'),'modifiedBy',u)));
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','payee.created','data',jsonb_build_object('id',payee,'name','Paper supplier','phone','','address','','note','','modifiedBy',u)));

-- An advance of 30,000 to the payee: out of the bank.
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.money_moved','data',jsonb_build_object('id',adv,'accountId',a,'paidOn','2026-10-20','reason','Advance','moneyType','payee_advance','amount',30000,'payeeId',payee,'modifiedBy',u)));
if private.payee_advance(shop,payee)<>30000 or private.operations_balance(shop,a,'2026-10-31')<>70000 then raise exception 'Advance not recorded';end if;

-- An expense paid from the advance: no account; more than is held is refused.
refused:='';
begin
perform public.apply_expense_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','expense.created','data',jsonb_build_object('id',x1,'description','Paper','category','Materials','payeeId',payee,'payee','Paper supplier','note','','receiptReference','','amount',40000,'incurredOn','2026-10-21','materials','[]'::jsonb,'stockIds','{}'::jsonb,'modifiedBy',u,
  'payment',jsonb_build_object('id',gen_random_uuid(),'amount',40000,'paidOn','2026-10-21','method','Other','methodLabel','Advance','source','Payee advance','reference',''))));
exception when others then refused:=sqlerrm;
end;
if refused not like 'That is more than the advance%' then raise exception 'Over the advance: %',refused;end if;
perform public.apply_expense_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','expense.created','data',jsonb_build_object('id',x1,'description','Paper','category','Materials','payeeId',payee,'payee','Paper supplier','note','','receiptReference','','amount',40000,'incurredOn','2026-10-21','materials','[]'::jsonb,'stockIds','{}'::jsonb,'modifiedBy',u,
  'payment',jsonb_build_object('id',gen_random_uuid(),'amount',25000,'paidOn','2026-10-21','method','Other','methodLabel','Advance','source','Payee advance','reference',''))));
if private.payee_advance(shop,payee)<>5000 or private.operations_balance(shop,a,'2026-10-31')<>70000 then raise exception 'Advance payment moved an account';end if;
if exists(select 1 from jsonb_array_elements(private.operations_transactions(shop)) t where t->>'amount'='25000') then raise exception 'Advance payment listed as a transaction';end if;
refused:='';
begin
perform public.apply_expense_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','expense.payment_recorded','data',jsonb_build_object('id',x1,'baseVersion',1,'modifiedBy',u,'stockIds','{}'::jsonb,
  'payment',jsonb_build_object('id',gen_random_uuid(),'amount',1000,'paidOn','2026-10-21','method','Other','methodLabel','Advance','source','Payee advance','reference','','accountId',a))));
exception when others then refused:=sqlerrm;
end;
if refused not like 'A payment from an advance does not come from an account%' then raise exception 'Advance with account: %',refused;end if;

-- Money given back: no more than is held.
refused:='';
begin
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.money_moved','data',jsonb_build_object('id',gen_random_uuid(),'accountId',a,'paidOn','2026-10-22','reason','Back','moneyType','advance_returned','amount',6000,'payeeId',payee,'modifiedBy',u)));
exception when others then refused:=sqlerrm;
end;
if refused not like 'That is more than the advance held%' then raise exception 'Return over the advance: %',refused;end if;
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.money_moved','data',jsonb_build_object('id',gen_random_uuid(),'accountId',a,'paidOn','2026-10-22','reason','Back','moneyType','advance_returned','amount',5000,'payeeId',payee,'modifiedBy',u)));
if private.payee_advance(shop,payee)<>0 or private.operations_balance(shop,a,'2026-10-31')<>75000 then raise exception 'Return not recorded';end if;

-- The used advance cannot be cancelled.
refused:='';
begin
perform public.apply_operations_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','account.entry_corrected','data',jsonb_build_object('id',adv,'baseVersion',1,'cancel',true,'correctionReason','Mistake','modifiedBy',u)));
exception when others then refused:=sqlerrm;
end;
if refused not like 'The advance already used%' then raise exception 'Cancelled a used advance: %',refused;end if;
raise notice 'Payee advances passed';
end $test$;
rollback;
