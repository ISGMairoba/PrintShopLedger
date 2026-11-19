-- Materials and stock (audit AUD-28): the app lets only Admins and above (not the cashier role)
-- create, edit, archive, count, restock, split or waste materials, but the server accepted these
-- from any member. It now checks the same rule as items (apply_service_event).
do $m$
declare d text := pg_get_functiondef('public.apply_material_event(uuid,jsonb)'::regprocedure);
  t text := $x$  if not public.is_shop_member(p_shop) then raise exception 'Business access denied'; end if;$x$;
begin
  if position('Only Admins and above change materials' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, t, ''))) / length(t) <> 1 then raise exception 'apply_material_event: member check not found'; end if;
  execute replace(d, t, t || $x$
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived
                 and access_level >= 2 and role in ('admin', 'manager', 'general_manager', 'developer')) then
    raise exception 'Only Admins and above change materials and stock.' using errcode = '42501';
  end if;$x$);
end $m$;
