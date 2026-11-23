-- AUD-10 stage 1 (plans/audit-2-overnight.md): the server checks these rules with the branch's own
-- settings (Business Settings → Branches → a branch's own Jobs & payments, Corrections), not the
-- business-wide ones:
--   * stock may not go below zero: at a branch or store (its stock), and for a transfer (the sending location)
--   * the most discount each rank may give: sales and quotations
--   * who confirms materials in production, and who may add materials in production
--   * who corrects a deposit with no job
-- The main branch and businesses without branches use the business-wide settings, as before.
-- Each function is changed by replacing exactly the part that reads the setting; if a part is not
-- found as expected, the migration stops and changes nothing. Running it again changes nothing more.
do $m$
declare
  f record; src text; n int;
  rules constant text[][] := array[
    -- [function, the text that reads the business-wide setting, the branch's own]
    array['private.apply_job_check_event_core',
      $a$(select (s.settings->'production'->>'confirmMaterialsRank')::int from public.business_settings s where s.shop_id = p_shop)$a$,
      $b$(private.branch_settings(p_shop, private.request_branch(p_shop))->'production'->>'confirmMaterialsRank')::int$b$],
    array['private.apply_job_extra_materials_event_core',
      $a$(select (settings->'production'->>'extraMaterialsRank')::int from public.business_settings where shop_id = p_shop)$a$,
      $b$(private.branch_settings(p_shop, private.request_branch(p_shop))->'production'->>'extraMaterialsRank')::int$b$],
    array['private.correct_deposit',
      $a$(select settings->'corrections'->>'depositCorrection' from public.business_settings where shop_id = p_shop)$a$,
      $b$(private.branch_settings(p_shop, private.request_branch(p_shop))->'corrections'->>'depositCorrection')$b$],
    array['private.location_stock_overlay',
      $a$exists (select 1 from public.business_settings s
      where s.shop_id = new.shop_id and s.settings->'jobs'->>'stockBelowZero' = 'block')$a$,
      $b$private.branch_settings(new.shop_id, loc)->'jobs'->>'stockBelowZero' = 'block'$b$],
    array['public.transfer_stock',
      $a$exists (select 1 from public.business_settings s
      where s.shop_id = p_shop and s.settings->'jobs'->>'stockBelowZero' = 'block')$a$,
      $b$private.branch_settings(p_shop, p_from)->'jobs'->>'stockBelowZero' = 'block'$b$],
    array['public.apply_checkout_event',
      $a$(select (s.settings->'discounts'->'maxPercent'->>lvl::text)::numeric from public.business_settings s where s.shop_id=p_shop)$a$,
      $b$(private.branch_settings(p_shop, private.request_branch(p_shop))->'discounts'->'maxPercent'->>lvl::text)::numeric$b$],
    array['public.apply_quotation_event',
      $a$(s.settings->'discounts'->'maxPercent'->>m.access_level::text)::numeric$a$,
      $b$(private.branch_settings(p_shop, private.request_branch(p_shop))->'discounts'->'maxPercent'->>m.access_level::text)::numeric$b$]
  ];
  r text[]; old_text text; new_text text;
begin
  foreach r slice 1 in array rules loop
    n := 0;
    -- Pasted into the SQL editor from Windows, this file's own line breaks arrive as CR LF: compare
    -- without CRs on both sides.
    old_text := replace(r[2], E'\r', '');
    new_text := replace(r[3], E'\r', '');
    for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
              where s.nspname || '.' || p.proname = r[1] loop
      src := replace(pg_get_functiondef(f.oid), E'\r', '');
      n := n + 1;
      -- Already changed (run before): nothing to do.
      if strpos(src, old_text) = 0 and strpos(src, new_text) > 0 then continue; end if;
      if strpos(src, old_text) = 0 then raise exception 'AUD-10: % does not read the setting as expected', r[1]; end if;
      execute replace(src, old_text, new_text);
    end loop;
    if n = 0 then raise exception 'AUD-10: % not found', r[1]; end if;
  end loop;
end $m$;
