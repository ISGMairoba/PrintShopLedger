-- Snapshot document terms without changing existing documents or access checks.
do $migration$
declare src text; signature text; needle text := E'begin\n'; guard text := $guard$
 if d ? 'termsAndConditions' and (jsonb_typeof(d->'termsAndConditions') is distinct from 'string' or length(d->>'termsAndConditions')>5000) then
   raise exception 'Terms and conditions must be text, up to 5,000 characters';
 end if;
$guard$;
begin
 foreach signature in array array['public.apply_checkout_event(uuid,jsonb)','public.apply_quotation_event(uuid,jsonb)'] loop
  src := pg_get_functiondef(signature::regprocedure);
  if strpos(src,needle)=0 then raise exception 'Document terms: function body marker missing for %',signature; end if;
  src := replace(src,needle,needle||guard);
  if signature like '%quotation%' then
   if strpos(src,$old$'note', btrim(d->>'note'),$old$)=0 then raise exception 'Document terms: quotation snapshot marker missing'; end if;
   src := replace(src,$old$'note', btrim(d->>'note'),$old$,$new$'note', btrim(d->>'note'),
      'termsAndConditions', btrim(coalesce(d->>'termsAndConditions',old->>'termsAndConditions','')),$new$);
  end if;
  execute src;
 end loop;
end $migration$;
