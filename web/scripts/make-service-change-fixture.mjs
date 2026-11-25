// Run: node scripts/make-service-change-fixture.mjs
// Builds supabase/tests/service_change.sql from the pricing_templates.sql setup and the app's own code.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
import { fixture, id, actor } from '../tests/pricing-fixture.mjs';
import { applyCheckout, accountToken } from '../src/checkout.mjs';
import { applySaleAdjustment } from '../src/sale-adjustments.mjs';
import { serviceChangeEvent } from '../src/service-change.mjs';
const src = readFileSync(here('../supabase/tests/pricing_templates.sql'), 'utf8').split('\n');
const templates = JSON.parse(src[4].match(/\$json\$(.*)\$json\$/)[1]);
const restore = (j) =>
  typeof j === 'string' && /^__T\d+__$/.test(j)
    ? templates[Number(j.slice(3, -2))]
    : Array.isArray(j)
      ? j.map(restore)
      : j && typeof j === 'object'
        ? Object.fromEntries(Object.entries(j).map(([k, v]) => [k, restore(v)]))
        : j;
const { ledger, event: e, settings } = fixture();
let l = applyCheckout(ledger, e);
const events = [];
const step = (job, c) => {
  const ev = serviceChangeEvent(
    l,
    job,
    { reason: 'Wrong item picked', stockMode: 'reconcile', description: job.description, ...c },
    actor,
    accountToken(l, job.customerId),
    '2026-10-14T08:00:00Z',
  );
  l = applySaleAdjustment(l, ev);
  events.push(ev);
  return l.jobs.find((j) => j.id === job.id);
};
let job = l.jobs[0];
job = step(job, {
  target: 'template',
  serviceId: id(9),
  quantity: 50,
  templateInputs: { sheets_per_book: 25, inner_paper: 2, cover_card: 1 },
});
const s1 = l.materials.map((m) => [m.id, m.available]);
job = step(job, { target: 'service', serviceId: id(7), quantity: 5, unitPrice: 20000, materialId: id(10) });
const s2 = l.materials.map((m) => [m.id, m.available]);
job = step(job, {
  target: 'template',
  serviceId: id(9),
  quantity: 40,
  templateInputs: { sheets_per_book: 25, inner_paper: 1, cover_card: 1 },
});
const s3 = l.materials.map((m) => [m.id, m.available]);
const q = (o) => `$json$${JSON.stringify(o)}$json$::jsonb`;
const checks = (s, what) =>
  s
    .map(
      ([m, n]) =>
        `if (select available from public.materials where shop_id=shop and id='${m}')<>${n} then raise exception '${what}: stock of % is %','${m}',(select available from public.materials where shop_id=shop and id='${m}');end if;`,
    )
    .join('\n');
const head = src.slice(0, 13).join('\n'); // functions and "do $test$"
const declare = src[13].replace(
  /^declare shop uuid; changed jsonb;/,
  'declare shop uuid; changed jsonb; refused text;',
);
const setup = src
  .slice(14, 40)
  .filter((x) => !/^-- Decimal|^for p in|^ if private\.tpl_text|^end loop;/.test(x))
  .join('\n');
const out = `-- Rollback-only fixture. Changing a sold job's service when a pricing template is involved
-- (sale.service_changed): template to template, template to a normal service and back, with the
-- stock put right each time; refused once materials are confirmed. Generated with the app's own code
-- (scripts/make-service-change-fixture.mjs; setup copied from pricing_templates.sql).
${head}
${declare}
${setup}
perform public.save_business_settings(shop,coalesce((select version from public.business_settings where shop_id=shop),0),${q(settings)});
update public.services set costing=jsonb_set(costing,'{amount}','500000') where shop_id=shop and id='a0000000-0000-4000-8000-000000000005';
execute 'set local role authenticated';
perform test.checkout(shop,${q(e)});
perform public.apply_supervised_event(shop,${q(events[0])});
${checks(s1, 'Template to template')}
perform public.apply_supervised_event(shop,${q(events[1])});
${checks(s2, 'Template to service')}
if (select metadata ? 'templateSnapshot' from public.jobs where shop_id=shop and id='${job.id}') then raise exception 'Template kept';end if;
perform public.apply_supervised_event(shop,${q(events[2])});
${checks(s3, 'Service to template')}
if (select amount from public.jobs where shop_id=shop and id='${job.id}')<>${job.amount} then raise exception 'Amount differs from the app: %',(select amount from public.jobs where shop_id=shop and id='${job.id}');end if;
if (select count(*) from public.sale_adjustments where shop_id=shop and data->>'action'='sale.service_changed')<>3 then raise exception 'Audit missing';end if;
-- Confirmed materials: refused.
execute 'reset role';
update public.jobs set metadata=metadata||'{"materialCheck":{"status":"confirmed","usages":[]}}' where shop_id=shop and id='${job.id}';
execute 'set local role authenticated';
refused:='';
begin
 perform public.apply_supervised_event(shop,jsonb_set(jsonb_set(${q(events[1])},'{id}','"a0000000-0000-4000-8000-000000000999"'),'{data,baseVersion}',to_jsonb((select version from public.jobs where shop_id=shop and id='${job.id}'))));
exception when others then refused:=sqlerrm;
end;
if refused not like 'Its materials are confirmed%' then raise exception 'Confirmed materials: %',refused;end if;
raise notice 'Service change passed';
end $test$;
rollback;
`;
writeFileSync(here('../supabase/tests/service_change.sql'), out);
console.log('ok', events.length);
