-- The server reads a branch's own settings (decided 19 Nov, first use: the minimum order).
-- private.branch_settings(shop, branch): the business's settings with the branch's own groups put in,
-- exactly as the app does (branches.mjs withBranchSettings and BRANCH_SETTING_GROUPS). Other server
-- checks can move to it one by one (audit AUD-10).
create or replace function private.branch_settings(p_shop uuid, p_branch text) returns jsonb
language plpgsql stable security definer set search_path to '' as $f$
declare s jsonb; own jsonb; g record; k text; v jsonb;
begin
  select settings into s from public.business_settings where shop_id = p_shop;
  s := coalesce(s, '{}'::jsonb);
  own := s->'branchSettings'->coalesce(p_branch, 'main');
  if p_branch is null or p_branch = 'main' or jsonb_typeof(own) is distinct from 'object' then return s; end if;
  for g in select * from (values
      ('profile', array['address','phones','email','website','socials','logo','logoVariants','logoUsage']),
      ('appearance', array['primary','accent','theme','backgrounds','tiles']),
      ('receipts', array['receipt','receiptPage','documents']),
      ('workflow', array['options']),
      ('jobs', array['jobs','drawers','production','discounts']),
      ('words', array['terms']),
      ('messages', array['messages']),
      ('periods', array['periods']),
      ('pricing', array['pricing']),
      ('corrections', array['corrections']),
      ('security', array['security'])) x(grp, keys) loop
    foreach k in array g.keys loop
      v := case when k = 'options' then own->'workflow'->'options' else own->g.grp->k end;
      if v is null or v = 'null'::jsonb then continue; end if;
      -- The branch keeps the business's payment methods list.
      if k = 'options' then v := v || jsonb_build_object('paymentMethods', s->'options'->'paymentMethods'); end if;
      s := jsonb_set(s, array[k], v);
    end loop;
  end loop;
  return s;
end $f$;
revoke all on function private.branch_settings(uuid, text) from public, anon, authenticated;

-- The minimum order: block or warn as the branch the sale is made at says.
do $m$
declare d text := pg_get_functiondef('private.check_min_order()'::regprocedure);
begin
  d := replace(d, E'\r', '');
  if position('private.branch_settings(' in d) > 0 then return; end if;
  -- One-line match (the SQL editor may change line breaks): the settings lookup.
  if position('select settings->''jobs''->>''minOrder'' from public.business_settings' in d) = 0 then
    raise exception 'check_min_order: settings lookup not found';
  end if;
  d := regexp_replace(d, '\(select settings->''jobs''->>''minOrder'' from public\.business_settings\s+where shop_id = new\.shop_id\)',
    '(private.branch_settings(new.shop_id, coalesce(new.branch_id, private.request_branch(new.shop_id)))->''jobs''->>''minOrder'')');
  if position('private.branch_settings(' in d) = 0 then raise exception 'check_min_order: replacement failed'; end if;
  execute d;
end $m$;
