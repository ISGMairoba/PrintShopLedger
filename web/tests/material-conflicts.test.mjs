import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { resolveMaterialState } from '../src/material-conflicts.mjs';
const event = (id, kind, values) => ({ id, kind, data: { id: 'm', name: 'Paper', available: 10, measurementUnit: 'sheet', requireSize: false, modifiedBy: 'u', modifiedByLabel: 'Owner', modifiedAt: '2026-10-05T10:00:00Z', ...values } });
function fixture() {
  const created = applyEvent(emptyLedger(), event('c', 'material.created'));
  const localEvent = event('l', 'material.stock_set', { baseVersion: 1, quantity: 20 });
  const local = applyEvent(created, localEvent);
  const unrelated = { id: 'customer-event', kind: 'customer.created', data: { id: 'customer', name: 'Customer', phone: '', createdAt: '2026-10-05T10:00:00Z' } };
  return { state: { ledger: applyEvent(local, unrelated), pending: [localEvent, unrelated] },
    cloud: applyEvent(created, event('r', 'material.stock_set', { baseVersion: 1, quantity: 15, modifiedBy: 'other' })) };
}
test('keeping cloud removes only conflicting material changes and preserves unrelated records', () => {
  const { state, cloud } = fixture();
  const next = resolveMaterialState(state, cloud, 'm', 'cloud', () => 'unused', '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].available, 15);
  assert.equal(next.pending.length, 1);
  assert.equal(next.ledger.customers[0].id, 'customer');
  assert.equal(state.pending.length, 2);
});
test('keeping local rebases reviewed values on current version with new event ID', () => {
  const { state, cloud } = fixture();
  const next = resolveMaterialState(state, cloud, 'm', 'local', () => 'resolved', '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].available, 20);
  assert.equal(next.ledger.materials[0].version, 4);
  assert.equal(next.ledger.materials[0].createdBy, 'u');
  assert.equal(next.pending[1].data.baseVersion, 2);
  assert.equal(next.pending[1].id, 'resolved');
});
test('keeping a local archived material works when cloud also archived it', () => {
  const { state, cloud } = fixture();
  const localArchive = event('la', 'material.archived', { baseVersion: 2 });
  state.ledger = applyEvent(state.ledger, localArchive); state.pending.push(localArchive);
  const archivedCloud = applyEvent(cloud, event('ra', 'material.archived', { baseVersion: 2 }));
  let n = 0;
  const next = resolveMaterialState(state, archivedCloud, 'm', 'local', () => 'resolution-' + ++n, '2026-10-05T11:00:00Z');
  assert.equal(next.ledger.materials[0].archived, true);
  assert.equal(next.ledger.materials[0].available, 20);
  let replay = archivedCloud;
  for (const pending of next.pending) replay = applyEvent(replay, pending);
  assert.deepEqual(replay, next.ledger);
});
