import { emptyLedger } from '../src/domain.mjs';
import { defaultBranding } from '../src/business-branding.mjs';
import { validatePricingSettings } from '../src/pricing-templates.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
export const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const actor = { id: id(1), label: 'Template tester' };
const audit = {
  archived: false,
  version: 1,
  createdBy: id(1),
  createdByLabel: 'Template tester',
  createdAt: '2026-10-13T08:00:00Z',
  modifiedBy: id(1),
  modifiedByLabel: 'Template tester',
  modifiedAt: '2026-10-13T08:00:00Z',
  lastEventId: id(99),
};
/** Costora's book example: a choice of paper, an art-card cover and binding labour. */
export function bookTemplate() {
  return {
    id: id(9),
    version: 1,
    archived: false,
    name: 'Books',
    category: 'Books',
    description: 'Selectable paper, art-card cover and binding.',
    variables: [
      {
        key: 'quantity',
        label: 'Number of books',
        kind: 'number',
        unit: 'books',
        default: 50,
        min: 1,
        max: 10000,
        integer: true,
        clientVisible: true,
      },
      {
        key: 'sheets_per_book',
        label: 'Sheets per book',
        kind: 'number',
        unit: 'sheets',
        default: 25,
        min: 1,
        max: 500,
        integer: true,
        clientVisible: true,
      },
      {
        key: 'inner_paper',
        label: 'Inner paper',
        kind: 'material',
        unit: '',
        default: 1,
        min: 1,
        max: 2,
        integer: true,
        clientVisible: true,
        options: [
          { value: 1, label: '70 gsm paper', serviceId: id(5) },
          { value: 2, label: '80 gsm paper', serviceId: id(6) },
        ],
      },
      {
        key: 'cover_card',
        label: 'Cover card',
        kind: 'material',
        unit: '',
        default: 1,
        min: 1,
        max: 1,
        integer: true,
        clientVisible: false,
        options: [{ value: 1, label: 'Art card', serviceId: id(7) }],
      },
    ],
    computed: [
      {
        key: 'paper_required',
        label: 'Paper required',
        unit: 'sheet',
        formula: 'CEILING(quantity * sheets_per_book / 2 * 1.04)',
        stock: { variable: 'inner_paper' },
      },
      {
        key: 'cards_required',
        label: 'Cards required',
        unit: 'card',
        formula: 'CEILING(quantity * 1.05)',
        stock: { variable: 'cover_card' },
      },
    ],
    expenses: [
      {
        key: 'paper_expense',
        label: 'Paper',
        formula: 'paper_required * (inner_paper_rate)',
        calculation: {
          method: 'orderInput',
          rate: 'inner_paper_rate',
          input: 'paper_required',
          capacity: '25',
        },
      },
      { key: 'card_expense', label: 'Cards', formula: 'cards_required * cover_card_rate' },
      {
        key: 'binding_expense',
        label: 'Binding',
        formula: 'quantity * (binding)',
        calculation: { method: 'perItem', rate: 'binding', input: 'quantity', capacity: '25' },
      },
    ],
    pricing: { method: 'markup', rate: 30, floor: 20, maxDiscount: 5, rounding: 100 },
  };
}
export function fixture() {
  const ledger = emptyLedger();
  ledger.customers = [
    { id: id(2), name: 'Book customer', phone: '080template', address: '', creditLimit: 0, ...audit },
  ];
  const material = (n, name, unit, available) => ({
    id: id(n),
    name,
    available,
    measurementUnit: unit,
    requireSize: false,
    ...audit,
  });
  ledger.materials = [
    material(3, 'Paper 70gsm', 'sheet', 2000),
    material(4, 'Paper 80gsm', 'sheet', 2000),
    material(10, 'Art card', 'card', 100),
  ];
  ledger.services = [
    {
      id: id(5),
      description: 'Paper 70gsm',
      materialId: id(3),
      price: 0,
      private: true,
      costing: { key: 'paper_70', amount: 500000, per: 500, unit: 'ream' },
      ...audit,
    },
    {
      id: id(6),
      description: 'Paper 80gsm',
      materialId: id(4),
      price: 0,
      private: true,
      costing: { key: 'paper_80', amount: 650000, per: 500, unit: 'ream' },
      ...audit,
    },
    {
      id: id(7),
      description: 'Art card',
      materialId: id(10),
      price: 20000,
      shelfItem: true,
      costing: { key: 'art_card', amount: 20000, per: 1 },
      ...audit,
    },
    {
      id: id(8),
      description: 'Binding labour',
      materialId: null,
      price: 0,
      private: true,
      costing: { key: 'binding', amount: 10000, per: 1 },
      ...audit,
    },
  ];
  ledger.pricing = validatePricingSettings({ enabled: true, templates: [bookTemplate()] });
  const line = {
    id: id(20),
    serviceId: id(9),
    description: 'Book order',
    quantity: 50,
    source: 'In shop / USB',
    sourceNote: '',
    templateInputs: { sheets_per_book: 25, inner_paper: 1, cover_card: 1 },
    templateStockIds: { [id(3)]: id(30), [id(10)]: id(31), [id(4)]: id(32) },
  };
  const input = {
    customerId: id(2),
    lines: [line],
    cashReceived: 1000000,
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
