-- Rollback-only fixture. Business Settings → Features and Team work tabs: who may save the parts of the app,
-- the Team work switch and choices, and the cost method (tab access version 5).
begin;
do $test$
declare u uuid:=gen_random_uuid();dev uuid:=gen_random_uuid();shop uuid;a uuid:=gen_random_uuid();settings jsonb;candidate jsonb;result jsonb;ver integer;failed boolean;before_options jsonb;
begin
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data,created_at)values(u,'features-tab-test@example.invalid',now(),'{}',now()),(dev,'staff-developer-features-tab@staff.printshopledger.invalid',now(),'{}',now());
 shop:=(public.complete_business_registration(u,dev,'Features tab test','Tester',repeat('b',64),'https://print-shop-ledger.vercel.app/#developer_activation='||repeat('b',64))->>'shopId')::uuid;
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.shop_members set access_level=5,rank=5,role='developer'where shop_id=shop and user_id=u;
 select b.settings,b.version into settings,ver from public.business_settings b where shop_id=shop;
 if settings is null then settings:='{"businessName":"Features tab test","address":"","phones":"","email":"","website":"","socials":"","logo":"","logoVariants":{"complete":{"light":"","dark":""},"stacked":{"light":"","dark":""},"horizontal":{"light":"","dark":""},"wordmark":{"light":"","dark":""},"icon":{"light":"","dark":""}},"logoUsage":{"sidebar":"horizontal","documents":"complete","favicon":"icon"},"primary":"#124b40","accent":"#d9a126","theme":"system","backgrounds":{"light":{"canvas":"","surface":"","surfaceAlt":""},"dark":{"canvas":"","surface":"","surfaceAlt":""}},"options":{"paymentMethods":[{"label":"Cash","kind":"Cash","enabled":true},{"label":"POS","kind":"POS","enabled":true},{"label":"Transfer","kind":"Transfer","enabled":true}],"expenseCategories":["Materials","Electricity","Fuel","Rent","Wages","Maintenance","Delivery","Outsourcing","Internet / phone","Other"],"jobSources":["In shop / USB","Shop network","WhatsApp","Email","Other"],"stockReasons":["Restocking","Stock Count Correction","Returned Stock","Damaged Stock"],"materialUnits":["sheet","piece","metre","square metre","roll","kilogram","litre"],"jobStages":["Added","In Queue","Printing","Completed","Collected"]},"corrections":{"recentDays":7},"security":{"autoLockMinutes":0,"syncMinutes":2},"jobs":{"defaultDuration":{"value":0,"unit":"days"},"paymentPrefill":"suggested","descriptionMode":"required","stockBelowZero":"allow"},"pricing":{"enabled":false,"maxTemplates":100,"auditRanks":[2,3],"templates":[]},"periods":{"dashboard":"month","reports":"month","pointOfService":"30days","jobs":"all","payments":"all","expenses":"all","stockHistory":"all","mySales":"today"},"discounts":{"maxPercent":{"1":0,"2":20,"3":100}},"terms":{"preset":"print","job":"job","jobs":"jobs","service":"service","services":"services","material":"material","materials":"materials","stages":{"Added":"Added","Completed":"Completed","Collected":"Collected"}},"pageAccess":{"1":["Point of Service","Quotations","Pricing Templates","My Sales","Print Settings","My Account"],"2":["Dashboard","Reports","Point of Service","Quotations","Pricing Templates","My Sales","Jobs","Customers","Payment Reminders","Payments","Expenses","Payees","Accounts","Materials","Services","Edit Products","Stock History","Print Settings","Users","My Account","Conflict Inbox","Sale Adjustments","Material Waste"],"3":["Dashboard","Reports","Point of Service","Quotations","Pricing Templates","My Sales","Jobs","Customers","Payment Reminders","Payments","Expenses","Payees","Accounts","Materials","Services","Edit Products","Stock History","Print Settings","Users","My Account","Conflict Inbox","Sale Adjustments","Material Waste"]},"pageAccessVersion":3,"settingsTabs":{"2":["Profile & logo","Appearance","Receipts","Payment methods","Dropdowns & workflow","Jobs & payments","Pricing templates","Corrections","Security","Branches"],"3":["Profile & logo","Appearance","Receipts","Payment methods","Dropdowns & workflow","Jobs & payments","Pricing templates","Corrections","Security","Branches"]},"settingsTabsVersion":1,"receipt":{"showLogo":true,"showBusinessName":true,"showAddress":true,"showContacts":true,"footer":"Thank you for your business.","logoLayout":"","logoPosition":"right","headline":"description","showSubline":true,"showJobId":true,"showQuantity":true,"showSize":true,"showSource":true,"showDueDate":true,"showPaidBefore":true,"showPaidNow":true,"showItemBalance":true,"showCustomerPhone":true,"showCashier":true,"showPaymentDate":true,"showPaymentMethod":true,"showWalletMovements":true,"showAccountBalances":true,"showNote":true},"receiptPage":{"logoLayout":"","logoPosition":"right","showLogo":true,"showBusinessName":true,"showAddress":true,"showContacts":true,"footer":"Thank you for your business.","headline":"description","showSubline":true,"showJobId":true,"showQuantity":true,"showSize":true,"showSource":true,"showDueDate":true,"showPaidBefore":true,"showPaidNow":true,"showItemBalance":true,"showCustomerPhone":true,"showCashier":true,"showPaymentDate":true,"showPaymentMethod":true,"showWalletMovements":true,"showAccountBalances":true,"showNote":true},"documents":{"watermark":false,"watermarkLogoLayout":"","invoiceTerms":"","quotationTerms":"","showTermsOnRoll":false},"poweredBy":{"text":"","receipts":false,"pages":false,"reports":false,"shares":false},"branches":[],"branchAccess":{}}'::jsonb;ver:=0;end if;
 settings:=settings||jsonb_build_object('settingsTabsVersion',4,'pageAccessVersion',3,'settingsTabs',
   jsonb_build_object('2',jsonb_build_array('Receipts'),'3',jsonb_build_array('Jobs & payments'),'4',jsonb_build_array('Receipts')));
 settings:=jsonb_set(settings,'{pageAccess,3}',(select jsonb_agg(distinct x) from jsonb_array_elements((settings->'pageAccess'->'3')||'["Business Settings"]'::jsonb) x));
 settings:=jsonb_set(settings,'{pageAccess,4}',(select jsonb_agg(distinct x) from jsonb_array_elements(coalesce(settings->'pageAccess'->'4',settings->'pageAccess'->'3')||'["Business Settings"]'::jsonb) x));
 result:=public.save_business_settings(shop,ver,settings);settings:=result->'settings';ver:=(result->>'version')::int;

 -- General Manager: Features (version 5) saves the parts of the app and switches Team work on.
 update public.shop_members set access_level=4,rank=4,role='general_manager' where shop_id=shop and user_id=u;
 candidate:=settings||jsonb_build_object('features',jsonb_build_object('Quotations',false),'teamWork',jsonb_build_object('enabled',true),'costMethod','actual');
 result:=public.save_business_settings(shop,ver,candidate);settings:=result->'settings';ver:=(result->>'version')::int;
 if settings->'features'->>'Quotations' is distinct from 'false' then raise exception 'General Manager could not turn a part off: %',settings->'features';end if;
 if settings->'teamWork'->>'enabled' is distinct from 'true' then raise exception 'General Manager could not switch Team work on';end if;
 if settings->>'costMethod' is not null then raise exception 'General Manager without Jobs & payments changed the cost method';end if;

 -- Manager with Jobs & payments: gets Team work (its choices) and the cost method; not Features.
 update public.shop_members set access_level=3,rank=3,role='manager' where shop_id=shop and user_id=u;
 candidate:=settings||jsonb_build_object('features','{}'::jsonb,'costMethod','actual',
   'teamWork',(settings->'teamWork')||jsonb_build_object('correctRank',3));
 result:=public.save_business_settings(shop,ver,candidate);settings:=result->'settings';ver:=(result->>'version')::int;
 if settings->>'costMethod' is distinct from 'actual' then raise exception 'Manager could not save the cost method';end if;
 if settings->'teamWork'->>'correctRank' is distinct from '3' then raise exception 'Manager could not save Team work choices';end if;
 if settings->'features'->>'Quotations' is distinct from 'false' then raise exception 'Manager changed the parts of the app';end if;
 failed:=false;
 begin
   perform public.save_business_settings(shop,ver,settings||jsonb_build_object('teamWork',(settings->'teamWork')||jsonb_build_object('enabled',false)));
 exception when others then failed:=sqlerrm like 'Only a General Manager%';
 end;
 if not failed then raise exception 'Manager switched Team work off';end if;

 -- The tab names can be given.
 update public.shop_members set access_level=5,rank=5,role='developer' where shop_id=shop and user_id=u;
 result:=public.save_business_settings(shop,ver,settings||jsonb_build_object('settingsTabs',
   jsonb_build_object('2',jsonb_build_array('Team work'),'3',jsonb_build_array('Features'),'4',jsonb_build_array('Features','Team work'))));
 raise notice 'Features tab passed';
end $test$;
rollback;
