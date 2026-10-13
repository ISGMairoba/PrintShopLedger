import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quotationMessage,
  receiptMessage,
  statementMessage,
  whatsappLink,
  whatsappNumber,
} from '../src/share.mjs';

test('Nigerian phone numbers become WhatsApp numbers', () => {
  assert.equal(whatsappNumber('0803 123 4567'), '2348031234567');
  assert.equal(whatsappNumber('+234 803-123-4567'), '2348031234567');
  assert.equal(whatsappNumber('2348031234567'), '2348031234567');
  assert.equal(whatsappNumber('8031234567'), '2348031234567');
  assert.equal(whatsappNumber('00447700900123'), '447700900123');
  assert.equal(whatsappNumber('080333'), '');
  assert.equal(whatsappNumber(''), '');
  assert.equal(
    whatsappLink('08031234567', 'Hi & thanks'),
    'https://wa.me/2348031234567?text=Hi%20%26%20thanks',
  );
  assert.equal(whatsappLink('', 'Hi'), 'https://wa.me/?text=Hi');
});

test('Messages greet the customer and give the key amounts', () => {
  const r = receiptMessage(
    {
      id: 'b8e634d3-0000',
      customerSnapshot: { name: 'Ada Obi' },
      cashReceived: 500000,
      outstandingAfter: 250000,
    },
    'Packrium',
  );
  assert.equal(
    r,
    'Hello Ada, here is your receipt B8E634D3 from Packrium. Paid now: ₦5,000.00. Balance on your account: ₦2,500.00.',
  );
  assert.match(
    receiptMessage({ id: 'x', customerSnapshot: { name: '' }, cashReceived: 0, outstandingAfter: 0 }, ''),
    /^Hello there, here is your receipt X\. .*Thank you/,
  );
  assert.match(
    quotationMessage({ customerName: 'Bello', total: 3000000 }, 'Q-1', 'Shop', '27 Oct 2026'),
    /quotation Q-1 from Shop for ₦30,000\.00, valid until 27 Oct 2026/,
  );
  assert.match(statementMessage('Ada', 120000, 'Shop'), /Amount owed: ₦1,200\.00/);
  assert.doesNotMatch(statementMessage('Ada', 0, 'Shop'), /owed/);
});
