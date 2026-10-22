import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStockBelowZero, setStockBelowZeroBlocked } from '../src/stock-rule.mjs';

const m = (available) => ({
  materials: [{ id: 'a', name: 'Envelope — Blue', measurementUnit: 'piece', available }],
});

test('stock may go below zero unless the business blocks it', () => {
  setStockBelowZeroBlocked(false);
  assert.doesNotThrow(() => checkStockBelowZero(m(5), m(-5)));
  setStockBelowZeroBlocked(true);
  assert.throws(
    () => checkStockBelowZero(m(5), m(-5)),
    /Not enough Envelope — Blue: 5 piece in stock, this needs 10\. Ask an admin to update the stock first\./,
  );
  assert.doesNotThrow(() => checkStockBelowZero(m(5), m(0)), 'using all of it is fine');
  assert.doesNotThrow(() => checkStockBelowZero(m(-8), m(-3)), 'adding to a negative balance is fine');
  assert.throws(() => checkStockBelowZero(m(-3), m(-4)), /0 piece in stock, this needs 1/);
  setStockBelowZeroBlocked(false);
});
