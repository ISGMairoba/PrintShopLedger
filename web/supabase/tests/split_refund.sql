-- Rollback-only real RPC, RLS, stock, allocation, refund and drawer tests.
begin;
insert into auth.users(id,email) values('3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de','3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de@example.invalid'),('aabec74a-cc33-4101-81da-c1f2ce485b28','aabec74a-cc33-4101-81da-c1f2ce485b28@example.invalid'),('821f423c-50a3-4a12-a214-4dbee970c8d2','821f423c-50a3-4a12-a214-4dbee970c8d2@example.invalid');
insert into public.shops(id,name) values('fc84b3cf-d4d9-4c0a-ace4-3243a09a90a3','Sales adjustment integration test');
insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level) values('fc84b3cf-d4d9-4c0a-ace4-3243a09a90a3','3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de','manager','Manager','manager',3,3),('fc84b3cf-d4d9-4c0a-ace4-3243a09a90a3','aabec74a-cc33-4101-81da-c1f2ce485b28','cashier','Cashier','cashier',1,1);
select set_config('test.adjust_shop','fc84b3cf-d4d9-4c0a-ace4-3243a09a90a3',true),set_config('test.adjust_user','3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de',true),set_config('test.adjust_cashier','aabec74a-cc33-4101-81da-c1f2ce485b28',true),set_config('test.adjust_other','821f423c-50a3-4a12-a214-4dbee970c8d2',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de',true);
do $$
declare s uuid:='fc84b3cf-d4d9-4c0a-ace4-3243a09a90a3';u uuid:='3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de';m uuid:='20a29447-16c5-4793-bc2a-aaaa4dc08ada';j uuid:='d4c49873-561c-4b92-966f-82992d9ef198';cu uuid:='1900920d-2037-4ead-b56f-ac0660a2d676';e jsonb;d jsonb;base jsonb;updated jsonb;rejected boolean;refundid uuid;wasteid uuid;cancelid uuid;tok text;r1 uuid;r2 uuid;evs jsonb;
begin
perform public.apply_customer_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',cu,'name','Customer','phone','0801','address','Road','creditLimit',0,'modifiedBy',u)));
perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',jsonb_build_object('id',m,'name','Paper','available',10,'measurementUnit','sheet','requireSize',false,'modifiedBy',u)));
perform public.apply_service_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','service.created','data',jsonb_build_object('id','9385a979-c1d8-41a1-9a71-c23aa6cdc85b','description','Printing','materialId',m,'price',10000,'modifiedBy',u)));
perform test.checkout(s,$checkout${"id":"899754f2-b39f-44f9-ac76-85ea1a1af4e7","kind":"checkout.completed","data":{"id":"899754f2-b39f-44f9-ac76-85ea1a1af4e7","customerId":"1900920d-2037-4ead-b56f-ac0660a2d676","newCustomer":null,"customerSnapshot":{"id":"1900920d-2037-4ead-b56f-ac0660a2d676","name":"Customer","phone":"0801","address":"Road"},"jobBalances":[{"id":"d4c49873-561c-4b92-966f-82992d9ef198","description":"Print job","service":"Printing","amount":20000,"paidBefore":0,"paidThisCheckout":20000,"outstandingAfter":0}],"jobs":[{"id":"d4c49873-561c-4b92-966f-82992d9ef198","serviceId":"9385a979-c1d8-41a1-9a71-c23aa6cdc85b","description":"Print job","quantity":2,"source":"In shop / USB","stockCountEventId":null,"width":null,"height":null,"amount":20000,"unitPrice":10000,"service":"Printing","materialId":"20a29447-16c5-4793-bc2a-aaaa4dc08ada","materialNeeded":2,"measurementUnit":"sheet","requireSize":false,"serviceVersion":1,"sourceNote":"","customerId":"1900920d-2037-4ead-b56f-ac0660a2d676","createdAt":"2026-10-08T22:54:04.772Z","checkoutId":"899754f2-b39f-44f9-ac76-85ea1a1af4e7","checkoutPosition":0,"productionStatus":"Added","version":1,"createdBy":"3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de","createdByLabel":"Manager","modifiedBy":"3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de","modifiedByLabel":"Manager","modifiedAt":"2026-10-08T22:54:04.772Z"}],"expectedAccount":"wallet=0;","cashReceived":20000,"useWallet":false,"override":null,"method":"Cash","paidOn":"2026-10-08","reference":"","createdBy":"3fe7f4ce-f2d3-4ac4-a56c-e239fb8f34de","createdByLabel":"Manager","createdAt":"2026-10-08T22:54:04.772Z","total":20000,"allocations":[{"jobId":"d4c49873-561c-4b92-966f-82992d9ef198","amount":20000}],"allocated":20000,"walletUsed":0,"walletAdded":0,"walletAfter":0,"outstandingBefore":20000,"outstandingAfter":0}}$checkout$::jsonb);
d=jsonb_build_object('jobId',j,'baseVersion',1,'expectedAccount',public.checkout_account_token(s,cu),'reason','Cancel','returnQuantity',0,'materialVersion',1,'stockEventId',gen_random_uuid(),'modifiedBy',u);
perform public.apply_supervised_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','sale.cancelled','data',d));
-- The second refund's balance token, as the first leaves it (worked out and undone).
begin
  perform public.apply_supervised_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','sale.refunded','data',jsonb_build_object('jobId',j,'baseVersion',2,'expectedAccount',public.checkout_account_token(s,cu),'refundAmount',5000,'method','Cash','methodLabel','Cash','paidOn',(clock_timestamp() at time zone 'Africa/Lagos')::date,'reason','Split refund','modifiedBy',u)));
  tok := public.checkout_account_token(s,cu);
  raise exception 'undo';
exception when others then if sqlerrm <> 'undo' then raise; end if;
end;
r1=gen_random_uuid(); r2=gen_random_uuid();
evs=jsonb_build_array(
  jsonb_build_object('id',r1,'kind','sale.refunded','data',jsonb_build_object('jobId',j,'baseVersion',2,'expectedAccount',public.checkout_account_token(s,cu),'refundAmount',5000,'method','Cash','methodLabel','Cash','paidOn',(clock_timestamp() at time zone 'Africa/Lagos')::date,'reason','Split refund','modifiedBy',u)),
  jsonb_build_object('id',r2,'kind','sale.refunded','data',jsonb_build_object('jobId',j,'baseVersion',3,'expectedAccount',tok,'refundAmount',3000,'method','Transfer','methodLabel','Transfer','paidOn',(clock_timestamp() at time zone 'Africa/Lagos')::date,'reason','Split refund','modifiedBy',u)));
-- Too much in total: neither is saved.
rejected=false;
begin perform public.apply_supervised_events(s,jsonb_set(evs,'{1,data,refundAmount}','30000'));exception when others then rejected=true;end;
if not rejected or exists(select 1 from public.sale_adjustments where shop_id=s and id=r1) then raise exception 'Part of a failed split refund was kept';end if;
perform public.apply_supervised_events(s,evs);
if (select count(*) from public.sale_adjustments where shop_id=s and id in (r1,r2))<>2 or (select sum(wallet_added-wallet_used) from public.payments where shop_id=s and customer_id=cu)<>12000 then raise exception 'Split refund not saved: %',(select sum(wallet_added-wallet_used) from public.payments where shop_id=s and customer_id=cu);end if;
-- Refunds for two jobs, or mixed kinds, are not saved together.
rejected=false;
begin perform public.apply_supervised_events(s,jsonb_build_array(evs->0,jsonb_build_object('id',gen_random_uuid(),'kind','sale.corrected','data','{}'::jsonb)));exception when others then rejected=(sqlerrm like 'Only payment corrections%');end;
if not rejected then raise exception 'Mixed changes saved together';end if;
raise notice 'Split refund passed';
end $$;
rollback;