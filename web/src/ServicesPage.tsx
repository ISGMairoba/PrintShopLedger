import Icon from './Icon';
import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { SortHeader, useTableSort } from './TableSort';
import { money } from './domain.mjs';
import { materialCode } from './material-display.mjs';
import { serviceCode, serviceMatches, servicePrice } from './services.mjs';
import type { Material, Service, ServiceEvent } from './types';
type Props = { services: Service[]; materials: Material[]; ready: boolean; busy: boolean; actor: { id: string; label: string }; onSave: (event: ServiceEvent) => Promise<void> };
const timestamp = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
export default function ServicesPage({ services, materials, ready, busy, actor, onSave }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [audit, setAudit] = useState(false);
  const [editor, setEditor] = useState<Service | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Service | null>(null);
  const [error, setError] = useState('');
  const editing = editor && editor !== 'new' ? editor : null;
  const activeMaterials = materials.filter(item => !item.archived);
  const options = materials.filter(item => !item.archived || item.id === editing?.materialId);
  const sorting = useTableSort<Service>('description');
  const visible = sorting.sortRows(services.filter(item => (filter === 'all' || item.archived === (filter === 'archived')) && serviceMatches(item, materials, services, query)), {
      id:item=>serviceCode(item.id,services),description:item=>item.description,material:item=>materials.find(material=>material.id===item.materialId)?.name,price:item=>item.price,
      status:item=>item.archived?'Archived':'Active',createdBy:item=>item.createdByLabel,createdAt:item=>Date.parse(item.createdAt),modifiedBy:item=>item.modifiedByLabel,modifiedAt:item=>Date.parse(item.modifiedAt) });
  async function commit(kind: ServiceEvent['kind'], values: Omit<ServiceEvent['data'], 'modifiedBy' | 'modifiedByLabel' | 'modifiedAt'>) {
    setError('');
    try {
      await onSave({ id: crypto.randomUUID(), kind, data: { ...values, modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: new Date().toISOString() } });
      setEditor(null); setConfirmation(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save service.'); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const data = new FormData(e.currentTarget);
    try {
      const price = money(String(data.get('price')));
      await commit(editing ? 'service.updated' : 'service.created', { id: editing?.id ?? crypto.randomUUID(), baseVersion: editing?.version,
        description: String(data.get('description')).trim(), materialId: String(data.get('material')), price });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enter a valid price.'); }
  }
  return <>
    <section className="stats"><article><span>Active services</span><strong>{services.filter(item => !item.archived).length}</strong><small>Services in your catalogue</small></article>
      <article><span>Base materials</span><strong>{new Set(services.filter(item => !item.archived).map(item => item.materialId)).size}</strong><small>One material can support several services</small></article>
      <article><span>Archived services</span><strong>{services.filter(item => item.archived).length}</strong><small>Records retained</small></article></section>
    {error && !editor && !confirmation && <div className="notice" role="alert">{error}</div>}
    {ready && !activeMaterials.length && <div className="notice">Add or restore a material on the Materials page before creating a service.</div>}
    <section className="panel"><div className="toolbar service-toolbar"><input aria-label="Search services" placeholder="Search description, ID, material or price" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Service status" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All services</option></select>
      <button className="secondary" aria-pressed={audit} onClick={() => setAudit(!audit)}><Icon name={audit?'table':'audit'}/> {audit ? 'Normal view' : 'Audit view'}</button>
      <button disabled={!ready || busy || !activeMaterials.length} onClick={() => { setEditor('new'); setConfirmation(null); setError(''); }}><Icon name="add"/> Add service</button></div>
      {!ready ? <div className="empty">Loading services.</div> : !visible.length ? <div className="empty"><h2>{query ? 'No matching services' : filter === 'archived' ? 'No archived services' : 'No services yet'}</h2>
        <p>{query ? 'Search by service description, ID, base material or price.' : 'Create services such as Colour printing and Black printing, each with its own price.'}</p></div> :
        <div className="table-wrap"><table><thead><tr><SortHeader label="Service ID" column="id" sort={sorting} /><SortHeader label="Description" column="description" sort={sorting} /><SortHeader label="Base material" column="material" sort={sorting} /><SortHeader label="Price" column="price" sort={sorting} /><SortHeader label="Status" column="status" sort={sorting} />
          {audit && <><SortHeader label="Created by" column="createdBy" sort={sorting} /><SortHeader label="Created at" column="createdAt" sort={sorting} /><SortHeader label="Modified by" column="modifiedBy" sort={sorting} /><SortHeader label="Modified at" column="modifiedAt" sort={sorting} /></>}<th>Actions</th></tr></thead><tbody>
          {visible.map(service => { const material = materials.find(item => item.id === service.materialId); return <tr key={service.id}>
            <td className="material-id">{serviceCode(service.id, services)}</td><td><strong>{service.description}</strong></td>
            <td>{material?.name ?? 'Material unavailable'}<small>{material ? materialCode(material.id, materials) : ''}{material?.archived ? ' · Archived material' : ''}</small></td>
            <td>{servicePrice(service.price)}</td><td><span className={`badge ${service.archived ? 'unpaid' : 'paid'}`}>{service.archived ? 'Archived' : 'Active'}</span></td>
            {audit && <><td>{service.createdByLabel}</td><td>{timestamp(service.createdAt)}</td><td>{service.modifiedByLabel}</td><td>{timestamp(service.modifiedAt)}</td></>}
            <td><div className="material-actions">{!service.archived && <button className="text-button" disabled={busy} onClick={() => { setEditor(service); setConfirmation(null); setError(''); }}><Icon name="edit"/> Edit</button>}
              <button className={`text-button ${service.archived ? '' : 'danger-text'}`} disabled={busy} onClick={() => { setConfirmation(service); setEditor(null); setError(''); }}><Icon name={service.archived?'restore':'archive'}/> {service.archived ? 'Restore' : 'Archive'}</button></div></td>
          </tr>; })}</tbody></table></div>}
    </section>
    {confirmation && <Modal title={`${confirmation.archived ? 'Restore' : 'Archive'} ${confirmation.description}?`} busy={busy} onClose={() => setConfirmation(null)}>
      {error && <div className="notice" role="alert">{error}</div>}
      <p>{confirmation.archived ? 'This service will be active again.' : 'Its price, base material link and audit details will be retained. You can restore it later.'}</p>
      <div className="material-actions"><button className={confirmation.archived ? '' : 'danger-button'} disabled={busy} onClick={() => void commit(confirmation.archived ? 'service.restored' : 'service.archived', { id: confirmation.id, baseVersion: confirmation.version })}>{busy ? 'Saving...' : confirmation.archived ? 'Restore service' : 'Archive service'}</button>
        <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button></div></Modal>}
    {editor && <Modal title={editing ? 'Edit service' : 'Add service'} busy={busy} onClose={() => setEditor(null)}>
      {error && <div className="notice" role="alert">{error}</div>}
      {editing ? <p className="material-id">Service ID: {serviceCode(editing.id, services)}</p> : <p className="muted">A permanent service ID is generated when you save.</p>}
      <form key={editing ? editing.id + ':' + editing.version : 'new'} onSubmit={submit}><fieldset disabled={busy}><div className="form-grid">
        <label>Service description<input name="description" maxLength={500} defaultValue={editing?.description ?? ''} placeholder="e.g. A4 colour printing" required /></label>
        <label>Base material<select name="material" defaultValue={editing?.materialId ?? ''} required><option value="" disabled>Select material</option>{options.map(item => <option key={item.id} value={item.id}>{item.name} ({materialCode(item.id, materials)}){item.archived ? ' · Archived' : ''}</option>)}</select></label>
        <label>Price (₦)<input name="price" type="number" inputMode="decimal" min="0" max="1000000000" step="0.01" defaultValue={editing ? (editing.price / 100).toFixed(2) : ''} required /></label></div>
        <p className="muted">Several services can share the same base material. Checkout pricing will use that material's Require Size setting.</p>
        <button type="submit"><Icon name="save"/> {busy ? 'Saving...' : 'Save service'}</button></fieldset></form></Modal>}
  </>;
}
