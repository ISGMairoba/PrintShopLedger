
-- Logo variants stay in the existing business-scoped, audited settings record.
-- Preserve all existing validation and authorization behavior.
do $$
declare definition text;
begin
 select pg_get_functiondef('private.check_business_settings()'::regprocedure) into definition;
 if definition not like '%octet_length(s::text)>400000%' and definition not like '%octet_length(s::text)>360000%' then
  raise exception 'Unexpected settings validator: review the payload limit before migrating';
 end if;
 definition:=replace(replace(definition,'octet_length(s::text)>400000','octet_length(s::text)>4000000'),'octet_length(s::text)>360000','octet_length(s::text)>4000000');
 execute definition;
end $$;

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
 ('Pricing templates','pricing'),('Corrections','corrections')
 ) as t(tab,k) where p_tabs ? tab
$$;

create or replace function private.valid_logo_variants(config jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare layout text;mode text;image jsonb;pair jsonb;target text;
 layouts text[]:=array['complete','stacked','horizontal','wordmark','icon'];
begin
 if config ? 'logoVariants' then
  if jsonb_typeof(config->'logoVariants') is distinct from 'object' then return false;end if;
  for layout,pair in select key,value from jsonb_each(config->'logoVariants') loop
   if not layout=any(layouts) or jsonb_typeof(pair) is distinct from 'object' then return false;end if;
   for mode,image in select key,value from jsonb_each(pair) loop
    if mode not in ('light','dark') or jsonb_typeof(image) is distinct from 'string' then return false;end if;
    if length(image#>>'{}')>350000 or ((image#>>'{}')<>'' and (image#>>'{}')!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$') then return false;end if;
   end loop;
  end loop;
 end if;
 if config ? 'logoUsage' then
  if jsonb_typeof(config->'logoUsage') is distinct from 'object' then return false;end if;
  for target,image in select key,value from jsonb_each(config->'logoUsage') loop
   if target not in ('sidebar','documents','favicon') or jsonb_typeof(image) is distinct from 'string'
     or not (image#>>'{}')=any(layouts) then return false;end if;
  end loop;
 end if;
 return true;
end $$;

alter table public.business_settings add constraint business_settings_logo_variants
 check(private.valid_logo_variants(settings)) not valid;
alter table public.business_settings validate constraint business_settings_logo_variants;

