-- Discounts at checkout. A job may carry its own discount and a share of a whole-order discount.
-- The server checks: the price before discount matches the service price; amount = price − discount;
-- the discount is within the giver's rank limit (business_settings.settings.discounts.maxPercent,
-- Developer 100%); flat and whole-order discounts need Admin (access level 2) or higher.
-- Edits the live apply_checkout_event in place; stops if any expected text is missing.
do $migration$
declare
  def text := pg_get_functiondef('public.apply_checkout_event(uuid,jsonb)'::regprocedure);
  before text;
  step record;
begin
  for step in select * from (values
    (1, $a$item_id uuid;snapshots jsonb;$a$,
        $a$item_id uuid;lvl integer;maxpct numeric;disc numeric;share numeric;net numeric;snapshots jsonb;$a$),
    (2, $a$ select name into label from public.shop_members where shop_id=p_shop and user_id=u;$a$,
        $a$ select name,access_level into label,lvl from public.shop_members where shop_id=p_shop and user_id=u;
 maxpct:=case when lvl>=4 then 100 else coalesce((select (s.settings->'discounts'->'maxPercent'->>lvl::text)::numeric from public.business_settings s where s.shop_id=p_shop),case lvl when 1 then 0 when 2 then 20 else 100 end) end;
 if d->'orderDiscount' is not null and d->'orderDiscount'<>'null'::jsonb and lvl<2 then raise exception 'Only Admins and higher can discount a whole order' using errcode='PT409';end if;$a$),
    (3, $a$calculated is distinct from (line->>'amount')::numeric$a$,
        $a$calculated is distinct from coalesce((line->>'grossAmount')::numeric,(line->>'amount')::numeric)$a$),
    (4, $a$  total:=total+calculated;$a$,
        $a$  disc:=coalesce((line->>'discountAmount')::numeric,0);share:=coalesce((line->>'orderDiscountShare')::numeric,0);
  if disc<0 or disc<>trunc(disc) or share<0 or share<>trunc(share) or share>disc or disc>calculated or (line->>'amount')::numeric is distinct from calculated-disc then raise exception 'Invalid job discount';end if;
  if disc>ceil(calculated*maxpct/100) then raise exception 'Discount is above your limit. Review the checkout.' using errcode='PT409';end if;
  if (share>0 or line->'discount'->>'kind'='amount') and lvl<2 then raise exception 'Only Admins and higher can give flat or whole-order discounts' using errcode='PT409';end if;
  net:=calculated-disc;
  total:=total+net;$a$),
    (5, $a$btrim(line->>'description'),calculated,(d->>'createdAt')::timestamptz$a$,
        $a$btrim(line->>'description'),net,(d->>'createdAt')::timestamptz$a$)
  ) as t(n, old, new) order by n
  loop
    before := def;
    def := replace(def, step.old, step.new);
    if def = before then raise exception 'Discount migration step % did not match the current checkout function', step.n; end if;
  end loop;
  execute def;
end
$migration$;
