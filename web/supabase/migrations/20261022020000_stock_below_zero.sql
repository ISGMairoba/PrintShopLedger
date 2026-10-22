-- Business Settings → Jobs & payments → "Stock below zero": when jobs.stockBelowZero is 'block',
-- nothing may take a stock item below zero (or further below). The device checks first; this is
-- the final check, so work saved offline from an out-of-date count is held for review (PT409).
create or replace function private.block_stock_below_zero() returns trigger
language plpgsql security definer set search_path to '' as $f$
begin
  if exists(select 1 from public.business_settings s where s.shop_id=new.shop_id and s.settings->'jobs'->>'stockBelowZero'='block') then
    raise exception 'Not enough %: % % in stock, this needs %. Ask an admin to update the stock first.',
      new.name, trim_scale(greatest(old.available,0)), new.measurement_unit, trim_scale(old.available-new.available)
      using errcode='PT409';
  end if;
  return new;
end $f$;
revoke all on function private.block_stock_below_zero() from public;
drop trigger if exists block_stock_below_zero on public.materials;
create trigger block_stock_below_zero before update of available on public.materials
  for each row when (new.available < 0 and new.available < old.available)
  execute function private.block_stock_below_zero();
