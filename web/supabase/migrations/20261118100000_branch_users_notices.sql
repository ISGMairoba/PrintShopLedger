-- Users and notices by branch.
-- Users page: each branch sees only the staff who work there (the General Manager and Developer
-- work everywhere, so they show in every branch). Only the General Manager or Developer working
-- in the main branch sees everyone. Each user's row lists the branches they work in. A user added
-- at a branch works in that branch.
-- Notices belong to the branch where they were posted (or every branch, posted by the General
-- Manager or Developer). Staff see the notices of every branch they work in; the app marks those
-- from another branch.

-- The branches a staff member works in: '*' for every branch (General Manager, Developer, or given
-- "Every branch"); otherwise their branchAccess list, or the main branch when none is set.
create or replace function private.member_branches(p_shop uuid, p_user uuid) returns text[]
language sql stable security definer set search_path to '' as $f$
  select case
    when exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = p_user and m.rank >= 4) then array['*']
    else coalesce((
      select array(select jsonb_array_elements_text(b.settings->'branchAccess'->(p_user::text)))
      from public.business_settings b where b.shop_id = p_shop
        and jsonb_typeof(b.settings->'branchAccess'->(p_user::text)) = 'array'
        and jsonb_array_length(b.settings->'branchAccess'->(p_user::text)) > 0), array['main'])
  end
$f$;
revoke all on function private.member_branches(uuid, uuid) from public, anon, authenticated;

-- Whether the signed-in staff member sees this user on the Users page.
create or replace function private.user_in_view(p_shop uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path to '' as $f$
declare br text := coalesce(private.request_branch(p_shop), 'main'); theirs text[];
begin
  if p_user = auth.uid() then return true; end if;
  -- Business Settings → Branches → Who works where (list_all_staff): the owner sees everyone.
  if current_setting('psl.all_staff', true) = p_shop::text
     and exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4) then
    return true;
  end if;
  if br = 'main' and '*' = any(private.member_branches(p_shop, auth.uid()))
     and exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4) then
    return true;
  end if;
  theirs := private.member_branches(p_shop, p_user);
  return '*' = any(theirs) or br = any(theirs);
end $f$;
revoke all on function private.user_in_view(uuid, uuid) from public, anon, authenticated;

create or replace function public.list_shop_users(p_shop uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
begin
 if not private.can_manage_users(p_shop) then raise exception 'Users page requires Admin, Manager or Developer access'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'id',m.id,'userId',m.user_id,'name',m.name,'username',m.username,'rank',m.rank,'role',m.role,'accessLevel',m.access_level,
 'archived',m.archived,'version',m.version,'lastLogin',u.last_sign_in_at,
 'branches',to_jsonb(private.member_branches(p_shop, m.user_id)),
 'createdAt',m.created_at,'createdBy',m.created_by,'createdByLabel',coalesce(c.name,'Manager'),
 'modifiedAt',m.modified_at,'modifiedBy',m.modified_by,'modifiedByLabel',coalesce(e.name,'Manager')) order by m.name),'[]'::jsonb)
 from public.shop_members m join auth.users u on u.id=m.user_id
 left join public.shop_members c on c.shop_id=m.shop_id and c.user_id=m.created_by
 left join public.shop_members e on e.shop_id=m.shop_id and e.user_id=m.modified_by
 where m.shop_id=p_shop and private.user_in_view(p_shop, m.user_id));
end; $function$;

-- Who works where: the General Manager and Developer list every staff member from any branch.
create or replace function public.list_all_staff(p_shop uuid) returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare result jsonb;
begin
  if not exists (select 1 from public.shop_members where shop_id = p_shop and user_id = auth.uid() and not archived and rank >= 4) then
    raise exception 'Only the General Manager or Developer sets who works where' using errcode = '42501';
  end if;
  perform set_config('psl.all_staff', p_shop::text, true);
  result := public.list_shop_users(p_shop);
  perform set_config('psl.all_staff', '', true);
  return result;
end; $function$;
revoke all on function public.list_all_staff(uuid) from public, anon;
grant execute on function public.list_all_staff(uuid) to authenticated;

-- Editing, turning off and password resets: only users this person sees.
create or replace function public.save_shop_user(p_shop uuid, p_action text, p_data jsonb) returns void
language plpgsql security definer set search_path to '' as $function$
declare target uuid;
begin
 if p_action='create' then raise exception 'Use secure account provisioning to create users'; end if;
 select user_id into target from public.shop_members where shop_id=p_shop and id=(p_data->>'id')::uuid;
 if target is not null and not private.user_in_view(p_shop, target) then raise exception 'This user works in another branch' using errcode='42501'; end if;
 perform public.save_shop_user_internal(p_shop,p_action,p_data);
end; $function$;

do $m$
declare def text := pg_get_functiondef('public.authorize_staff_password_reset(uuid,uuid,integer)'::regprocedure);
  t text := 'if not found or t.archived then raise exception ''Active user not found''; end if;';
begin
  if position('user_in_view' in def) > 0 then return; end if;
  if position(t in def) = 0 then raise exception 'authorize_staff_password_reset: user check not found'; end if;
  execute replace(def, t, t || ' if not private.user_in_view(p_shop,t.user_id) then raise exception ''This user works in another branch''; end if;');
end $m$;

-- A user added at a branch (not main) works in that branch.
create or replace function public.provision_shop_user(p_shop uuid, p_actor uuid, p_data jsonb) returns void
language plpgsql security definer set search_path to '' as $function$
declare br text; added uuid := (p_data->>'userId')::uuid;
begin
 perform set_config('request.jwt.claim.sub',p_actor::text,true);
 perform public.save_shop_user_internal(p_shop,'create',p_data);
 br := private.request_branch(p_shop);
 if br is not null and added is not null
    and exists (select 1 from public.shop_members where shop_id=p_shop and user_id=added and rank < 4) then
   update public.business_settings
      set settings = settings || jsonb_build_object('branchAccess',
            coalesce(case when jsonb_typeof(settings->'branchAccess') = 'object' then settings->'branchAccess' end, '{}'::jsonb)
            || jsonb_build_object(added::text, jsonb_build_array(br))),
          version = version + 1, modified_at = now(), modified_by = p_actor
    where shop_id = p_shop;
 end if;
end; $function$;
revoke all on function public.provision_shop_user(uuid, uuid, jsonb) from public, anon, authenticated;

-- Notices by branch: branch_id null = main, '*' = every branch.
-- Notices posted before branches were taken into account were for everyone: they become "every branch".
do $m$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'notices' and column_name = 'branch_id') then
    alter table public.notices add column branch_id text;
    update public.notices set branch_id = '*';
  end if;
end $m$;
drop trigger if exists tag_branch on public.notices;
create trigger tag_branch before insert on public.notices for each row execute function private.tag_branch();

-- Whether the signed-in person sees notices of this branch.
create or replace function private.notice_in_view(p_shop uuid, p_branch text) returns boolean
language sql stable security definer set search_path to '' as $f$
  select p_branch = '*' or '*' = any(private.member_branches(p_shop, auth.uid()))
      or coalesce(p_branch, 'main') = any(private.member_branches(p_shop, auth.uid()))
$f$;
revoke all on function private.notice_in_view(uuid, text) from public, anon, authenticated;

create or replace function public.get_notices(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'pinned', n.pinned, 'minLevel', n.min_level,
      'branchId', coalesce(n.branch_id, 'main'),
      'createdBy', n.created_by, 'createdByLabel', n.created_by_label, 'createdAt', n.created_at,
      'updatedByLabel', n.updated_by_label, 'updatedAt', n.updated_at,
      'readAt', (select r.read_at from public.notice_reads r where r.notice_id = n.id and r.user_id = auth.uid()),
      'readers', case when me.lvl >= 3 then (
        select coalesce(jsonb_agg(jsonb_build_object('name', r.user_label, 'at', r.read_at) order by r.read_at), '[]'::jsonb)
        from public.notice_reads r where r.notice_id = n.id) end
    ) order by n.pinned desc, n.created_at desc)
    from public.notices n
    where n.shop_id = p_shop and not n.archived and (n.min_level <= me.lvl or n.created_by = auth.uid())
      and (private.notice_in_view(p_shop, n.branch_id) or n.created_by = auth.uid())
  ), '[]'::jsonb);
end $f$;

-- Post or change a notice. p_everywhere: for every branch (General Manager and Developer).
drop function if exists public.save_notice(uuid, uuid, text, text, boolean, integer);
create or replace function public.save_notice(p_shop uuid, p_id uuid, p_title text, p_body text, p_pinned boolean, p_min_level integer, p_everywhere boolean default false)
returns void language plpgsql security definer set search_path to '' as $f$
declare me record; n public.notices%rowtype; owner boolean;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null or me.lvl < 3 then raise exception 'Only Managers and above can post notices' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Invalid notice'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Title: up to 120 characters, required'; end if;
  if length(coalesce(p_body, '')) > 4000 then raise exception 'Message: up to 4,000 characters'; end if;
  if p_min_level not in (1, 2, 3) then raise exception 'Choose who sees it'; end if;
  owner := exists (select 1 from public.shop_members m where m.shop_id = p_shop and m.user_id = auth.uid() and m.rank >= 4);
  if coalesce(p_everywhere, false) and not owner then raise exception 'Only the General Manager or Developer posts to every branch' using errcode = '42501'; end if;
  select * into n from public.notices where id = p_id for update;
  if found then
    if n.shop_id <> p_shop or n.archived then raise exception 'This notice was taken down' using errcode = 'PT409'; end if;
    if not private.notice_in_view(p_shop, n.branch_id) and n.created_by <> auth.uid() then raise exception 'Notice not found'; end if;
    update public.notices set title = btrim(p_title), body = coalesce(p_body, ''), pinned = coalesce(p_pinned, false),
      min_level = p_min_level, updated_by_label = me.label, updated_at = now(),
      branch_id = case when owner and coalesce(p_everywhere, false) then '*'
                       when owner and n.branch_id = '*' then private.request_branch(p_shop) else n.branch_id end
    where id = p_id;
  else
    if (select count(*) from public.notices where shop_id = p_shop and not archived) >= 200 then
      raise exception 'Take down some old notices first (200 at most)';
    end if;
    insert into public.notices (id, shop_id, title, body, pinned, min_level, created_by, created_by_label, branch_id)
    values (p_id, p_shop, btrim(p_title), coalesce(p_body, ''), coalesce(p_pinned, false), p_min_level, auth.uid(), me.label,
      case when coalesce(p_everywhere, false) then '*' end);
  end if;
end $f$;

create or replace function public.archive_notice(p_shop uuid, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null or me.lvl < 3 then raise exception 'Only Managers and above can take notices down' using errcode = '42501'; end if;
  update public.notices set archived = true, updated_by_label = me.label, updated_at = now()
  where id = p_id and shop_id = p_shop and (private.notice_in_view(p_shop, branch_id) or created_by = auth.uid());
  if not found then raise exception 'Notice not found'; end if;
end $f$;

create or replace function public.read_notice(p_shop uuid, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.notices where id = p_id and shop_id = p_shop and not archived
                 and (min_level <= me.lvl or created_by = auth.uid())
                 and (private.notice_in_view(p_shop, branch_id) or created_by = auth.uid())) then
    raise exception 'Notice not found';
  end if;
  insert into public.notice_reads (notice_id, user_id, user_label) values (p_id, auth.uid(), me.label)
  on conflict (notice_id, user_id) do nothing;
end $f$;

revoke all on function public.save_notice(uuid, uuid, text, text, boolean, integer, boolean) from public, anon;
grant execute on function public.save_notice(uuid, uuid, text, text, boolean, integer, boolean) to authenticated;
