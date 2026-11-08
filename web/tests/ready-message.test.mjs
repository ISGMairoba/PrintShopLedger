import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { readyMessage } from '../src/ready-message.mjs';
import { validateJobSettings } from '../src/business-branding.mjs';

const ledger = () => ({
  ...emptyLedger(),
  customers: [{ id: 'c', name: 'Ada Obi', phone: '0803 123 4567' }],
  jobs: [
    {
      id: 'aaaaaaaa-1',
      customerId: 'c',
      checkoutId: 'k',
      description: 'Paper bags',
      quantity: '200',
      amount: 2000000,
      productionStatus: 'Completed',
      createdAt: '2026-11-01T10:00:00Z',
    },
    {
      id: 'bbbbbbbb-2',
      customerId: 'c',
      checkoutId: 'k',
      description: 'Stickers',
      quantity: '1',
      amount: 500000,
      productionStatus: 'Completed',
      createdAt: '2026-11-01T10:00:00Z',
    },
    {
      id: 'cccccccc-3',
      customerId: 'c',
      checkoutId: 'k',
      description: 'Logo',
      quantity: '1',
      amount: 1000000,
      productionStatus: 'Printing',
      createdAt: '2026-11-01T10:00:00Z',
    },
  ],
  payments: [],
});

test("ready message: the sale's ready jobs in one WhatsApp message, with what is left to pay", () => {
  const l = ledger();
  const m = readyMessage(l, l.jobs[0], {
    business: 'Mairoba Studio',
    terms: { job: 'order', jobs: 'orders' },
  });
  assert.equal(
    m.text,
    'Hello Ada, your orders #AAAAAAAA, #BBBBBBBB (Paper bags × 200, Stickers) are ready for collection at Mairoba Studio. Balance to pay: ₦25,000.00.',
  );
  assert.match(m.link, /^https:\/\/wa\.me\/2348031234567\?text=Hello%20Ada/);
  const own = readyMessage(l, l.jobs[0], { business: 'X', template: '{customer}: {items} ready. {balance}' });
  assert.equal(own.text, 'Ada: Paper bags × 200, Stickers ready. Balance to pay: ₦25,000.00.');
  assert.equal(validateJobSettings({ readyMessage: ' Hi {customer} ' }).readyMessage, 'Hi {customer}');
  assert.throws(() => validateJobSettings({ readyMessage: 'x'.repeat(601) }), /600/);
});
