-- Business Settings → Security → History kept on devices (security.historyKeep): the business
-- default for how much history devices download. Allowed: 7d, 14d, 30d, 3m, 6m, 12m (left out =
-- Everything).
do $mig$
declare src text := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
begin
  if regexp_count(src, $q$key not in \('autoLockMinutes','syncMinutes'\)$q$) <> 1 then
    raise exception 'check_dynamic_business_settings: security key list not found once';
  end if;
  src := replace(src, $q$key not in ('autoLockMinutes','syncMinutes')$q$,
    $q$key not in ('autoLockMinutes','syncMinutes','historyKeep')$q$);
  if regexp_count(src, $q$ if config \? 'corrections'$q$) <> 1 then
    raise exception 'check_dynamic_business_settings: corrections check not found once';
  end if;
  src := replace(src, $q$ if config ? 'corrections'$q$,
    $q$ if config->'security' ? 'historyKeep' and coalesce(config->'security'->>'historyKeep','') not in ('7d','14d','30d','3m','6m','12m')
   then raise exception 'Choose how much history devices keep';end if;
 if config ? 'corrections'$q$);
  execute src;
end $mig$;
