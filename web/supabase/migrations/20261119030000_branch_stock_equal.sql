-- Branch stock (audit AUD-29): a branch's stock change was skipped when the branch's new quantity
-- happened to equal the main branch's quantity (the overlay compared with the shared materials row,
-- not with the branch's own stock). Main 0, branch 10, the branch uses 10: the branch stayed at 10.
-- Now the overlay runs only when a statement sets the stock (UPDATE OF available; edits of a
-- material's name, unit or archive state never touch it) and compares with the branch's own stock.
-- (Each pattern is one line, so the replacement works however the editor sends line breaks.)
do $m$
declare d text := replace(pg_get_functiondef('private.location_stock_overlay()'::regprocedure), E'\r', '');
  old_skip text := 'if new.available is not distinct from old.available then return new; end if;';
  after_qty text := 'and ls.material_id = new.id), 0);';
begin
  if position('Unchanged at this branch' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, old_skip, ''))) / length(old_skip) <> 1
     or (length(d) - length(replace(d, after_qty, ''))) / length(after_qty) <> 1 then
    raise exception 'location_stock_overlay: comparison not found';
  end if;
  d := replace(d, old_skip, '-- (stock compared below, with this branch''s own stock)');
  d := replace(d, after_qty, after_qty || E'\n  -- Unchanged at this branch: the shared row keeps the main branch''s quantity.\n'
    || '  if new.available is not distinct from before_qty then new.available := old.available; return new; end if;');
  execute d;
end $m$;

drop trigger if exists a_location_stock on public.materials;
create trigger a_location_stock before insert or update of available on public.materials
  for each row execute function private.location_stock_overlay();
