-- Minimum stock per branch or store: settings.stockMinimums = { locationId: { materialId: number } }.
-- Admins and higher set it for a location they work in (General Manager and Developer: anywhere).
-- The main branch keeps each material's own minimum; a location without its own uses that too.
create or replace function public.set_location_minimum(p_shop uuid, p_location text, p_material uuid, p_minimum numeric)
returns void language plpgsql security definer set search_path to '' as $function$
declare s jsonb; mins jsonb; here jsonb;
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level >= 2) then
    raise exception 'Admins and higher set minimum stock' using errcode = '42501';
  end if;
  if p_location is null or p_location = 'main' or p_location !~ '^b-[a-z0-9]{6,20}$' then
    raise exception 'The main branch uses the item''s own minimum (Edit)';
  end if;
  if not private.works_in(p_shop, p_location) then
    raise exception 'You can set minimums only where you work' using errcode = '42501';
  end if;
  if p_minimum is not null and (p_minimum < 0 or p_minimum > 1000000000000 or p_minimum <> round(p_minimum, 3)) then
    raise exception 'Enter a minimum of zero or more, with at most three decimal places';
  end if;
  if not exists (select 1 from public.materials where shop_id = p_shop and id = p_material) then
    raise exception 'Stock item not found';
  end if;
  select settings into s from public.business_settings where shop_id = p_shop for update;
  if not exists (select 1 from jsonb_array_elements(coalesce(s->'branches', '[]'::jsonb)) b
                 where b->>'id' = p_location and not coalesce((b->>'archived')::boolean, false)) then
    raise exception 'Choose an open branch or store';
  end if;
  mins := case when jsonb_typeof(s->'stockMinimums') = 'object' then s->'stockMinimums' else '{}'::jsonb end;
  here := case when jsonb_typeof(mins->p_location) = 'object' then mins->p_location else '{}'::jsonb end;
  here := case when p_minimum is null then here - p_material::text
               else here || jsonb_build_object(p_material::text, p_minimum) end;
  mins := case when here = '{}'::jsonb then mins - p_location else mins || jsonb_build_object(p_location, here) end;
  update public.business_settings
     set settings = s || jsonb_build_object('stockMinimums', mins),
         version = version + 1, modified_at = now(), modified_by = auth.uid()
   where shop_id = p_shop;
end $function$;
revoke all on function public.set_location_minimum(uuid, text, uuid, numeric) from public, anon;
grant execute on function public.set_location_minimum(uuid, text, uuid, numeric) to authenticated;
