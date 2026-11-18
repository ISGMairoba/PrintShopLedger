-- Page access in three layers (plans/branches-next.md):
-- 1. Developer: the pages each rank may open (settings.pageAccess) — the upper limit.
-- 2. General Manager: at each branch, fewer pages for Cashier, Admin or Manager there.
-- 3. Manager and above: fewer pages for one person of a lower rank.
-- A page opens only when every layer allows it. Layers 2 and 3 can only take pages away.
create table if not exists private.page_limits (
  shop_id uuid not null references public.shops(id) on delete cascade,
  branch_id text,            -- layer 2: the branch ('main' for the main branch), with rank
  rank integer check (rank between 1 and 3),
  user_id uuid,              -- layer 3: the person
  pages text[] not null,
  set_by uuid,
  set_at timestamptz not null default now(),
  check ((branch_id is not null and rank is not null and user_id is null) or (branch_id is null and rank is null and user_id is not null))
);
create unique index if not exists page_limits_branch on private.page_limits (shop_id, branch_id, rank) where user_id is null;
create unique index if not exists page_limits_person on private.page_limits (shop_id, user_id) where user_id is not null;
revoke all on private.page_limits from public, anon, authenticated;

create or replace function private.valid_page_list(p jsonb) returns text[]
language plpgsql immutable set search_path to '' as $f$
begin
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 60
     or exists (select 1 from jsonb_array_elements(p) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 40) then
    raise exception 'Choose valid pages.';
  end if;
  return array(select distinct e from jsonb_array_elements_text(p) e);
end $f$;

-- The extra limit for the signed-in person at this device's branch: the pages they may open
-- within their rank's, or null when neither a branch nor a personal limit applies.
create or replace function public.my_page_limits(p_shop uuid) returns text[]
language plpgsql stable security definer set search_path to '' as $f$
declare me record; here text; b text[]; p text[];
begin
  select rank into me from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level > 0;
  if not found then raise exception 'Business access denied' using errcode = '42501'; end if;
  here := coalesce(private.request_branch(p_shop), 'main');
  select pages into b from private.page_limits where shop_id = p_shop and branch_id = here and rank = me.rank and user_id is null;
  select pages into p from private.page_limits where shop_id = p_shop and user_id = auth.uid();
  if b is null then return p; end if;
  if p is null then return b; end if;
  return array(select x from unnest(b) x where x = any(p));
end $f$;
revoke all on function public.my_page_limits(uuid) from public, anon;
grant execute on function public.my_page_limits(uuid) to authenticated;

-- Every limit set (Manager and above, for the Users page).
create or replace function public.list_page_limits(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level >= 3) then
    raise exception 'Only Managers and above can see page limits.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'branches', coalesce((select jsonb_object_agg(branch_id || ':' || rank, to_jsonb(pages)) from private.page_limits where shop_id = p_shop and user_id is null), '{}'::jsonb),
    'people', coalesce((select jsonb_object_agg(user_id::text, to_jsonb(pages)) from private.page_limits where shop_id = p_shop and user_id is not null), '{}'::jsonb));
end $f$;
revoke all on function public.list_page_limits(uuid) from public, anon;
grant execute on function public.list_page_limits(uuid) to authenticated;

-- Layer 2 (General Manager and above): pages a rank opens at a branch; null pages removes the limit.
create or replace function public.set_branch_page_limit(p_shop uuid, p_branch text, p_rank integer, p_pages jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level >= 4) then
    raise exception 'Only General Managers and above can set pages for a branch.' using errcode = '42501';
  end if;
  if p_rank not between 1 and 3 then raise exception 'Choose Cashier, Admin or Manager.'; end if;
  if not exists (select 1 from public.business_settings b, jsonb_array_elements(coalesce(b.settings->'branches', '[]'::jsonb)) x
                 where b.shop_id = p_shop and x->>'id' = p_branch) and p_branch <> 'main' then
    raise exception 'Choose a branch.';
  end if;
  delete from private.page_limits where shop_id = p_shop and branch_id = p_branch and rank = p_rank and user_id is null;
  if p_pages is not null and jsonb_typeof(p_pages) <> 'null' then
    insert into private.page_limits (shop_id, branch_id, rank, pages, set_by)
    values (p_shop, p_branch, p_rank, private.valid_page_list(p_pages), auth.uid());
  end if;
end $f$;
revoke all on function public.set_branch_page_limit(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.set_branch_page_limit(uuid, text, integer, jsonb) to authenticated;

-- Layer 3 (Manager and above, for someone of a lower rank): one person's pages; null removes it.
create or replace function public.set_person_page_limit(p_shop uuid, p_user uuid, p_pages jsonb) returns void
language plpgsql security definer set search_path to '' as $f$
declare mine integer; theirs integer;
begin
  select rank into mine from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and access_level >= 3;
  if mine is null then raise exception 'Only Managers and above can set a person''s pages.' using errcode = '42501'; end if;
  select rank into theirs from public.shop_members where shop_id = p_shop and user_id = p_user;
  if theirs is null then raise exception 'Choose a user of this business.'; end if;
  if theirs >= mine then raise exception 'You can set pages only for people of a lower rank.' using errcode = '42501'; end if;
  delete from private.page_limits where shop_id = p_shop and user_id = p_user;
  if p_pages is not null and jsonb_typeof(p_pages) <> 'null' then
    insert into private.page_limits (shop_id, user_id, pages, set_by)
    values (p_shop, p_user, private.valid_page_list(p_pages), auth.uid());
  end if;
end $f$;
revoke all on function public.set_person_page_limit(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_person_page_limit(uuid, uuid, jsonb) to authenticated;
