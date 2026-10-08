set local lock_timeout='5s';
lock table public.shops in access exclusive mode;
create table public.business_settings(
 shop_id uuid primary key references public.shops(id),settings jsonb not null,
 version integer not null default 1 check(version>0),modified_at timestamptz not null default now(),modified_by uuid not null references auth.users(id)
);
alter table public.business_settings enable row level security;
create policy business_settings_read on public.business_settings for select to authenticated using(public.is_shop_member(shop_id));
create policy business_settings_insert on public.business_settings for insert to authenticated with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level>=3));
create policy business_settings_update on public.business_settings for update to authenticated using(exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level>=3)) with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level>=3));
grant select,insert,update on public.business_settings to authenticated;
create policy manager_business_name on public.shops for update to authenticated using(exists(select 1 from public.shop_members m where m.shop_id=shops.id and m.user_id=auth.uid() and not m.archived and m.access_level>=3)) with check(exists(select 1 from public.shop_members m where m.shop_id=shops.id and m.user_id=auth.uid() and not m.archived and m.access_level>=3));
grant update(name) on public.shops to authenticated;

create table public.business_settings_history(
 id uuid primary key default gen_random_uuid(),shop_id uuid not null references public.shops(id),version integer not null,
 settings jsonb not null,modified_at timestamptz not null default now(),modified_by uuid not null references auth.users(id),unique(shop_id,version)
);
alter table public.business_settings_history enable row level security;
create policy business_history_read on public.business_settings_history for select to authenticated using(exists(select 1 from public.shop_members m where m.shop_id=business_settings_history.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level>=3));
create policy business_history_insert on public.business_settings_history for insert to authenticated with check(modified_by=auth.uid() and exists(select 1 from public.shop_members m where m.shop_id=business_settings_history.shop_id and m.user_id=auth.uid() and not m.archived and m.access_level>=3));
grant select,insert on public.business_settings_history to authenticated;

create or replace function private.check_business_settings() returns trigger language plpgsql security invoker set search_path='' as $$
declare s jsonb:=new.settings;field text;max_length integer;
begin
 if jsonb_typeof(s)<>'object' or octet_length(s::text)>360000 then raise exception 'Invalid business settings';end if;
 for field,max_length in select * from(values('businessName',160),('address',500),('phones',200),('email',200),('website',300),('socials',500)) as fields(name,size) loop
  if jsonb_typeof(s->field) is distinct from 'string' or length(s->>field)>max_length or (s->>field)~'[\x00-\x08\x0b\x0c\x0e-\x1f]' then raise exception 'Invalid %',field;end if;
 end loop;
 if length(btrim(s->>'businessName'))=0 then raise exception 'Enter the business name';end if;
 if s->>'email'<>'' and s->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
 if s->>'website'<>'' and s->>'website'!~*'^https?://[^[:space:]]+$' then raise exception 'Invalid website';end if;
 if jsonb_typeof(s->'logo') is distinct from 'string' or length(s->>'logo')>350000 or (s->>'logo'<>'' and s->>'logo'!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$') then raise exception 'Invalid logo';end if;
 if coalesce(s->>'primary','')!~*'^#[0-9a-f]{6}$' or coalesce(s->>'accent','')!~*'^#[0-9a-f]{6}$' or coalesce(s->>'theme','') not in('light','dark','system') then raise exception 'Invalid appearance';end if;
 if jsonb_typeof(s->'receipt') is distinct from 'object' then raise exception 'Invalid receipt settings';end if;
 foreach field in array array['showLogo','showAddress','showContacts'] loop if jsonb_typeof(s->'receipt'->field) is distinct from 'boolean' then raise exception 'Invalid receipt option';end if;end loop;
 if jsonb_typeof(s->'receipt'->'footer') is distinct from 'string' or length(s->'receipt'->>'footer')>500 then raise exception 'Invalid receipt footer';end if;
 if tg_op='UPDATE' and new.shop_id<>old.shop_id then raise exception 'Cannot move business settings';end if;
 new.version:=case when tg_op='INSERT' then 1 else old.version+1 end;new.modified_at:=now();new.modified_by:=auth.uid();return new;
end $$;
create trigger check_business_settings before insert or update on public.business_settings for each row execute function private.check_business_settings();
create or replace function private.audit_business_settings() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.shops set name=btrim(new.settings->>'businessName') where id=new.shop_id;
 insert into public.business_settings_history(shop_id,version,settings,modified_at,modified_by)values(new.shop_id,new.version,new.settings,new.modified_at,new.modified_by);
 return new;
end $$;
create trigger audit_business_settings after insert or update on public.business_settings for each row execute function private.audit_business_settings();

create function public.save_business_settings(p_shop uuid,p_version integer,p_settings jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare result public.business_settings%rowtype;
begin
 if auth.uid() is null or not exists(select 1 from public.shop_members m where m.shop_id=p_shop and m.user_id=auth.uid() and not m.archived and m.access_level>=3) then raise exception 'Manager or Developer access required';end if;
 perform 1 from public.shops where id=p_shop for update;
 if p_version=0 then
  insert into public.business_settings(shop_id,settings,modified_by)values(p_shop,p_settings,auth.uid())on conflict do nothing returning * into result;
 else
  update public.business_settings set settings=p_settings where shop_id=p_shop and version=p_version returning * into result;
 end if;
 if result.shop_id is null then raise exception 'Business settings changed. Reload the saved version before editing.' using errcode='40001';end if;
 return to_jsonb(result);
end $$;
revoke all on function public.save_business_settings(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_business_settings(uuid,integer,jsonb) to authenticated;
