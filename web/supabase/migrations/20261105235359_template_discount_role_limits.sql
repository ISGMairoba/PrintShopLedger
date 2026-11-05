begin;
do $patch$
declare src text;old text;replacement text;
begin
 src:=pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
 old:=$m$if line ? 'templateSnapshot' and (net<$m$;
 if strpos(src,old)=0 then raise exception 'Checkout template guard changed';end if;
 src:=replace(src,old,$m$if lvl=1 and line ? 'templateSnapshot' and (net<$m$);execute src;
 src:=pg_get_functiondef('public.apply_quotation_event(uuid,jsonb)'::regprocedure);
 old:=$m$or (line->>'amount')::numeric<(line->'templateSnapshot'->'price'->>'minimum')::numeric
        or (line->>'discountAmount')::numeric>ceil((line->>'grossAmount')::numeric*(line->'templateSnapshot'->'template'->'pricing'->>'maxDiscount')::numeric/100)$m$;
 if strpos(src,old)=0 then raise exception 'Quotation template guard changed';end if;
 replacement:=$m$or (not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2) and ((line->>'amount')::numeric<(line->'templateSnapshot'->'price'->>'minimum')::numeric
        or (line->>'discountAmount')::numeric>ceil((line->>'grossAmount')::numeric*(line->'templateSnapshot'->'template'->'pricing'->>'maxDiscount')::numeric/100)))$m$;
 src:=replace(src,old,replacement);
 old:=$m$    for line in select value from jsonb_array_elements(d->'lines') loop$m$;
 if strpos(src,old)=0 then raise exception 'Quotation discount loop changed';end if;
 src:=replace(src,old,old||$guard$
      if (line->>'discountAmount')::numeric > ceil((line->>'grossAmount')::numeric * (select case when m.access_level>=4 then 100 else coalesce((s.settings->'discounts'->'maxPercent'->>m.access_level::text)::numeric,case m.access_level when 1 then 0 when 2 then 20 else 100 end) end from public.shop_members m left join public.business_settings s on s.shop_id=m.shop_id where m.shop_id=p_shop and m.user_id=u and not m.archived)/100) then raise exception 'This discount exceeds your staff discount limit' using errcode='PT409';end if;
      if not exists(select 1 from public.shop_members where shop_id=p_shop and user_id=u and not archived and access_level>=2) and (coalesce((line->>'orderDiscountShare')::numeric,0)>0 or line->'discount'->>'kind'='amount') then raise exception 'Only Admins and higher can give flat or whole-order discounts' using errcode='PT409';end if;
$guard$);execute src;
end $patch$;
commit;
