import { emptyLedger } from '../src/domain.mjs';
import { defaultBranding } from '../src/business-branding.mjs';
import { bookTemplate, validatePricingSettings } from '../src/pricing-templates.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
export const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const actor = { id: id(1), label: 'Template tester' };
export function fixture() {
  const ledger = emptyLedger();
  ledger.customers = [
    {
      id: id(2),
      name: 'Book customer',
      phone: '080template',
      address: '',
      creditLimit: 0,
      archived: false,
      version: 1,
    },
  ];
  ledger.materials = [
    {
      id: id(3),
      name: 'Art cards',
      available: 100,
      measurementUnit: 'card',
      requireSize: false,
      archived: false,
      version: 1,
    },
    {
      id: id(4),
      name: 'Paper',
      available: 200,
      measurementUnit: 'sheet',
      requireSize: false,
      archived: false,
      version: 1,
    },
  ];
  ledger.services = [
    {
      id: id(5),
      description: 'Art cards',
      materialId: id(3),
      price: 20000,
      shelfItem: true,
      archived: false,
      version: 1,
    },
    { id: id(6), description: 'DI printing', materialId: null, price: 50000, archived: false, version: 1 },
    {
      id: id(7),
      description: 'Paper Printing',
      materialId: id(4),
      price: 10000,
      archived: false,
      version: 1,
    },
    { id: id(8), description: 'Binding', materialId: null, price: 30000, archived: false, version: 1 },
  ];
  const t = bookTemplate();
  t.id = id(9);
  t.inputs.find((i) => i.key === 'coversPerCard').default = 2;
  t.components.forEach((c, index) => {
    c.id = id(10 + index);
    c.serviceId = id(5 + index);
  });
  ledger.pricing = validatePricingSettings({ enabled: true, templates: [t] });
  const line = {
    id: id(20),
    serviceId: t.id,
    description: 'Book order',
    quantity: 10,
    source: 'In shop / USB',
    sourceNote: '',
    templateInputs: { pages: 41, pagesPerSheet: 4, coversPerCard: 2 },
    templateStockIds: Object.fromEntries(t.components.map((c, n) => [c.id, id(30 + n)])),
  };
  const input = {
    customerId: id(2),
    lines: [line],
    cashReceived: 500000,
    useWallet: false,
    paidOn: '2026-10-13',
    method: 'Cash',
    reference: '',
  };
  const event = prepareCheckout(ledger, input, actor, id(21), '2026-10-13T08:00:00Z');
  return {
    ledger,
    line,
    input,
    event,
    settings: { ...defaultBranding(), businessName: 'Template test', pricing: ledger.pricing },
  };
}
