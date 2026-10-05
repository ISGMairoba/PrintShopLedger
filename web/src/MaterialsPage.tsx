import { useState, type FormEvent } from 'react';
import type { Material, MaterialEvent } from './types';

type Props = { materials: Material[]; ready: boolean; busy: boolean; actor: { id: string; label: string }; onSave: (event: MaterialEvent) => Promise<void> };
const timestamp = (value: string) => new Date(value).toLocaleString();
export default function MaterialsPage({ materials, ready, busy, actor, onSave }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<Material | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Material | null>(null);
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<string | null>(null);
  const editing = editor && editor !== 'new' ? editor : null;
  const visible = materials.filter(material => (filter === 'all' || material.archived === (filter === 'archived'))
    && `${material.name} ${material.id} ${material.measurementUnit}`.toLowerCase().includes(query.toLowerCase()));
  async function commit(kind: MaterialEvent['kind'], data: MaterialEvent['data']) {
    setError('');
    try {
      await onSave({ id: crypto.randomUUID(), kind, data: { ...data, modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: new Date().toISOString() } });
      setEditor(null); setConfirmation(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save material.'); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    await commit(editing ? 'material.updated' : 'material.created', {
      id: editing?.id ?? crypto.randomUUID(), baseVersion: editing?.version,
      name: String(data.get('name')).trim(), available: Number(data.get('available')),
      measurementUnit: String(data.get('measurementUnit')).trim(), requireSize: data.get('requireSize') === 'on',
      modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: ''
    });
  }
  return <>
    <section className="stats"><article><span>Active materials</span><strong>{materials.filter(item => !item.archived).length}</strong><small>Available for future jobs</small></article>
      <article><span>Require size</span><strong>{materials.filter(item => !item.archived && item.requireSize).length}</strong><small>Size-based pricing</small></article>
      <article><span>Archived materials</span><strong>{materials.filter(item => item.archived).length}</strong><small>Records and quantities retained</small></article></section>
    {error && <div className="notice" role="alert">{error}</div>}
    <section className="panel">
      <div className="toolbar material-toolbar"><input aria-label="Search materials" placeholder="Search name, ID or unit" value={query} onChange={e => setQuery(e.target.value)} />
        <select aria-label="Material status" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All materials</option></select>
        <button disabled={!ready || busy} onClick={() => { setEditor('new'); setConfirmation(null); setError(''); }}>+ Add material</button></div>
      {!ready ? <div className="empty">Loading materials.</div> : !visible.length ? <div className="empty"><h2>{query ? 'No matching materials' : filter === 'archived' ? 'No archived materials' : 'No materials yet'}</h2><p>{query ? 'Try another name, ID or unit.' : 'Add materials to manage stock and define how each one is priced.'}</p></div> :
        <div className="table-wrap"><table className="materials-table"><thead><tr><th>Material / unique ID</th><th>Available</th><th>Measurement unit</th><th>Require size</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {visible.map(material => <tr key={material.id}><td><strong>{material.name}</strong><small className="material-id">{material.id}</small>
            <button className="text-button" aria-expanded={audit === material.id} onClick={() => setAudit(audit === material.id ? null : material.id)}>Audit details</button>
            {audit === material.id && <dl className="material-audit"><dt>Created by</dt><dd>{material.createdByLabel}<small>{material.createdBy}</small></dd><dt>Created at</dt><dd>{timestamp(material.createdAt)}</dd><dt>Modified by</dt><dd>{material.modifiedByLabel}<small>{material.modifiedBy}</small></dd><dt>Modified at</dt><dd>{timestamp(material.modifiedAt)}</dd></dl>}</td>
            <td>{material.available.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td><td>{material.measurementUnit}</td><td>{material.requireSize ? 'Yes' : 'No'}</td><td><span className={`badge ${material.archived ? 'unpaid' : 'paid'}`}>{material.archived ? 'Archived' : 'Active'}</span></td>
            <td><div className="material-actions">{!material.archived && <button className="text-button" disabled={busy} onClick={() => { setEditor(material); setConfirmation(null); setError(''); }}>Edit</button>}
              <button className="text-button" disabled={busy} onClick={() => { setConfirmation(material); setEditor(null); setError(''); }}>{material.archived ? 'Restore' : 'Archive'}</button></div></td></tr>)}
        </tbody></table></div>}
    </section>
    {confirmation && <section className="panel editor" aria-label="Confirm material status change"><h2>{confirmation.archived ? 'Restore' : 'Archive'} {confirmation.name}?</h2>
      <p>{confirmation.archived ? 'The material will be active again.' : 'Its quantity and audit information will be kept. You can restore it later.'}</p>
      <div className="material-actions"><button disabled={busy} onClick={() => void commit(confirmation.archived ? 'material.restored' : 'material.archived', { id: confirmation.id, baseVersion: confirmation.version, modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: '' })}>{busy ? 'Saving...' : confirmation.archived ? 'Restore material' : 'Archive material'}</button>
        <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div></section>}
    {editor && <section className="panel editor" aria-label="Material editor"><div className="toolbar"><h2>{editing ? 'Edit material' : 'Add material'}</h2><button className="secondary" disabled={busy} onClick={() => setEditor(null)}>Cancel</button></div>
      <form key={editing ? `${editing.id}:${editing.version}` : 'new'} onSubmit={submit}>
        {editing ? <p className="material-id">Unique ID: {editing.id}</p> : <p className="muted">A permanent unique ID is generated when you save.</p>}
        <fieldset disabled={busy}><div className="form-grid"><label>Name<input name="name" defaultValue={editing?.name ?? ''} maxLength={160} required /></label>
          <label>Available<input name="available" type="number" inputMode="decimal" min="0" max="1000000000000" step="0.001" defaultValue={editing?.available ?? 0} required /></label>
          <label>Measurement unit<input name="measurementUnit" list="material-units" placeholder="e.g. sheet, metre, square metre" maxLength={40} defaultValue={editing?.measurementUnit ?? ''} required /></label>
          <label className="material-checkbox"><span><input name="requireSize" type="checkbox" defaultChecked={editing?.requireSize ?? false} /> Require size</span><small>Enable when the service price depends on dimensions. Otherwise pricing uses quantity only. Checkout calculations will be added in a later step.</small></label></div>
          <datalist id="material-units">{['sheet', 'piece', 'metre', 'square metre', 'roll', 'kilogram', 'litre'].map(unit => <option key={unit} value={unit} />)}</datalist>
          <button type="submit">{busy ? 'Saving...' : 'Save material'}</button></fieldset>
      </form></section>}
  </>;
}
