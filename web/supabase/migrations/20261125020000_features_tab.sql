-- Business Settings → Features (owner, 25 Nov): one tab to turn parts of the app on or off. A feature
-- with its own settings tab hides that tab while it is off; Team work gets its own tab.
--   * Features saves settings.features (the parts of the app, once Developer-only under Page access)
--     and settings.teamWork (its switch; check_team_settings still lets only a General Manager or
--     higher switch it).
--   * Team work saves settings.teamWork (its choices).
--   * Jobs & payments also saves settings.costMethod. Before this, neither costMethod nor teamWork
--     was on any tab, so only Developer could save them; a General Manager's change was dropped.
--   * Tab access version 5: whoever had Jobs & payments gets Team work, and General Manager gets
--     Features (web/src/page-access.mjs upgradeSettingsTabs does the same).
-- Patterns allow for CR LF, as the SQL editor sends a pasted file.
do $patch$
declare d text; pat text;
begin
  -- 1. The settings each tab saves.
  d := pg_get_functiondef('private.settings_tab_keys(jsonb)'::regprocedure);
  if position('''Features''' in d) = 0 then
    pat := '\(''Branches'',''branchPricing''\)';
    if regexp_count(d, pat) <> 1 then raise exception 'settings_tab_keys pattern not found'; end if;
    d := regexp_replace(d, pat, $r$('Branches','branchPricing'),('Jobs & payments','costMethod'),
 ('Team work','teamWork'),('Features','features'),('Features','teamWork')$r$);
    execute d;
  end if;

  -- 2. The tab names a rank can be given.
  d := pg_get_functiondef('private.check_dynamic_business_settings()'::regprocedure);
  if position('''Features''' in d) = 0 then
    pat := '''Security'',''Branches''\]';
    if regexp_count(d, pat) <> 1 then raise exception 'check_dynamic_business_settings tabs pattern not found'; end if;
    d := regexp_replace(d, pat, $r$'Security','Branches','Team work','Features']$r$);
    execute d;
  end if;

  -- 3. Tab access version 5 when saving.
  d := pg_get_functiondef('public.save_business_settings(uuid,integer,jsonb)'::regprocedure);
  if position('''"Features"''' in d) = 0 then
    pat := '(if coalesce\(\(saved->>''settingsTabsVersion''\)::int,0\)<4[^\n]*end if;)';
    if regexp_count(d, pat) <> 1 then raise exception 'save_business_settings version pattern not found'; end if;
    d := regexp_replace(d, pat, $r$\1
  if coalesce((saved->>'settingsTabsVersion')::int,0)<5 and tabs ? 'Jobs & payments' and not tabs ? 'Team work' then tabs:=tabs||'"Team work"'::jsonb;end if;
  if coalesce((saved->>'settingsTabsVersion')::int,0)<5 and lvl=4 and not tabs ? 'Features' then tabs:=tabs||'"Features"'::jsonb;end if;$r$);
    execute d;
  end if;
end $patch$;
