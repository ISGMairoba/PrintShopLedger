-- Rollback-only fixtures. Never changes business data.
begin;
do $test$
declare shop uuid;u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();rid uuid:=gen_random_uuid();ev jsonb;led jsonb;failed boolean;
begin
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(u,'remind-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-remind@staff.printshopledger.invalid',now(),'{}',now());
shop=(public.complete_business_registration(u,dev,'Remind test','Tester',repeat('a',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('a',64))->>'shopId')::uuid;
perform set_config('request.jwt.claim.sub',u::text,true);
perform public.apply_customer_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',cust,'name','Ada','phone','080111','address','','creditLimit',0,'modifiedBy',u)));
ev:=jsonb_build_object('id',gen_random_uuid(),'kind','customer.reminded','data',jsonb_build_object('id',rid,'customerId',cust,'amountOwed',250000,'channel','whatsapp','modifiedBy',u));
perform public.apply_reminder_event(shop,ev);
perform public.apply_reminder_event(shop,ev); -- same event again is ignored
led:=public.get_ledger(shop);
if jsonb_array_length(led->'reminders')<>1 or (led->'reminders'->0->>'amountOwed')::int<>250000 or led->'reminders'->0->>'remindedByLabel' is null then raise exception 'Reminder not listed: %',led->'reminders';end if;
if not led ? 'quotations' or not led ? 'jobs' then raise exception 'Ledger lost its other parts';end if;
failed:=false;begin perform public.apply_reminder_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.reminded','data',jsonb_build_object('id',gen_random_uuid(),'customerId',gen_random_uuid(),'amountOwed',1,'channel','whatsapp','modifiedBy',u)));exception when others then failed:=true;end;
if not failed then raise exception 'Unknown customer accepted';end if;
end
$test$;
rollback;
