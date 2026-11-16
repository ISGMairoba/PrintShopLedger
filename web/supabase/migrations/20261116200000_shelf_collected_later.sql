-- Quick sale → "Collected" unticked: shelf items sold now but handed over later. They start at the
-- first stage of their steps (like any job) and keep their deadline, instead of closing as
-- Collected at once. Stock is still taken at the sale. Such a sale needs a saved customer (not
-- Walk-in). The sale says so with data.collected = false; without it nothing changes.
-- apply_checkout_event is long, so this changes the three places in its current text and refuses
-- to run if any of them is not found exactly once.
do $m$
declare
  src text := pg_get_functiondef('public.apply_checkout_event'::regproc);
  later text := 'coalesce((d->>''collected'')::boolean,true)';
  a_old text := $q$ if not exists(select 1 from public.customers where shop_id=p_shop and id=c and not archived) then raise exception 'Select an active customer' using errcode='PT409';end if;$q$;
  a_new text;
  b_old text := $q$case when svc.shelf_item then line-'dueAt' else line-'shelfItem' end$q$;
  b_new text;
  c_old text := $q$'productionStatus',case when svc.shelf_item then 'Collected' else 'Added' end$q$;
  c_new text;
  n int;
begin
  if position('d->>''collected''' in src) > 0 then
    raise notice 'Already applied'; return;
  end if;
  a_new := a_old || E'\n if d ? ''collected'' and jsonb_typeof(d->''collected'') is distinct from ''boolean'' then raise exception ''Invalid collected choice'';end if;'
    || E'\n if not ' || later || ' and exists(select 1 from public.customers where shop_id=p_shop and id=c and lower(btrim(name))=''walk-in customer'' and phone !~ ''\\d'') then raise exception ''Choose a saved customer for a sale that is collected later'' using errcode=''PT409'';end if;';
  b_new := 'case when svc.shelf_item and ' || later || $q$ then line-'dueAt' else line-'shelfItem' end$q$;
  c_new := $q$'productionStatus',case when svc.shelf_item and $q$ || later || $q$ then 'Collected' else 'Added' end$q$;
  foreach n in array array[
    (length(src) - length(replace(src, a_old, ''))) / length(a_old),
    (length(src) - length(replace(src, b_old, ''))) / length(b_old),
    (length(src) - length(replace(src, c_old, ''))) / length(c_old)] loop
    if n <> 1 then raise exception 'apply_checkout_event is not the expected version (a place was found % times). Ask Claude.', n; end if;
  end loop;
  src := replace(replace(replace(src, a_old, a_new), b_old, b_new), c_old, c_new);
  execute src;
end $m$;
