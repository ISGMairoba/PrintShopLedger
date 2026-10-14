-- Pricing templates, part 2: computed variables may be shown on client quotes (clientVisible), and
-- pricing.auditRanks chooses which ranks see costs and profit (Developers always do; display only).
begin;
do $migration$
declare def text;next text;
begin
 def:=pg_get_functiondef('private.check_pricing_templates()'::regprocedure);next:=def;
 if position($a$ if (select count(*) from jsonb_array_elements(p->'templates') x where x.value->'archived'='false'::jsonb)>$a$ in next)=0
  or position($a$   if jsonb_typeof(f->'unit') is distinct from 'string' or length(btrim(f->>'unit')) not between 1 and 40$a$ in next)=0 then
  raise exception 'Template check changed; review part 2';
 end if;
 next:=replace(next,$a$ if (select count(*) from jsonb_array_elements(p->'templates') x where x.value->'archived'='false'::jsonb)>$a$,
  $b$ if p ? 'auditRanks' and (jsonb_typeof(p->'auditRanks') is distinct from 'array' or jsonb_array_length(p->'auditRanks')>3
   or exists(select 1 from jsonb_array_elements(p->'auditRanks') r where r.value not in ('1'::jsonb,'2'::jsonb,'3'::jsonb))
   or (select count(distinct r.value) from jsonb_array_elements(p->'auditRanks') r)<>jsonb_array_length(p->'auditRanks')) then
  raise exception 'Invalid template audit ranks';
 end if;
 if (select count(*) from jsonb_array_elements(p->'templates') x where x.value->'archived'='false'::jsonb)>$b$);
 next:=replace(next,$a$   if jsonb_typeof(f->'unit') is distinct from 'string' or length(btrim(f->>'unit')) not between 1 and 40$a$,
  $b$   if jsonb_typeof(f->'unit') is distinct from 'string' or length(btrim(f->>'unit')) not between 1 and 40
    or (f ? 'clientVisible' and jsonb_typeof(f->'clientVisible') is distinct from 'boolean')$b$);
 execute next;
end $migration$;
commit;
