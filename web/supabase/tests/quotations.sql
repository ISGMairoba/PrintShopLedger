-- Rollback-only fixtures. Never changes business data.
begin;
do $test$
declare shop uuid;shop2 uuid;u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();dev2 uuid:=gen_random_uuid();q jsonb;led jsonb;failed boolean;
 qid uuid:=gen_random_uuid(); cust uuid:=gen_random_uuid(); svc uuid:=gen_random_uuid();
 base jsonb;
begin
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at) values(u,'quote-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-quote@staff.printshopledger.invalid',now(),'{}',now()),(u2,'quote-test2@example.invalid',now(),'{}',now()),(dev2,'staff-developer-quote2@staff.printshopledger.invalid',now(),'{}',now());
shop=(public.complete_business_registration(u,dev,'Quote test','Tester',repeat('a',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('a',64))->>'shopId')::uuid;
shop2=(public.complete_business_registration(u2,dev2,'Other shop','Other',repeat('b',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('b',64))->>'shopId')::uuid;
perform set_config('request.jwt.claim.sub',u::text,true);
perform public.apply_customer_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','customer.created','data',jsonb_build_object('id',cust,'name','Ada','phone','080111','address','Road','creditLimit',0,'modifiedBy',u)));
base:=jsonb_build_object('id',qid,'customerId',cust,'customerName','Ada','customerPhone','080111','note','Deliver Friday','validUntil','2026-10-27','orderDiscount',null,
  'lines',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'serviceId',svc,'service','Flyers','description','A5 flyers','quantity',100,'width',null,'height',null,'unitPrice',5000,'grossAmount',500000,'discountAmount',50000,'amount',450000)),
  'subtotal',500000,'discountTotal',50000,'total',450000,'modifiedBy',u);
base := base || jsonb_build_object('termsAndConditions','Payment before production.');
perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base));
select data into q from public.quotations where id=qid;
if q->>'termsAndConditions' <> 'Payment before production.' then raise exception 'Terms snapshot lost'; end if;
if q->>'status'<>'open' or (q->>'version')::int<>1 or (q->>'total')::int<>450000 or q->>'createdByLabel' is null then raise exception 'Create failed: %',q;end if;
perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base||jsonb_build_object('note','Changed','baseVersion',1)));
select data into q from public.quotations where id=qid;
if q->>'note'<>'Changed' or (q->>'version')::int<>2 then raise exception 'Update failed';end if;
failed:=false;begin perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base||jsonb_build_object('termsAndConditions',repeat('x',5001))));exception when others then failed:=sqlerrm like '%5,000%';end;
if not failed then raise exception 'Oversized terms accepted';end if;
failed:=false;begin perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base||jsonb_build_object('total',1)));exception when others then failed:=sqlerrm like '%add up%';end;
if not failed then raise exception 'Bad totals accepted';end if;
failed:=false;begin perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base||jsonb_build_object('lines','[]'::jsonb,'subtotal',0,'discountTotal',0,'total',0)));exception when others then failed:=true;end;
if not failed then raise exception 'Empty quotation accepted';end if;
perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.converted','data',jsonb_build_object('id',qid,'checkoutId',gen_random_uuid(),'modifiedBy',u)));
perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.archived','data',jsonb_build_object('id',qid,'modifiedBy',u)));
perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base));
select data into q from public.quotations where id=qid;
if q->>'status'<>'converted' or q->>'checkoutId' is null then raise exception 'Converted state lost: %',q;end if;
led:=public.get_ledger(shop);
if jsonb_array_length(led->'quotations')<>1 or not led ? 'jobs' or not led ? 'payments' then raise exception 'Ledger missing quotations or base';end if;
perform set_config('request.jwt.claim.sub',u2::text,true);
failed:=false;begin perform public.apply_quotation_event(shop,jsonb_build_object('id',gen_random_uuid(),'kind','quotation.saved','data',base||jsonb_build_object('modifiedBy',u2)));exception when others then failed:=sqlerrm like '%access denied%';end;
if not failed then raise exception 'Outsider could save';end if;
if jsonb_array_length(public.get_ledger(shop2)->'quotations')<>0 then raise exception 'Other shop sees quotations';end if;
end
$test$;
rollback;
