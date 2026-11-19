-- Branch stock (audit AUD-29): a branch's stock change was skipped when the branch's new quantity
-- happened to equal the main branch's quantity (the overlay compared with the shared materials row,
-- not with the branch's own stock). Main 0, branch 10, the branch uses 10: the branch stayed at 10.
-- Now the overlay runs only when a statement sets the stock (UPDATE OF available; edits of a
-- material's name, unit or archive state never touch it) and compares with the branch's own stock.
do $m$
declare d text := pg_get_functiondef('private.location_stock_overlay()'::regprocedure);
  old_skip text := $x$  if new.available is not distinct from old.available then return new; end if;
  before_qty := coalesce((select ls.available from public.location_stock ls
    where ls.shop_id = new.shop_id and ls.location_id = loc and ls.material_id = new.id), 0);$x$;
  new_skip text := $x$  before_qty := coalesce((select ls.available from public.location_stock ls
    where ls.shop_id = new.shop_id and ls.location_id = loc and ls.material_id = new.id), 0);
  -- Unchanged at this branch: the shared row keeps the main branch's quantity.
  if new.available is not distinct from before_qty then new.available := old.available; return new; end if;$x$;
begin
  d := replace(d, E'\r', '');
  if position('Unchanged at this branch' in d) > 0 then return; end if;
  if position(old_skip in d) = 0 then raise exception 'location_stock_overlay: comparison not found'; end if;
  execute replace(d, old_skip, new_skip);
end $m$;

drop trigger if exists a_location_stock on public.materials;
create trigger a_location_stock before insert or update of available on public.materials
  for each row execute function private.location_stock_overlay();
