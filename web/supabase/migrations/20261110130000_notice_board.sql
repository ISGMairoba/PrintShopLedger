-- Notice board: Managers and above post notices to the business (all staff, Admins and above, or
-- Managers and above), can pin, edit and take them down. Staff see an unread count and mark each
-- notice read; posters see who has read it. Notices are read online (not part of the offline copy).

create table if not exists public.notices (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null default '' check (length(body) <= 4000),
  pinned boolean not null default false,
  min_level integer not null default 1 check (min_level between 1 and 5),
  archived boolean not null default false,
  created_by uuid not null,
  created_by_label text not null,
  created_at timestamptz not null default now(),
  updated_by_label text,
  updated_at timestamptz not null default now()
);
create index if not exists notices_shop_created on public.notices (shop_id, created_at desc);

create table if not exists public.notice_reads (
  notice_id uuid not null references public.notices(id) on delete cascade,
  user_id uuid not null,
  user_label text not null,
  read_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);

alter table public.notices enable row level security;
alter table public.notice_reads enable row level security;
-- Only through the functions below.
revoke all on public.notices, public.notice_reads from public, anon, authenticated;

-- The signed-in staff member's level and name in this business (null when not a member).
create or replace function private.notice_member(p_shop uuid, out lvl integer, out label text)
language sql stable security definer set search_path to '' as $f$
  select m.access_level, coalesce(nullif(btrim(m.name), ''), 'Staff')
  from public.shop_members m
  where m.shop_id = p_shop and m.user_id = auth.uid() and not m.archived and m.access_level >= 1
$f$;

-- The notices this person may see, newest first (pinned on top), with what they have read.
create or replace function public.get_notices(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'title', n.title, 'body', n.body, 'pinned', n.pinned, 'minLevel', n.min_level,
      'createdBy', n.created_by, 'createdByLabel', n.created_by_label, 'createdAt', n.created_at,
      'updatedByLabel', n.updated_by_label, 'updatedAt', n.updated_at,
      'readAt', (select r.read_at from public.notice_reads r where r.notice_id = n.id and r.user_id = auth.uid()),
      'readers', case when me.lvl >= 3 then (
        select coalesce(jsonb_agg(jsonb_build_object('name', r.user_label, 'at', r.read_at) order by r.read_at), '[]'::jsonb)
        from public.notice_reads r where r.notice_id = n.id) end
    ) order by n.pinned desc, n.created_at desc)
    from public.notices n
    where n.shop_id = p_shop and not n.archived and (n.min_level <= me.lvl or n.created_by = auth.uid())
  ), '[]'::jsonb);
end $f$;

-- Post a new notice, or change one (same id). Managers and above.
create or replace function public.save_notice(p_shop uuid, p_id uuid, p_title text, p_body text, p_pinned boolean, p_min_level integer)
returns void language plpgsql security definer set search_path to '' as $f$
declare me record; n public.notices%rowtype;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null or me.lvl < 3 then raise exception 'Only Managers and above can post notices' using errcode = '42501'; end if;
  if p_id is null then raise exception 'Invalid notice'; end if;
  if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Title: up to 120 characters, required'; end if;
  if length(coalesce(p_body, '')) > 4000 then raise exception 'Message: up to 4,000 characters'; end if;
  if p_min_level not in (1, 2, 3) then raise exception 'Choose who sees it'; end if;
  select * into n from public.notices where id = p_id for update;
  if found then
    if n.shop_id <> p_shop or n.archived then raise exception 'This notice was taken down' using errcode = 'PT409'; end if;
    update public.notices set title = btrim(p_title), body = coalesce(p_body, ''), pinned = coalesce(p_pinned, false),
      min_level = p_min_level, updated_by_label = me.label, updated_at = now()
    where id = p_id;
  else
    if (select count(*) from public.notices where shop_id = p_shop and not archived) >= 200 then
      raise exception 'Take down some old notices first (200 at most)';
    end if;
    insert into public.notices (id, shop_id, title, body, pinned, min_level, created_by, created_by_label)
    values (p_id, p_shop, btrim(p_title), coalesce(p_body, ''), coalesce(p_pinned, false), p_min_level, auth.uid(), me.label);
  end if;
end $f$;

-- Take a notice down (it stops showing; kept for the record). Managers and above.
create or replace function public.archive_notice(p_shop uuid, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null or me.lvl < 3 then raise exception 'Only Managers and above can take notices down' using errcode = '42501'; end if;
  update public.notices set archived = true, updated_by_label = me.label, updated_at = now()
  where id = p_id and shop_id = p_shop;
  if not found then raise exception 'Notice not found'; end if;
end $f$;

-- Mark a notice read by the signed-in staff member.
create or replace function public.read_notice(p_shop uuid, p_id uuid) returns void
language plpgsql security definer set search_path to '' as $f$
declare me record;
begin
  select * into me from private.notice_member(p_shop);
  if me.lvl is null then raise exception 'Business access denied' using errcode = '42501'; end if;
  if not exists (select 1 from public.notices where id = p_id and shop_id = p_shop and not archived
                 and (min_level <= me.lvl or created_by = auth.uid())) then
    raise exception 'Notice not found';
  end if;
  insert into public.notice_reads (notice_id, user_id, user_label) values (p_id, auth.uid(), me.label)
  on conflict (notice_id, user_id) do nothing;
end $f$;

revoke all on function private.notice_member(uuid) from public, anon, authenticated;
revoke all on function public.get_notices(uuid) from public, anon;
revoke all on function public.save_notice(uuid, uuid, text, text, boolean, integer) from public, anon;
revoke all on function public.archive_notice(uuid, uuid) from public, anon;
revoke all on function public.read_notice(uuid, uuid) from public, anon;
grant execute on function public.get_notices(uuid) to authenticated;
grant execute on function public.save_notice(uuid, uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.archive_notice(uuid, uuid) to authenticated;
grant execute on function public.read_notice(uuid, uuid) to authenticated;
