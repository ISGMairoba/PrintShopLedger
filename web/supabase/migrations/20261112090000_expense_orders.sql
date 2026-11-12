-- Expenses → For orders: an expense can be linked to up to 20 orders (jobs) of the business, so
-- its cost counts in their profit (profit.mjs) instead of under expenses. Stock purchases are not
-- linked: their cost reaches orders through the materials they use. The app applies the same
-- rules (expenses.mjs expenseJobIds).

create or replace function private.expense_job_ids(p_shop uuid, p_ids jsonb, p_lines jsonb) returns jsonb
language plpgsql stable set search_path to '' as $f$
declare n integer;
begin
  if p_ids is null or p_ids = 'null'::jsonb then return '[]'::jsonb; end if;
  if jsonb_typeof(p_ids) <> 'array' or jsonb_array_length(p_ids) > 20 then raise exception 'Link the expense to up to 20 orders'; end if;
  if exists (select 1 from jsonb_array_elements(p_ids) x where jsonb_typeof(x) <> 'string'
             or x #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'A linked order was not found';
  end if;
  if (select count(distinct x) from jsonb_array_elements_text(p_ids) x) <> jsonb_array_length(p_ids) then raise exception 'Link each order once'; end if;
  if jsonb_array_length(p_ids) > 0 and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
    raise exception 'A stock purchase reaches orders through the materials they use, so it is not linked to orders';
  end if;
  select count(*) into n from public.jobs j where j.shop_id = p_shop and j.id::text in (select jsonb_array_elements_text(p_ids));
  if n <> jsonb_array_length(p_ids) then raise exception 'A linked order was not found'; end if;
  return p_ids;
end $f$;
revoke all on function private.expense_job_ids(uuid, jsonb, jsonb) from public, anon, authenticated;

do $patch$
declare d text; pat text;
begin
  d := pg_get_functiondef('private.apply_expense_event(uuid,jsonb)'::regprocedure);
  pat := '''payeeId'',coalesce\(d->''payeeId'',old->''payeeId'',''null''::jsonb\),';
  if regexp_count(d, pat) <> 1 then raise exception 'apply_expense_event payee pattern not found'; end if;
  execute regexp_replace(d, pat, $$'payeeId',coalesce(d->'payeeId',old->'payeeId','null'::jsonb),'jobIds',private.expense_job_ids(p_shop,coalesce(d->'jobIds',old->'jobIds'),lines),$$);
end $patch$;
