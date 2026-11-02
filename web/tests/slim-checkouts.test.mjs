import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLedger, rebuildSaleJobs } from '../src/materials.mjs';

test('a shortened sale is rebuilt exactly as it was at the sale', () => {
  const job = {
    id: 'j1',
    description: 'Flex',
    quantity: 2,
    width: 5,
    height: 3,
    productionStatus: 'Collected',
    version: 4,
  };
  const atSale = { ...job, productionStatus: 'Added', version: 1 };
  // The server sends only what differs from the current job.
  const sent = {
    id: 'c1',
    total: 600000,
    jobsTrimmed: true,
    jobs: [{ id: 'j1', productionStatus: 'Added', version: 1 }],
  };
  const [rebuilt] = rebuildSaleJobs([sent], [job]);
  assert.deepEqual(rebuilt.jobs, [atSale]);
  assert.equal('jobsTrimmed' in rebuilt, false);
  // Full copies (older servers, or earlier downloads) are left as they are.
  const full = { id: 'c2', jobs: [atSale] };
  assert.equal(rebuildSaleJobs([full], [job])[0], full);
  assert.deepEqual(normalizeLedger({ jobs: [job], checkouts: [sent] }).checkouts[0].jobs, [atSale]);
});
