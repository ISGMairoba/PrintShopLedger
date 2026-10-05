import { useState } from 'react';
import { serviceCode, servicePrice } from './services.mjs';
import { materialCode } from './material-display.mjs';
import type { ServiceSyncConflict } from './cloud';
type Props = { conflict: ServiceSyncConflict; busy: boolean; onResolve: (choice: 'local' | 'cloud', materialId: string) => Promise<void> };
export default function ServiceConflictReview({ conflict, busy, onResolve }: Props) {
  const { local, remote, materials } = conflict;
  const options = materials.filter(item => !item.archived || item.id === remote?.materialId);
  const [materialId, setMaterialId] = useState(options.some(item => item.id === local.materialId) ? local.materialId : '');
  const materialName = (id: string) => materials.find(item => item.id === id)?.name ?? 'Material unavailable';
  return <section className="panel editor" aria-label="Resolve service edit"><h2>Review service changes</h2><p>{serviceCode(local.id)}</p>
    <div className="table-wrap"><table><thead><tr><th>Field</th><th>This device</th><th>Business workspace</th></tr></thead><tbody>
      <tr><td>Description</td><td>{local.description}</td><td>{remote?.description ?? 'Not yet created'}</td></tr>
      <tr><td>Base material</td><td>{materialName(local.materialId)}</td><td>{remote ? materialName(remote.materialId) : '-'}</td></tr>
      <tr><td>Price</td><td>{servicePrice(local.price)}</td><td>{remote ? servicePrice(remote.price) : '-'}</td></tr>
      <tr><td>Status</td><td>{local.archived ? 'Archived' : 'Active'}</td><td>{remote ? remote.archived ? 'Archived' : 'Active' : '-'}</td></tr>
      <tr><td>Modified by</td><td>{local.modifiedByLabel}</td><td>{remote?.modifiedByLabel ?? '-'}</td></tr>
    </tbody></table></div>
    <label>Base material for this device's version<select disabled={busy} value={materialId} onChange={e => setMaterialId(e.target.value)}><option value="" disabled>Select an available base material</option>
      {options.map(item => <option key={item.id} value={item.id}>{item.name} ({materialCode(item.id, materials)}){item.archived ? ' · Archived' : ''}</option>)}</select></label>
    <p>Keeping the business version discards pending changes to this service on this device. Other pending records are kept.</p>
    <div className="material-actions"><button disabled={busy || !materialId} onClick={() => void onResolve('local', materialId)}>Keep this device's version</button>
      <button className="secondary" disabled={busy} onClick={() => void onResolve('cloud', materialId)}>Keep business version</button></div>
  </section>;
}
