-- A quotation becomes a sale in one step (audit AUD-24). The sale used to be saved first and the
-- quotation marked "converted" afterwards, as a separate change; if the second step never arrived
-- (network, the phone closing) the quotation still looked open and could be sold again, and two
-- people could convert it at once. Now the sale carries its quotation (data.quotationId) and, in the
-- same save, the quotation is marked converted; a second sale from the same quotation is refused.
create or replace function private.convert_quotation_with_sale() returns trigger
language plpgsql security definer set search_path to '' as $f$
declare q public.quotations%rowtype; qid uuid;
begin
  begin qid := (new.data->>'quotationId')::uuid; exception when others then raise exception 'Invalid quotation'; end;
  if qid is null then return new; end if;
  select * into q from public.quotations where shop_id = new.shop_id and id = qid for update;
  if not found then return new; end if;  -- removed meanwhile: the sale still saves
  if q.data->>'status' = 'converted' then
    if q.data->>'checkoutId' is distinct from new.id::text then
      raise exception 'This quotation is already an order. Open that order instead of selling it again.' using errcode = 'PT409';
    end if;
    return new;
  end if;
  update public.quotations set data = data || jsonb_build_object(
      'status', 'converted', 'checkoutId', new.id, 'convertedAt', new.data->'createdAt',
      'convertedByLabel', new.data->'createdByLabel', 'version', coalesce((data->>'version')::integer, 0) + 1,
      'modifiedBy', new.data->'createdBy', 'modifiedByLabel', new.data->'createdByLabel', 'modifiedAt', new.data->'createdAt')
   where shop_id = new.shop_id and id = qid;
  return new;
end $f$;
revoke all on function private.convert_quotation_with_sale() from public, anon, authenticated;
drop trigger if exists convert_quotation on public.checkout_records;
create trigger convert_quotation after insert on public.checkout_records
  for each row when (new.data ? 'quotationId') execute function private.convert_quotation_with_sale();
