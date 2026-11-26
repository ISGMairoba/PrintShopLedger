-- Messages (owner, 26 Nov): "Work continues" (after a hold) and "Order update" (any time) get their
-- own wording, like the others. "Order on hold" was missing from this list, so its own wording
-- could not be saved: it is added too.
create or replace function private.check_messages() returns trigger
language plpgsql set search_path to '' as $function$
declare m jsonb := new.settings->'messages'; item record;
begin
  if m is null then return new; end if;
  if jsonb_typeof(m) <> 'object' or octet_length(m::text) > 20000
     or coalesce(m->>'send', 'whatsapp') not in ('whatsapp', 'share')
     or (m ? 'items' and jsonb_typeof(m->'items') <> 'object') then
    raise exception 'Invalid message settings';
  end if;
  for item in select key, value from jsonb_each(coalesce(m->'items', '{}')) loop
    if item.key not in ('ready', 'receipt', 'quotation', 'reminder', 'statement', 'delivery', 'options', 'reorder', 'part_ready',
                        'collected', 'held', 'resumed', 'update')
       or jsonb_typeof(item.value) <> 'object'
       or (item.value ? 'text' and (jsonb_typeof(item.value->'text') <> 'string' or length(item.value->>'text') > 1000))
       or coalesce(item.value->>'send', 'default') not in ('default', 'whatsapp', 'share') then
      raise exception 'Invalid message settings';
    end if;
  end loop;
  return new;
end $function$;
