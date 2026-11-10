-- Staff sign-in (the staff-login function): after 5 wrong passwords for a username within 15
-- minutes, that username is locked for the rest of the 15 minutes. A right password clears it.
-- Only the function (service role) can read or record attempts.

create table if not exists private.staff_login_failures (
  shop_id uuid not null,
  username text not null,
  failed_at timestamptz not null default now()
);
create index if not exists staff_login_failures_lookup on private.staff_login_failures (shop_id, username, failed_at desc);
alter table private.staff_login_failures enable row level security;

-- Seconds until this username may try again (0 when it may try now).
create or replace function public.staff_login_wait(p_shop uuid, p_username text) returns integer
language sql stable security definer set search_path to '' as $f$
  select coalesce(greatest(0, ceil(extract(epoch from (min(failed_at) + interval '15 minutes' - now()))))::integer, 0)
  from (
    select failed_at from private.staff_login_failures
    where shop_id = p_shop and username = lower(btrim(p_username)) and failed_at > now() - interval '15 minutes'
    order by failed_at desc limit 5
  ) recent
  having count(*) >= 5
$f$;

create or replace function public.staff_login_result(p_shop uuid, p_username text, p_ok boolean) returns void
language plpgsql security definer set search_path to '' as $f$
begin
  if p_ok then
    delete from private.staff_login_failures where shop_id = p_shop and username = lower(btrim(p_username));
  else
    insert into private.staff_login_failures (shop_id, username) values (p_shop, lower(btrim(p_username)));
  end if;
  -- Old attempts are of no use.
  delete from private.staff_login_failures where failed_at < now() - interval '1 day';
end $f$;

revoke all on function public.staff_login_wait(uuid, text) from public, anon, authenticated;
revoke all on function public.staff_login_result(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.staff_login_wait(uuid, text) to service_role;
grant execute on function public.staff_login_result(uuid, text, boolean) to service_role;
