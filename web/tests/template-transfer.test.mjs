import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id } from './pricing-fixture.mjs';
import { priceTemplate, templateDefaults, validateTemplate } from '../src/pricing-templates.mjs';
import {
  exportTemplateFile,
  readTemplateFile,
  suggestTemplateMappings,
  importedTemplateNames,
  importTemplateFile,
  MAX_TEMPLATE_FILE_BYTES,
} from '../src/template-transfer.mjs';

function setup() {
  const { ledger } = fixture();
  const source = ledger.pricing.templates[0];
  const text = exportTemplateFile([source], ledger);
  const file = readTemplateFile(text);
  const mapping = suggestTemplateMappings(file, ledger);
  return { ledger, source, text, file, mapping };
}

test('round-trip retains pricing, all material choices, and stock usage; creates new identities', () => {
  const { ledger, source, text, file, mapping } = setup();
  assert.equal(file.items.length, 4);
  assert.ok(!text.includes('500000'));
  assert.ok(!text.includes('customer'));
  assert.ok(!text.includes('expression'));
  const templates = importTemplateFile(
    file,
    ledger,
    ledger.pricing,
    mapping,
    importedTemplateNames(file, ledger.pricing.templates),
    () => id(101),
  );
  const copy = templates.at(-1);
  assert.equal(copy.name, 'Books (import 1)');
  assert.equal(copy.id, id(101));
  assert.equal(copy.version, 1);
  for (const paper of [1, 2]) {
    const inputs = { ...templateDefaults(source), inner_paper: paper };
    const a = priceTemplate(ledger, source, inputs, 50);
    const b = priceTemplate(ledger, copy, inputs, 50);
    assert.equal(a.price.amount, b.price.amount);
    assert.deepEqual(
      a.stock.map((s) => [s.materialId, s.quantity]),
      b.stock.map((s) => [s.materialId, s.quantity]),
    );
  }
  assert.equal(ledger.pricing.templates.length, 1);
});

test('cross-shop import remaps IDs and formula names, uses local costs and leaves stock intact', () => {
  const { ledger, source, file } = setup();
  const local = structuredClone(ledger);
  local.services.forEach((s, i) => {
    s.id = id(200 + i);
    s.costing.key = 'local_' + s.costing.key;
    s.costing.amount *= 2;
  });
  const mapping = Object.fromEntries(
    file.items.map((s) => [s.id, local.services.find((x) => x.description === s.name).id]),
  );
  const before = JSON.stringify(local);
  const templates = importTemplateFile(
    file,
    local,
    { ...ledger.pricing, templates: [] },
    mapping,
    ['Imported books'],
    () => id(102),
  );
  const copy = templates[0];
  assert.match(copy.expenses[2].formula, /local_binding/);
  assert.equal(copy.expenses[2].calculation.method, 'perItem');
  assert.equal(copy.expenses[2].calculation.rate, 'local_binding');
  assert.equal(copy.variables.find((v) => v.key === 'inner_paper').options[1].serviceId, id(201));
  assert.equal(
    Number(priceTemplate(local, copy, templateDefaults(copy), 50).price.cost),
    2 * Number(priceTemplate(ledger, source, templateDefaults(source), 50).price.cost),
  );
  assert.equal(JSON.stringify(local), before);
});

test('import requires all references, compatible units, active items, and required cost data', () => {
  const { ledger, file, mapping } = setup();
  const run = () => importTemplateFile(file, ledger, ledger.pricing, mapping, ['Imported'], () => id(103));
  mapping[file.items[0].id] = '';
  assert.throws(run, /compatible/);
  mapping[file.items[0].id] = ledger.services[0].id;
  ledger.materials[0].measurementUnit = 'ream';
  assert.throws(run, /compatible/);
  ledger.materials[0].measurementUnit = 'sheet';
  ledger.services[0].archived = true;
  assert.throws(run, /compatible/);
  ledger.services[0].archived = false;
  ledger.materials[0].archived = true;
  assert.throws(run, /compatible/);
  ledger.materials[0].archived = false;
  delete ledger.services[0].costing.amount;
  assert.throws(run, /compatible/);
});

test('same-name ambiguity needs manual matching, and limits/duplicate names are enforced', () => {
  const { ledger, file, mapping } = setup();
  ledger.services.push({ ...ledger.services[0], id: id(150) });
  assert.equal(suggestTemplateMappings(file, ledger)[file.items[0].id], '');
  ledger.services.pop();
  assert.throws(
    () => importTemplateFile(file, ledger, ledger.pricing, mapping, ['Books'], () => id(104)),
    /different name/,
  );
  assert.throws(
    () =>
      importTemplateFile(file, ledger, { ...ledger.pricing, maxTemplates: 1 }, mapping, ['New'], () =>
        id(104),
      ),
    /limit/,
  );
});

test('rejects malformed, oversized, future-version, tampered and circular files', () => {
  const { text } = setup();
  assert.throws(() => readTemplateFile('{'), /valid/);
  assert.throws(() => readTemplateFile(' '.repeat(MAX_TEMPLATE_FILE_BYTES + 1)), /2 MB/);
  const change = (fn) => {
    const f = JSON.parse(text);
    fn(f);
    return JSON.stringify(f);
  };
  assert.throws(() => readTemplateFile(change((f) => (f.version = 99))), /version/);
  assert.throws(() => readTemplateFile(change((f) => f.items.pop())), /Unknown|missing/);
  assert.throws(() => readTemplateFile(change((f) => (f.items[0].uses = ['stock']))), /do not match/);
  assert.throws(() => readTemplateFile(change((f) => f.templates.push(f.templates[0]))), /duplicate/);
  assert.throws(
    () => readTemplateFile(change((f) => (f.templates[0].computed[0].formula = 'paper_required + 1'))),
    /Circular/,
  );
});

test('selling price and explicit stock references remap; formula substrings stay intact', () => {
  const { ledger, source } = setup();
  source.expenses.push({ key: 'selling', label: 'Selling price', formula: 'art_card_price * quantity' });
  source.computed[1].stock = { serviceId: ledger.services[2].id };
  const file = readTemplateFile(exportTemplateFile([source], ledger));
  ledger.services[2].costing.key = 'new_card';
  const mapping = Object.fromEntries(file.items.map((s) => [s.id, s.id]));
  const t = importTemplateFile(file, ledger, { ...ledger.pricing, templates: [] }, mapping, ['Stock'], () =>
    id(105),
  )[0];
  assert.match(t.expenses.at(-1).formula, /new_card_price/);
  assert.equal(t.computed[1].stock.serviceId, ledger.services[2].id);
  assert.equal(t.computed[1].key, 'cards_required');
});

test('mapping cannot shadow local variables; default pricing failures block the whole import', () => {
  const { ledger, file, mapping } = setup();
  ledger.services[3].costing.key = 'quantity';
  assert.throws(
    () => importTemplateFile(file, ledger, ledger.pricing, mapping, ['Imported'], () => id(106)),
    /conflicts/,
  );
  ledger.services[3].costing.key = 'binding';
  file.templates[0].expenses[0].formula = '1 / (quantity - 50)';
  delete file.templates[0].expenses[0].calculation;
  assert.throws(
    () => importTemplateFile(file, ledger, ledger.pricing, mapping, ['Imported'], () => id(106)),
    /zero/,
  );
});

test('fixed-only templates transfer without a catalogue', () => {
  const { ledger, source } = setup();
  const t = validateTemplate({
    ...source,
    variables: source.variables.slice(0, 2),
    computed: [],
    expenses: [{ key: 'fixed', label: 'Fixed', formula: 'quantity * 10' }],
  });
  const file = readTemplateFile(exportTemplateFile([t], ledger));
  assert.equal(file.items.length, 0);
  assert.equal(
    importTemplateFile(file, ledger, { ...ledger.pricing, templates: [] }, {}, ['Fixed'], () => id(107))
      .length,
    1,
  );
});
