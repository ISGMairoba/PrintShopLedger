-- Faster downloads (audit, 19 Nov). Every table's read rule asked "is this person a member of
-- this row's business?" once per row (public.is_shop_member(shop_id), about 0.07 ms each). A full
-- download reads each table several times, so SMGraphics' download spent about 3 of its 6 seconds
-- on that question and was close to the 8-second limit. The rule now asks once per query: the row's
-- business must be one of the businesses this person is a member of. Who can see what is unchanged.

create or replace function private.my_shops() returns setof uuid
language sql stable security definer set search_path to '' as $f$
  select m.shop_id from public.shop_members m
   where m.user_id = auth.uid() and not m.archived and m.access_level > 0;
$f$;
revoke all on function private.my_shops() from public, anon;
grant execute on function private.my_shops() to authenticated;

do $m$
declare p record; q text;
begin
  for p in select tablename, policyname, qual from pg_policies
            where schemaname = 'public' and cmd = 'SELECT' and qual like '%is_shop_member(%' loop
    q := replace(replace(p.qual, 'is_shop_member(shop_id)', '(shop_id IN (SELECT private.my_shops()))'),
                 'is_shop_member(id)', '(id IN (SELECT private.my_shops()))');
    if position('is_shop_member(' in q) > 0 then
      raise exception 'Unexpected read rule on %: %', p.tablename, p.qual;
    end if;
    execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
  end loop;
end $m$;
