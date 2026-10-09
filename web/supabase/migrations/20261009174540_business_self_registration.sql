create table private.registration_config (
 singleton boolean primary key default true check(singleton),
 developer_email text not null default 'mairobaprints@gmail.com',
 worker_hash text not null
);
create table private.business_registrations (
 owner_id uuid primary key references auth.users(id),
 shop_id uuid unique not null references public.shops(id),
 developer_id uuid unique not null references auth.users(id),
 activation_hash text unique not null check(length(activation_hash)=64),
 expires_at timestamptz not null default now()+interval '7 days',
 activation_claim uuid,
 activation_claimed_at timestamptz,
 activated_at timestamptz
);
create table private.registration_mail (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid unique not null references public.shops(id),
 business_name text not null,
 owner_email text not null,
 recipient text not null,
 activation_url text,
 status text not null default 'pending' check(status in ('pending','sending','sent','expired')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 claim_id uuid,
 claimed_at timestamptz,
 sent_at timestamptz,
 last_error text,
 provider_id text
);
alter table private.registration_config enable row level security;
alter table private.business_registrations enable row level security;
alter table private.registration_mail enable row level security;
revoke all on private.registration_config,private.business_registrations,private.registration_mail from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.registration_config,private.business_registrations,private.registration_mail to service_role;

do $$ begin
 if not exists(select 1 from vault.secrets where name='printshopledger_registration_worker') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'printshopledger_registration_worker');
 end if;
 insert into private.registration_config(worker_hash)
 select encode(extensions.digest(decrypted_secret,'sha256'),'hex') from vault.decrypted_secrets where name='printshopledger_registration_worker';
end $$;

create function private.complete_business_registration(p_owner uuid,p_developer uuid,p_name text,p_owner_name text,p_activation_hash text,p_activation_url text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_shop uuid;v_existing uuid;v_email text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,0));
 select shop_id into v_existing from private.business_registrations where owner_id=p_owner;
 if found then return jsonb_build_object('shopId',v_existing,'created',false);end if;
 if exists(select 1 from public.business_accounts where user_id=p_owner) then raise exception 'This email already has a business workspace.';end if;
 if exists(select 1 from public.shop_members where user_id=p_owner) then raise exception 'Staff accounts cannot register businesses.';end if;
 select email into v_email from auth.users where id=p_owner and email_confirmed_at is not null and deleted_at is null;
 if v_email is null then raise exception 'Verify the business email before creating a workspace.';end if;
 if length(btrim(p_name)) not between 1 and 160 or length(btrim(p_owner_name)) not between 1 and 160 then raise exception 'Enter valid business and owner names.';end if;
 if p_activation_hash !~ '^[a-f0-9]{64}$' or p_activation_url not like 'https://print-shop-ledger.vercel.app/#developer_activation=%' then raise exception 'Invalid activation data.';end if;
 if not exists(select 1 from auth.users where id=p_developer and email like 'staff-developer-%@staff.printshopledger.invalid') then raise exception 'Invalid Developer identity.';end if;
 insert into public.shops(name) values(btrim(p_name)) returning id into v_shop;
 insert into public.business_accounts(shop_id,user_id) values(v_shop,p_owner);
 insert into public.shop_members(shop_id,user_id,role,name,username,rank,access_level,created_by,modified_by)
 values(v_shop,p_owner,'manager',btrim(p_owner_name),'manager',3,3,p_owner,p_owner),
 (v_shop,p_developer,'developer','Developer Maintenance','developer',4,0,p_owner,p_owner);
 insert into private.business_registrations(owner_id,shop_id,developer_id,activation_hash) values(p_owner,v_shop,p_developer,p_activation_hash);
 insert into private.registration_mail(shop_id,business_name,owner_email,recipient,activation_url)
 select v_shop,btrim(p_name),v_email,developer_email,p_activation_url from private.registration_config;
 return jsonb_build_object('shopId',v_shop,'created',true);
end $$;
revoke all on function private.complete_business_registration(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function private.complete_business_registration(uuid,uuid,text,text,text,text) to service_role;
create function public.complete_business_registration(p_owner uuid,p_developer uuid,p_name text,p_owner_name text,p_activation_hash text,p_activation_url text)
returns jsonb language sql security invoker set search_path='' as $$select private.complete_business_registration(p_owner,p_developer,p_name,p_owner_name,p_activation_hash,p_activation_url)$$;
revoke all on function public.complete_business_registration(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_business_registration(uuid,uuid,text,text,text,text) to service_role;

create function public.registration_worker_authorized(p_key text) returns boolean language sql security invoker set search_path='' as $$
 select coalesce((select worker_hash=encode(extensions.digest(p_key,'sha256'),'hex') from private.registration_config),false)
$$;
create function public.claim_registration_mail(p_shop uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 update private.registration_mail m set status='expired',last_error='Activation link expired; maintenance must issue a new link.'
 from private.business_registrations r where m.shop_id=r.shop_id and r.expires_at<=now() and m.status<>'sent';
 with due as (
 select id from private.registration_mail where (p_shop is null or shop_id=p_shop) and next_attempt_at<=now()
 and (status='pending' or (status='sending' and claimed_at<now()-interval '2 minutes')) order by next_attempt_at limit 10 for update skip locked
 ),claimed as (
 update private.registration_mail m set status='sending',claim_id=gen_random_uuid(),claimed_at=now(),attempts=attempts+1
 from due where m.id=due.id returning m.*
 ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
 return result;
end $$;
create function public.finish_registration_mail(p_id uuid,p_claim uuid,p_sent boolean,p_error text,p_provider_id text)
returns void language sql security invoker set search_path='' as $$
 update private.registration_mail set status=case when p_sent then 'sent' else 'pending' end,
 sent_at=case when p_sent then now() else null end,
 activation_url=case when p_sent then null else activation_url end,last_error=left(p_error,200),
 provider_id=p_provider_id,next_attempt_at=now()+interval '5 minutes'*least(12,greatest(attempts,1))
 where id=p_id and claim_id=p_claim and status='sending'
$$;
create function public.claim_developer_activation(p_hash text,p_claim uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.business_registrations%rowtype;
begin
 select * into r from private.business_registrations where activation_hash=p_hash for update;
 if not found or r.activated_at is not null or r.expires_at<=now() or
 (r.activation_claimed_at>now()-interval '2 minutes') then raise exception 'Activation link is invalid, expired or already used.';end if;
 update private.business_registrations set activation_claim=p_claim,activation_claimed_at=now() where owner_id=r.owner_id;
 return jsonb_build_object('userId',r.developer_id,'shopId',r.shop_id);
end $$;
create function public.finish_developer_activation(p_hash text,p_claim uuid,p_success boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.business_registrations%rowtype;v_name text;
begin
 select * into r from private.business_registrations where activation_hash=p_hash and activation_claim=p_claim for update;
 if not found or r.activated_at is not null then raise exception 'Activation request is no longer valid.';end if;
 if p_success then
  update public.shop_members set access_level=4,modified_at=now(),version=version+1 where shop_id=r.shop_id and user_id=r.developer_id and rank=4 and not archived;
  if not found then raise exception 'Developer access is unavailable.';end if;
  update private.business_registrations set activated_at=now(),activation_claim=null,activation_claimed_at=null where owner_id=r.owner_id;
 else update private.business_registrations set activation_claim=null,activation_claimed_at=null where owner_id=r.owner_id;end if;
 select name into v_name from public.shops where id=r.shop_id;
 return jsonb_build_object('businessName',v_name,'username','developer');
end $$;
revoke all on function public.registration_worker_authorized(text),public.claim_registration_mail(uuid),
public.finish_registration_mail(uuid,uuid,boolean,text,text),public.claim_developer_activation(text,uuid),public.finish_developer_activation(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.registration_worker_authorized(text),public.claim_registration_mail(uuid),
public.finish_registration_mail(uuid,uuid,boolean,text,text),public.claim_developer_activation(text,uuid),public.finish_developer_activation(text,uuid,boolean) to service_role;

-- Existing tenants keep their access; all future workspace creation goes through the verified provisioning service.
create or replace function public.create_shop(p_name text) returns uuid language plpgsql security invoker set search_path='' as $$
begin raise exception 'Use Register your business to create a workspace.';end $$;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create function private.run_registration_mail_worker() returns bigint language sql security definer set search_path='' as $$
 select net.http_post(url:='https://wxggsackpbqyixkznpez.supabase.co/functions/v1/registration-mail-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='printshopledger_registration_worker')),
 body:='{}'::jsonb,timeout_milliseconds:=15000)
$$;
revoke all on function private.run_registration_mail_worker() from public,anon,authenticated,service_role;
select cron.schedule('registration-mail-retry','*/5 * * * *','select private.run_registration_mail_worker()');
