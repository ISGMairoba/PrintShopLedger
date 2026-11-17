-- A new item from the General Manager or Developer carries where it is sold (data.soldAt: the
-- branches selling only chosen items that sell it). Items added by anyone else at such a branch
-- are sold there, as before.
create or replace function private.sold_where_added() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare chosen jsonb := new.payload->'data'->'soldAt';
begin
  if new.payload->>'kind' <> 'service.created' then return null; end if;
  if jsonb_typeof(chosen) = 'array'
     and exists (select 1 from public.shop_members m where m.shop_id = new.shop_id and m.user_id = new.actor_id and m.rank >= 4) then
    update public.services set sold_at = (
        select coalesce(jsonb_agg(distinct b), '[]'::jsonb)
        from (select x from jsonb_array_elements_text(chosen) x limit 50) e(b)
        where b ~ '^b-[a-z0-9]{6,20}$')
     where shop_id = new.shop_id and id = (new.payload->'data'->>'id')::uuid;
  elsif new.branch_id is not null and private.branch_sells_chosen(new.shop_id, new.branch_id) then
    update public.services set sold_at = sold_at || to_jsonb(new.branch_id)
     where shop_id = new.shop_id and id = (new.payload->'data'->>'id')::uuid and not sold_at ? new.branch_id;
  end if;
  return null;
end $function$;
