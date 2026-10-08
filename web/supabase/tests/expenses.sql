-- All synthetic users and records are rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();o uuid:=gen_random_uuid();c uuid:=gen_random_uuid();s uuid:=gen_random_uuid();os uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(o,o::text||'@example.invalid'),(c,c::text||'@example.invalid');
 insert into public.shops(id,name) values(s,'Expense test'),(os,'Other business');
 insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level) values(s,u,'manager','Expense owner','manager',3,3),(os,o,'manager','Other owner','manager',3,3),(s,c,'cashier','Cashier','cashier',1,1);
 perform set_config('test.expense_user',u::text,true);perform set_config('test.expense_outsider',o::text,true);perform set_config('test.expense_cashier',c::text,true);perform set_config('test.expense_shop',s::text,true);
end;$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.expense_user'),true);
do $$
declare s uuid:=current_setting('test.expense_shop')::uuid;u uuid:=current_setting('test.expense_user')::uuid;m uuid:=gen_random_uuid();m2 uuid:=gen_random_uuid();x uuid:=gen_random_uuid();ev uuid:=gen_random_uuid();stockid uuid:=gen_random_uuid();e jsonb;d jsonb;original jsonb;rejected boolean;hcount integer;
begin
 perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',jsonb_build_object('id',m,'name','Paper','available',-50,'measurementUnit','sheet','requireSize',false,'modifiedBy',u)));
 perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.created','data',jsonb_build_object('id',m2,'name','Vinyl','available',0,'measurementUnit','metre','requireSize',false,'modifiedBy',u)));
 d:=jsonb_build_object('id',x,'description','Paper purchase','category','Materials','incurredOn','2026-10-07','amount',2500000,'payee','Supplier','note','','receiptReference','INV-1','materials',jsonb_build_array(jsonb_build_object('materialId',m,'quantity',100,'measurementUnit','sheet')),'payment',jsonb_build_object('id',gen_random_uuid(),'amount',500000,'paidOn','2026-10-07','method','Cash','source','Business cash','reference',''),'stockIds',jsonb_build_object(m::text,stockid),'modifiedBy',u,'modifiedByLabel','Forged','modifiedAt','1900-01-01');
 e:=jsonb_build_object('id',ev,'kind','expense.created','data',d);perform public.apply_expense_event(s,e);perform public.apply_expense_event(s,e);
 select data into original from public.expenses where id=x;
 if (select available from public.materials where id=m)<>50 or (original->>'version')::integer<>1 or original->>'createdByLabel'<>'Expense owner' then raise exception 'Purchase, retry or trusted audit failed';end if;
 if not exists(select 1 from public.material_stock_changes where id=stockid and expense_id=x and before_available=-50 and after_available=50) then raise exception 'Linked stock history missing';end if;
 if jsonb_array_length(public.get_ledger(s)->'expenses')<>1 or jsonb_array_length(public.get_ledger(s)->'expenseHistory')<>1 then raise exception 'Expense missing from sync';end if;
 perform public.apply_material_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','material.stock_set','data',jsonb_build_object('id',m,'baseVersion',2,'quantity',49,'modifiedBy',u,'reason','Job consumed one')));
 d:=d-'payment';d:=d||jsonb_build_object('baseVersion',1,'amount',3000000,'materials',jsonb_build_array(jsonb_build_object('materialId',m,'quantity',120,'measurementUnit','sheet')),'stockIds',jsonb_build_object(m::text,gen_random_uuid()));
 e:=jsonb_build_object('id',gen_random_uuid(),'kind','expense.updated','data',d);perform public.apply_expense_event(s,e);
 if (select available from public.materials where id=m)<>69 or (select data->'createdAt' from public.expenses where id=x)<>original->'createdAt' then raise exception 'Correction replaced stock or creation audit';end if;
 rejected:=false;begin perform public.apply_expense_event(s,jsonb_set(e,'{id}',to_jsonb(gen_random_uuid())));exception when sqlstate 'PT409' then rejected:=true;end;if not rejected then raise exception 'Stale expense edit accepted';end if;
 select count(*) into hcount from public.material_stock_changes where shop_id=s;
 -- A failure in the second material must roll back the first stock update and expense edit.
 d:=d||jsonb_build_object('baseVersion',2,'materials',jsonb_build_array(jsonb_build_object('materialId',m,'quantity',121,'measurementUnit','sheet'),jsonb_build_object('materialId',m2,'quantity',10,'measurementUnit','metre')),'stockIds',jsonb_build_object(m::text,gen_random_uuid(),m2::text,stockid));
 rejected:=false;begin perform public.apply_expense_event(s,jsonb_build_object('id',gen_random_uuid(),'kind','expense.updated','data',d));exception when unique_violation then rejected:=true;end;
 if not rejected or (select available from public.materials where id=m)<>69 or (select available from public.materials where id=m2)<>0 or (select count(*) from public.material_stock_changes where shop_id=s)<>hcount or (select (data->>'version')::integer from public.expenses where id=x)<>2 then raise exception 'Atomic rollback failed';end if;
 e:=jsonb_build_object('id',gen_random_uuid(),'kind','expense.payment_recorded','data',jsonb_build_object('id',x,'baseVersion',2,'modifiedBy',u,'stockIds','{}'::jsonb,'payment',jsonb_build_object('id',gen_random_uuid(),'amount',2500000,'paidOn','2026-10-07','method','Transfer','source','Business bank account','reference','PAY-2')));
 perform public.apply_expense_event(s,e);perform public.apply_expense_event(s,e);
 if (select available from public.materials where id=m)<>69 or (select jsonb_array_length(data->'payments') from public.expenses where id=x)<>2 then raise exception 'Payment changed stock or retry duplicated payment';end if;
 e:=jsonb_set(e,'{id}',to_jsonb(gen_random_uuid()));e:=jsonb_set(e,'{data,baseVersion}','3');rejected:=false;
 begin perform public.apply_expense_event(s,e);exception when others then rejected:=true;end;if not rejected then raise exception 'Duplicate payment accepted';end if;
 e:=jsonb_build_object('id',gen_random_uuid(),'kind','expense.voided','data',jsonb_build_object('id',x,'baseVersion',3,'modifiedBy',u,'reason','Purchase returned','stockIds',jsonb_build_object(m::text,gen_random_uuid())));
 perform public.apply_expense_event(s,e);
 if (select available from public.materials where id=m)<>-51 or not (select (data->>'voided')::boolean from public.expenses where id=x) or (select jsonb_array_length(data->'payments') from public.expenses where id=x)<>2 then raise exception 'Void lost stock consumption or payments';end if;
 rejected:=false;begin update public.expenses set data='{}' where id=x;exception when insufficient_privilege then rejected:=true;end;if not rejected then raise exception 'Direct write allowed';end if;
 rejected:=false;begin delete from public.expenses where id=x;exception when insufficient_privilege then rejected:=true;end;if not rejected then raise exception 'Direct deletion allowed';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.expense_outsider'),true);
 if exists(select 1 from public.expenses where shop_id=s) or exists(select 1 from public.expense_changes where shop_id=s) then raise exception 'Cross-business read allowed';end if;
 rejected:=false;begin perform public.apply_expense_event(s,e);exception when others then rejected:=true;end;if not rejected then raise exception 'Cross-business write allowed';end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.expense_cashier'),true);
 rejected:=false;begin perform public.apply_expense_event(s,e);exception when others then rejected:=true;end;if not rejected then raise exception 'Cashier financial edit allowed';end if;
end;$$;
rollback;
