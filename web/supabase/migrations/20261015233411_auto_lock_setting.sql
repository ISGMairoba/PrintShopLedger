-- Auto-lock: Business Settings → Security sets how many idle minutes before the app signs the
-- staff user out (0 = off). A new "Security" settings tab holds it; Managers get the tab.

create or replace function private.settings_tab_keys(p_tabs jsonb) returns text[]
language sql immutable set search_path='' as $$
 select coalesce(array_agg(k),'{}') from (values
 ('Profile & logo','businessName'),('Profile & logo','address'),('Profile & logo','phones'),('Profile & logo','email'),
 ('Profile & logo','website'),('Profile & logo','socials'),('Profile & logo','logo'),
 ('Profile & logo','logoVariants'),('Profile & logo','logoUsage'),
 ('Appearance','primary'),('Appearance','accent'),('Appearance','theme'),('Appearance','backgrounds'),
 ('Receipts','receipt'),('Receipts','receiptPage'),('Receipts','documents'),
 ('Dropdowns & workflow','options'),
 ('Jobs & payments','jobs'),('Jobs & payments','terms'),('Jobs & payments','discounts'),('Jobs & payments','periods'),
 ('Pricing templates','pricing'),('Corrections','corrections'),('Security','security')
 ) as t(tab,k) where p_tabs ? tab
$$;

do $migration$
declare def text;next text;fn regprocedure;swap text[];
begin
 for fn,swap in select * from (values
  ('public.save_business_settings(uuid,integer,jsonb)'::regprocedure,array[
   $a$"Pricing templates","Corrections"]'::jsonb$a$,
   $b$"Pricing templates","Corrections","Security"]'::jsonb$b$]),
  ('private.check_dynamic_business_settings()'::regprocedure,array[
   $a$'Pricing templates','Corrections'];$a$,
   $b$'Pricing templates','Corrections','Security'];$b$,
   $a$ if config ? 'corrections' and$a$,
   $b$ if config ? 'security' and (jsonb_typeof(config->'security') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(config->'security') key where key<>'autoLockMinutes')
   or jsonb_typeof(config->'security'->'autoLockMinutes') is distinct from 'number'
   or (config->'security'->>'autoLockMinutes')::numeric<>trunc((config->'security'->>'autoLockMinutes')::numeric)
   or (config->'security'->>'autoLockMinutes')::numeric not between 0 and 240) then raise exception 'Choose an auto-lock time from 0 to 240 minutes';end if;
 if config ? 'corrections' and$b$])
 ) as x(f,s) loop
  def:=pg_get_functiondef(fn);next:=def;
  for i in 1..array_length(swap,1)/2 loop
   if position(swap[2*i-1] in next)=0 then raise exception 'Expected text not found in %: %',fn,left(swap[2*i-1],90);end if;
   next:=replace(next,swap[2*i-1],swap[2*i]);
  end loop;
  execute next;
 end loop;
end $migration$;

