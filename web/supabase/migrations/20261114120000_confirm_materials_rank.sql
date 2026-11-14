-- Business Settings → Jobs & payments → "Who may confirm materials used without approval":
-- settings.production.confirmMaterialsRank (1 Cashiers, 2 Admins — the default, 3 Managers).
-- At or above it, a materials check applies at once; below it, it waits for approval.
-- The app applies the same rule (material-check.mjs, production-materials.mjs confirmMaterialsRank).
do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('public.apply_job_check_event(uuid,jsonb)'::regprocedure);
  pat := '\(mode\s*=\s*''confirm''\)\s*<>\s*\(lvl\s*>=\s*2\)';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_job_check_event rank pattern not found'; end if;
  d := regexp_replace(d, pat, $r$(mode = 'confirm') <> (lvl >= coalesce((select (s.settings->'production'->>'confirmMaterialsRank')::int from public.business_settings s where s.shop_id = p_shop), 2))$r$);
  d := replace(d, 'An Admin or higher confirms materials; others send them for approval. Sync and try again.',
    'Your rank sends materials for approval (Business Settings → Jobs & payments). Sync and try again.');
  execute d;
end $patch$;
