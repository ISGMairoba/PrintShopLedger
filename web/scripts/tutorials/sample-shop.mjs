// A made-up shop for the tutorial videos: generic products, two customers and one unpaid job,
// built with the app's own events so it is exactly what the app would save.
import { applyEvent, emptyLedger } from '../../src/domain.mjs';
import { defaultBranding } from '../../src/business-branding.mjs';
import { prepareCheckout } from '../../src/checkout.mjs';
import { newVariantProductEvents } from '../../src/variants.mjs';

// The local trial user, so the sample sale shows on My Sales.
const actor = { id: 'local-trial', label: 'Local trial user' };
const at = '2026-10-10T09:00:00Z';
const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: at };
const uid = () => crypto.randomUUID();

export function sampleShop() {
  let ledger = emptyLedger();
  const apply = (kind, data) => {
    ledger = applyEvent(ledger, { id: uid(), kind, data: { ...data, ...audit } });
    return data.id;
  };
  const material = (name, unit, available, minimumStock = 0) =>
    apply('material.created', {
      id: uid(),
      name,
      available,
      measurementUnit: unit,
      requireSize: false,
      minimumStock,
      reason: 'Opening stock',
    });
  const service = (description, materialId, price, extra = {}) =>
    apply('service.created', { id: uid(), description, materialId, price, ...extra });
  const paper = material('A4 paper', 'sheet', 2000, 200);
  const printing = service('A4 printing (black & white)', paper, 5000);
  service('A4 printing (colour)', paper, 15000);
  service('Lamination (A4)', null, 30000);
  service('Spiral binding', null, 50000);
  service('Business cards', material('Card stock', 'card', 500, 50), 2000, { shelfItem: false });
  service('Art card', material('Art card', 'card', 150, 20), 20000, { shelfItem: true });
  service('Ballpoint pen', material('Ballpoint pen', 'piece', 300, 30), 15000, {
    shelfItem: true,
    packPrices: [{ quantity: 12, price: 150000 }],
  });
  for (const event of newVariantProductEvents(
    ledger,
    {
      name: 'Envelope',
      unit: 'piece',
      price: 10000,
      packPrices: [{ quantity: 25, price: 200000 }],
      variants: [
        { name: 'Brown', stock: 400, minimum: 50 },
        { name: 'White', stock: 600, minimum: 50 },
        { name: 'Blue', stock: 250, minimum: 50 },
      ],
    },
    actor,
    at,
  ))
    ledger = applyEvent(ledger, event);
  const ada = apply('customer.created', {
    id: uid(),
    name: 'Ada Okafor',
    phone: '08031234567',
    address: '12 Market Road',
    creditLimit: 5000000,
  });
  apply('customer.created', {
    id: uid(),
    name: 'Bello Stores',
    phone: '08029876543',
    address: '',
    creditLimit: 0,
  });
  // An earlier job Ada has not paid for yet, for the "Taking a payment" video.
  ledger = applyEvent(
    ledger,
    prepareCheckout(
      ledger,
      {
        customerId: ada,
        lines: [
          {
            id: uid(),
            serviceId: printing,
            description: 'Course notes',
            quantity: '200',
            width: '',
            height: '',
            source: 'In shop / USB',
            sourceNote: '',
          },
        ],
        cashReceived: 0,
        useWallet: false,
        paidOn: '2026-10-10',
        method: 'Cash',
        methodLabel: 'Cash',
        reference: '',
      },
      actor,
      uid(),
      at,
    ),
  );
  const settings = { ...defaultBranding(), businessName: 'Sample Print Shop', theme: 'light' };
  return { ledger, settings };
}
