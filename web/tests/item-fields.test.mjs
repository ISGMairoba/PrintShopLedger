import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { calledAsEvent, displayEvent, initialsFor, itemCategories } from '../src/item-fields.mjs';
import { customerNames } from '../src/messages.mjs';

const actor = { id: 'u', label: 'Ada' };
const base = () => ({
  ...emptyLedger(),
  services: [{ id: 's', description: 'Notebook', version: 2, price: 350000, shelfItem: true }],
  customers: [{ id: 'c', name: 'Suhaila Musa Baba', phone: '080', version: 1 }],
});

test('an item gets an icon and a category; bad icons are refused', () => {
  let l = base();
  l = applyEvent(l, displayEvent(l.services[0], { icon: 'book', category: ' Stationery ' }, actor));
  assert.deepEqual(
    [l.services[0].icon, l.services[0].category, l.services[0].version],
    ['book', 'Stationery', 3],
  );
  assert.throws(
    () => applyEvent(l, displayEvent(l.services[0], { icon: 'Bad icon', category: '' }, actor)),
    /icon/,
  );
  assert.throws(
    () => applyEvent(l, displayEvent({ ...l.services[0], version: 1 }, { icon: '', category: '' }, actor)),
    /changed/,
  );
});

test('"Called as" greets the customer by that name; full name stays as saved', () => {
  let l = base();
  l = applyEvent(l, calledAsEvent(l.customers[0], 'Baban Suhaila', actor));
  const c = l.customers[0];
  assert.equal(c.calledAs, 'Baban Suhaila');
  assert.deepEqual(customerNames(c.name, c.calledAs), {
    customer: 'Baban Suhaila',
    customer_full: 'Suhaila Musa Baba',
    customer_first: 'Suhaila',
    customer_last: 'Baba',
  });
  assert.equal(customerNames(c.name).customer, 'Suhaila');
});

test('initials: own letters first, else first and last word', () => {
  assert.equal(initialsFor('Mairoba Studio'), 'MS');
  assert.equal(initialsFor('Developer  Maintenance'), 'DM');
  assert.equal(initialsFor('Ada'), 'A');
  assert.equal(initialsFor('Mairoba Studio', 'mb'), 'MB');
  assert.equal(initialsFor('Mairoba Studio', 'abc'), 'MS');
});

test('categories in use, most used first', () => {
  assert.deepEqual(
    itemCategories([
      { category: 'Bags' },
      { category: 'Books' },
      { category: 'Bags' },
      { category: '', archived: false },
      { category: 'Old', archived: true },
    ]),
    ['Bags', 'Books'],
  );
});
