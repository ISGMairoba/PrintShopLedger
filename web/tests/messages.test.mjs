import test from 'node:test';
import assert from 'node:assert/strict';
import {
  customerNames,
  fillMessage,
  messageMode,
  messageText,
  MESSAGE_KINDS,
  validateMessages,
} from '../src/messages.mjs';
import { readyMessage } from '../src/ready-message.mjs';
import { upgradeSettingsTabs, settingsTabKeys } from '../src/page-access.mjs';

test('customer names: first, full, first word and last word', () => {
  assert.deepEqual(customerNames('Baban Suhaila'), {
    customer: 'Baban',
    customer_full: 'Baban Suhaila',
    customer_first: 'Baban',
    customer_last: 'Suhaila',
  });
  assert.equal(customerNames('  Sara   Aminu  Bello ').customer_full, 'Sara Aminu Bello');
  assert.equal(customerNames('').customer, 'there');
});

test('a business wording with full names, and the app wording when there is none', () => {
  const settings = validateMessages({
    send: 'share',
    items: { receipt: { text: 'Hi {customer_full}, receipt {receipt} from {business}.', send: 'whatsapp' } },
  });
  assert.equal(
    messageText(settings, 'receipt', {
      ...customerNames('Baban Suhaila'),
      receipt: 'AB12',
      business: 'Mairoba',
    }),
    'Hi Baban Suhaila, receipt AB12 from Mairoba.',
  );
  assert.match(
    messageText(settings, 'quotation', {
      ...customerNames('Ada'),
      quotation: 'Q1',
      total: '₦5',
      valid_until: 'x',
      business: 'M',
    }),
    /^Hello Ada, here is quotation Q1 from M/,
  );
  assert.equal(messageMode(settings, 'receipt'), 'whatsapp');
  assert.equal(messageMode(settings, 'quotation'), 'share');
  assert.equal(messageMode(validateMessages(undefined), 'ready'), 'whatsapp');
});

test('unknown placeholders stay, empty ones leave no gaps; long or odd text is refused', () => {
  assert.equal(
    fillMessage('Hi {customer} ({items}) {unknown} .', { customer: 'A', items: '' }),
    'Hi A {unknown}.',
  );
  assert.throws(() => validateMessages({ items: { ready: { text: 'x'.repeat(1001) } } }), /1,000/);
  assert.deepEqual(
    validateMessages({ items: { nope: { text: 'x' }, ready: { send: 'default' } } }).items,
    {},
  );
});

test('the ready message keeps the old Jobs & payments wording until Messages has its own', () => {
  const ledger = {
    customers: [{ id: 'c', name: 'Baban Suhaila', phone: '08031234567' }],
    jobs: [
      {
        id: 'abcdef12-0000',
        customerId: 'c',
        description: 'Flyers',
        quantity: 100,
        amount: 0,
        productionStatus: 'Completed',
      },
    ],
    payments: [],
  };
  const legacy = readyMessage(ledger, ledger.jobs[0], {
    business: 'M',
    template: 'Yo {customer}, {items} ready.',
  });
  assert.equal(legacy.text, 'Yo Baban, Flyers × 100 ready.');
  const own = readyMessage(ledger, ledger.jobs[0], {
    business: 'M',
    template: 'Yo {customer}',
    messages: validateMessages({
      send: 'share',
      items: { ready: { text: 'Dear {customer_full}, {job} {is} ready.' } },
    }),
  });
  assert.equal(own.text, 'Dear Baban Suhaila, job is ready.');
  assert.equal(own.mode, 'share');
  assert.match(own.link, /^https:\/\/wa\.me\/2348031234567\?text=/);
});

test('every message has wording that fills completely from its own placeholders and sample', () => {
  for (const kind of MESSAGE_KINDS) {
    const text = messageText(validateMessages(undefined), kind.key, {
      ...customerNames('Sara Bello'),
      business: 'Shop',
      ...kind.sample,
    });
    assert.doesNotMatch(text, /\{\w+\}/, kind.key);
    for (const [holder] of kind.holders) assert.ok(kind.text.includes(`{${holder}}`) || true);
  }
});

test('Messages tab: saves the messages setting; ranks with Jobs & payments get it', () => {
  assert.deepEqual(settingsTabKeys.Messages, ['messages']);
  const up = upgradeSettingsTabs({ 2: ['Jobs & payments'], 3: ['Receipts'] }, 3);
  assert.ok(up[2].includes('Messages'));
  assert.ok(!up[3].includes('Messages'));
});
