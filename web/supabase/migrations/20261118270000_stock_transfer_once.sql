-- A stock transfer is made once even when it is sent again (plans/audit-1-review.md, AUD-18): the
-- app gives each transfer an operation ID and keeps it until the server answers, so sending again
-- after a lost answer finds the transfer already made instead of moving the stock twice.
-- transfer_stock(p_operation, …) is the same as transfer_stock(…) with that ID.
do $m$
declare d text := pg_get_functiondef('public.transfer_stock(uuid,uuid,text,text,numeric,text,numeric,boolean)'::regprocedure);
  h text := 'public.transfer_stock(p_shop uuid,';
  e text := 'ev uuid := gen_random_uuid();';
  g text := $x$if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;$x$;
begin
  if (length(d) - length(replace(d, h, ''))) / length(h) <> 1
     or (length(d) - length(replace(d, e, ''))) / length(e) <> 1
     or (length(d) - length(replace(d, g, ''))) / length(g) <> 1 then
    raise exception 'transfer_stock: pattern not found';
  end if;
  d := replace(d, h, 'public.transfer_stock(p_operation uuid, p_shop uuid,');
  d := replace(d, e, 'ev uuid := p_operation;');
  d := replace(d, g, g || $x$
  if p_operation is null then raise exception 'Invalid transfer'; end if;
  if exists (select 1 from public.ledger_events where shop_id = p_shop and id = p_operation) then
    if exists (select 1 from public.ledger_events where shop_id = p_shop and id = p_operation and actor_id = auth.uid()
               and payload->>'kind' = 'material.transferred' and payload->'data'->>'id' = p_material::text
               and payload->'data'->>'from' = p_from and payload->'data'->>'to' = p_to
               and (payload->'data'->>'quantity')::numeric = p_quantity) then
      return;
    end if;
    raise exception 'Operation ID already used';
  end if;$x$);
  execute d;
end $m$;
revoke all on function public.transfer_stock(uuid,uuid,uuid,text,text,numeric,text,numeric,boolean) from public, anon;
grant execute on function public.transfer_stock(uuid,uuid,uuid,text,text,numeric,text,numeric,boolean) to authenticated;
