import { useFeedbackMessage } from './Feedback';
import CurrencyInput from './CurrencyInput';
import ResponsiveTable from './ResponsiveTable';
import Icon from './Icon';
import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { shortLabel } from './material-display.mjs';
import { SortHeader, useTableSort } from './TableSort';
import { money } from './domain.mjs';
import { materialCode } from './material-display.mjs';
import { serviceCode, serviceMatches, servicePrice } from './services.mjs';
import type { Material, MaterialEvent, Service, ServiceEvent } from './types';
import { useWords } from './Words';
import { useBusinessOptions } from './BusinessOptionsContext';
type Props = {
  services: Service[];
  materials: Material[];
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: ServiceEvent) => Promise<void>;
  /** Saves several events together (a new product: its stock item, then its service). */
  onSaveMany: (events: (MaterialEvent | ServiceEvent)[]) => Promise<void>;
};
const timestamp = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
export default function ServicesPage({ services, materials, ready, busy, actor, onSave, onSaveMany }: Props) {
  const { w } = useWords();
  const units = useBusinessOptions().materialUnits;
  const [product, setProduct] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [audit, setAudit] = useState(false);
  const [editor, setEditor] = useState<Service | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Service | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const editing = editor && editor !== 'new' ? editor : null;
  const activeMaterials = materials.filter((item) => !item.archived);
  const options = materials.filter((item) => !item.archived || item.id === editing?.materialId);
  const sorting = useTableSort<Service>('description');
  const visible = sorting.sortRows(
    services.filter(
      (item) =>
        (filter === 'all' || item.archived === (filter === 'archived')) &&
        serviceMatches(item, materials, services, query),
    ),
    {
      id: (item) => serviceCode(item.id, services),
      description: (item) => item.description,
      material: (item) =>
        item.materialId === null
          ? 'No material'
          : materials.find((material) => material.id === item.materialId)?.name,
      price: (item) => item.price,
      status: (item) => (item.archived ? 'Archived' : 'Active'),
      createdBy: (item) => item.createdByLabel,
      createdAt: (item) => Date.parse(item.createdAt),
      modifiedBy: (item) => item.modifiedByLabel,
      modifiedAt: (item) => Date.parse(item.modifiedAt),
    },
  );
  async function commit(
    kind: ServiceEvent['kind'],
    values: Omit<ServiceEvent['data'], 'modifiedBy' | 'modifiedByLabel' | 'modifiedAt'>,
  ) {
    setError('');
    try {
      await onSave({
        id: crypto.randomUUID(),
        kind,
        data: {
          ...values,
          modifiedBy: actor.id,
          modifiedByLabel: actor.label,
          modifiedAt: new Date().toISOString(),
        },
      });
      setEditor(null);
      setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save service.');
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    try {
      const price = money(String(data.get('price')));
      await commit(editing ? 'service.updated' : 'service.created', {
        id: editing?.id ?? crypto.randomUUID(),
        baseVersion: editing?.version,
        description: String(data.get('description')).trim(),
        materialId: String(data.get('material')) || null,
        price,
        shelfItem: data.get('shelfItem') === 'on',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid price.');
    }
  }
  async function submitProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setError('');
    try {
      const name = String(data.get('name')).trim();
      const price = money(String(data.get('price')));
      const stock = Number(data.get('stock') || 0),
        minimum = Number(data.get('minimumStock') || 0);
      if (!name) throw Error(w('Enter a product name.'));
      if (!Number.isFinite(stock) || stock < 0) throw Error('Opening stock must be zero or more.');
      const at = new Date().toISOString();
      const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: at };
      const materialId = crypto.randomUUID();
      await onSaveMany([
        {
          id: crypto.randomUUID(),
          kind: 'material.created',
          data: {
            id: materialId,
            name,
            available: Math.round(stock * 1000) / 1000,
            measurementUnit: String(data.get('unit')).trim(),
            requireSize: false,
            minimumStock: Math.round(minimum * 1000) / 1000,
            reason: 'Opening stock',
            ...audit,
          },
        },
        {
          id: crypto.randomUUID(),
          kind: 'service.created',
          data: { id: crypto.randomUUID(), description: name, materialId, price, shelfItem: true, ...audit },
        },
      ]);
      setProduct(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the product.');
    }
  }
  return (
    <>
      <section className="stats">
        <article>
          <span>{w('Active services')}</span>
          <strong>{services.filter((item) => !item.archived).length}</strong>
          <small>{w('Services in your catalogue')}</small>
        </article>
        <article>
          <span>{w('Base materials')}</span>
          <strong>
            {
              new Set(
                services.filter((item) => !item.archived && item.materialId).map((item) => item.materialId),
              ).size
            }
          </strong>
          <small>{w('One material can support several services')}</small>
        </article>
        <article>
          <span>{w('Archived services')}</span>
          <strong>{services.filter((item) => item.archived).length}</strong>
          <small>Records retained</small>
        </article>
      </section>
      {error && !editor && !confirmation && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {ready && !activeMaterials.length && (
        <div className="notice">
          {w(
            'You can create services without a material. Add a material when a service should deduct stock.',
          )}
        </div>
      )}
      <section className="panel">
        <div className="toolbar service-toolbar">
          <input
            aria-label={w('Search services')}
            placeholder={w('Search description, ID, material or price')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label={w('Service status')} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">{w('All services')}</option>
          </select>
          <button className="secondary" aria-pressed={audit} onClick={() => setAudit(!audit)}>
            <Icon name={audit ? 'table' : 'audit'} /> {audit ? 'Normal view' : 'Audit view'}
          </button>
          <button
            disabled={!ready || busy}
            onClick={() => {
              setEditor('new');
              setConfirmation(null);
              setError('');
            }}
          >
            <Icon name="add" /> {w('Add service')}
          </button>
          <button
            className="secondary"
            disabled={!ready || busy}
            title="Creates the stock item and its shelf item together"
            onClick={() => {
              setProduct(true);
              setEditor(null);
              setConfirmation(null);
              setError('');
            }}
          >
            <Icon name="add" /> Add product
          </button>
        </div>
        {!ready ? (
          <div className="empty">{w('Loading services.')}</div>
        ) : !visible.length ? (
          <div className="empty">
            <h2>
              {w(
                query
                  ? 'No matching services'
                  : filter === 'archived'
                    ? 'No archived services'
                    : 'No services yet',
              )}
            </h2>
            <p>
              {w(
                query
                  ? 'Search by service description, ID, base material or price.'
                  : 'Create printing, pressing, binding and other services, with or without a stock material.',
              )}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 1, label: w('Service'), details: [0, 2, 4] },
                { index: 3, label: 'Price' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 0: 'ID', 2: w('Material') }}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label={w('Service ID')} column="id" sort={sorting} />
                    <SortHeader label="Description" column="description" sort={sorting} />
                    <SortHeader label={w('Base material')} column="material" sort={sorting} />
                    <SortHeader label="Price" column="price" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    {audit && (
                      <>
                        <SortHeader label="Created by" column="createdBy" sort={sorting} />
                        <SortHeader label="Created at" column="createdAt" sort={sorting} />
                        <SortHeader label="Modified by" column="modifiedBy" sort={sorting} />
                        <SortHeader label="Modified at" column="modifiedAt" sort={sorting} />
                      </>
                    )}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((service) => {
                    const material = materials.find((item) => item.id === service.materialId);
                    return (
                      <tr key={service.id}>
                        <td className="material-id">{serviceCode(service.id, services)}</td>
                        <td>
                          <strong>{service.description}</strong>
                          {service.shelfItem && (
                            <small>
                              <span className="badge paid">Shelf</span> Collected when sold
                            </small>
                          )}
                        </td>
                        <td>
                          {service.materialId === null
                            ? w('No material')
                            : (material?.name ?? w('Material unavailable'))}
                          <small>
                            {material ? materialCode(material.id, materials) : ''}
                            {material?.archived ? w(' · Archived material') : ''}
                          </small>
                        </td>
                        <td>{servicePrice(service.price)}</td>
                        <td>
                          <span className={`badge ${service.archived ? 'unpaid' : 'paid'}`}>
                            {service.archived ? 'Archived' : 'Active'}
                          </span>
                        </td>
                        {audit && (
                          <>
                            <td>{service.createdByLabel}</td>
                            <td>{timestamp(service.createdAt)}</td>
                            <td>{service.modifiedByLabel}</td>
                            <td>{timestamp(service.modifiedAt)}</td>
                          </>
                        )}
                        <td>
                          <div className="material-actions">
                            {!service.archived && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  setEditor(service);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="edit" /> Edit
                              </button>
                            )}
                            <button
                              className={`text-button ${service.archived ? '' : 'danger-text'}`}
                              disabled={busy}
                              onClick={() => {
                                setConfirmation(service);
                                setEditor(null);
                                setError('');
                              }}
                            >
                              <Icon name={service.archived ? 'restore' : 'archive'} />{' '}
                              {service.archived ? 'Restore' : 'Archive'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
      </section>
      {confirmation && (
        <Modal
          title={`${confirmation.archived ? 'Restore' : 'Archive'} ${confirmation.description}?`}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p>
            {w(
              confirmation.archived
                ? 'This service will be active again.'
                : 'Its price, base material link and audit details will be retained. You can restore it later.',
            )}
          </p>
          <div className="material-actions">
            <button
              className={confirmation.archived ? '' : 'danger-button'}
              disabled={busy}
              onClick={() =>
                void commit(confirmation.archived ? 'service.restored' : 'service.archived', {
                  id: confirmation.id,
                  baseVersion: confirmation.version,
                })
              }
            >
              {busy ? 'Saving...' : w(confirmation.archived ? 'Restore service' : 'Archive service')}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={w(editing ? 'Edit service' : 'Add service')}
          busy={busy}
          onClose={() => setEditor(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          {editing ? (
            <p className="material-id">
              {w('Service ID')}: {serviceCode(editing.id, services)}
            </p>
          ) : (
            <p className="muted">{w('A permanent service ID is generated when you save.')}</p>
          )}
          <form key={editing ? editing.id + ':' + editing.version : 'new'} onSubmit={submit}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  {w('Service description')}
                  <input
                    name="description"
                    maxLength={500}
                    defaultValue={editing?.description ?? ''}
                    placeholder="e.g. A4 colour printing"
                    required
                  />
                </label>
                <label>
                  {w('Base material')}
                  <select name="material" defaultValue={editing?.materialId ?? ''}>
                    <option value="">{w('No material — service only')}</option>
                    {options.map((item) => (
                      <option key={item.id} value={item.id} title={item.name}>
                        {shortLabel(item.name)} ({materialCode(item.id, materials)})
                        {item.archived ? ' · Archived' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Price (₦)
                  <CurrencyInput
                    name="price"
                    defaultValue={editing ? (editing.price / 100).toFixed(2) : ''}
                    required
                  />
                </label>
              </div>
              <label className="checkbox">
                <input type="checkbox" name="shelfItem" defaultChecked={editing?.shelfItem ?? false} />
                Sold off the shelf
              </label>
              <p className="muted">
                {w(
                  'Shelf items skip the job stages: they are marked Collected as soon as they are sold, with no deadline.',
                )}
              </p>
              <p className="muted">
                {w(
                  'Choose No material for services such as cap pressing, shirt pressing or binding with customer-supplied materials. These use quantity × price and do not deduct stock. Linked materials retain their Require Size setting.',
                )}
              </p>
              <button type="submit">
                <Icon name="save" /> {busy ? 'Saving...' : w('Save service')}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {product && (
        <Modal title="Add product" busy={busy} onClose={() => setProduct(false)}>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p className="muted">
            {w(
              'Creates the stock item and a matching shelf item in one step. Selling it takes it out of stock and marks it Collected.',
            )}
          </p>
          <form onSubmit={submitProduct}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Product name
                  <input name="name" maxLength={160} placeholder="e.g. Blue biro pen" required />
                </label>
                <label>
                  Unit
                  <select name="unit" defaultValue={units.includes('piece') ? 'piece' : units[0]}>
                    {units.map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Price (₦)
                  <CurrencyInput name="price" required />
                </label>
                <label>
                  Opening stock
                  <input name="stock" type="number" min="0" step="0.001" defaultValue="0" />
                </label>
                <label>
                  Minimum stock
                  <input name="minimumStock" type="number" min="0" step="0.001" defaultValue="0" />
                  <small>Shows a low-stock warning at or below this.</small>
                </label>
              </div>
              <button type="submit">
                <Icon name="save" /> {busy ? 'Saving...' : 'Save product'}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
    </>
  );
}
