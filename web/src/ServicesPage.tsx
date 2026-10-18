import DialogActions from './DialogActions';
import { useFeedbackMessage } from './Feedback';
import CurrencyInput from './CurrencyInput';
import ResponsiveTable from './ResponsiveTable';
import { AuditCells, AuditHeaders } from './AuditColumns';
import Icon from './Icon';
import { packList } from './pack-prices.mjs';
import { newVariantProductEvents } from './variants.mjs';
import PackPricesField, { packDraft, packPricesFrom, type PackDraft } from './PackPricesField';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { shortLabel } from './material-display.mjs';
import { SortHeader, useTableSort } from './TableSort';
import { emptyLedger, money } from './domain.mjs';
import { materialCode } from './material-display.mjs';
import { serviceCode, serviceMatches, servicePrice } from './services.mjs';
import { canonical, consumptionUnit, costRate, hasCost, suggestCostKey } from './pricing-templates.mjs';
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
  /** Open the product editor ('' to choose a product). */
  onEditProduct?: (serviceId: string) => void;
};
const timestamp = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
/** The material select's value for a choice of materials. */
const CHOICE = '__choice';

export default function ServicesPage({
  services,
  materials,
  ready,
  busy,
  actor,
  onSave,
  onSaveMany,
  onEditProduct,
}: Props) {
  const formId = useId();
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
  const [costed, setCosted] = useState(false);
  const [privateItem, setPrivateItem] = useState(false);
  const [costKey, setCostKey] = useState('');
  const [packs, setPacks] = useState<PackDraft>([]);
  // Material: '' = none, a material id = one fixed material, CHOICE = a choice of materials.
  const [materialValue, setMaterialValue] = useState('');
  const [choiceIds, setChoiceIds] = useState<string[]>([]);
  const [confirmStage, setConfirmStage] = useState('Printing');
  const { jobStages } = useBusinessOptions();
  const { stage } = useWords();
  const confirmStages = jobStages.filter((s) => s !== 'Collected');
  const defaultConfirmStage = confirmStages.includes('Printing')
    ? 'Printing'
    : (confirmStages[confirmStages.length - 2] ?? confirmStages[0] ?? 'Printing');
  // Add product: one stock item, or one per variant (colours, sizes…).
  const [withVariants, setWithVariants] = useState(false);
  const blankVariants = () => [
    { name: '', stock: '', minimum: '' },
    { name: '', stock: '', minimum: '' },
  ];
  const [variantRows, setVariantRows] = useState(blankVariants);
  /** Enough of the ledger to check new items before saving. */
  const ledgerFor = () => ({ ...emptyLedger(), services, materials });
  const [priceText, setPriceText] = useState('');
  const kobo = (text: string) => {
    try {
      return money(text || '0');
    } catch {
      return null;
    }
  };
  const openEditor = (target: Service | 'new') => {
    const s = target === 'new' ? null : target;
    setPacks(packDraft(s?.packPrices));
    setPriceText(s ? (s.price / 100).toFixed(2) : '');
    setCosted(!!s?.costing);
    setPrivateItem(!!s?.private);
    setCostKey(s?.costing?.key ?? '');
    setMaterialValue(s?.materialOptions?.length ? CHOICE : (s?.materialId ?? ''));
    setChoiceIds(s?.materialOptions ?? []);
    setConfirmStage(s?.confirmStage ?? defaultConfirmStage);
    setEditor(target);
  };
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
        item.materialOptions?.length
          ? 'Choice'
          : item.materialId === null
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
      const price = privateItem ? 0 : money(String(data.get('price')));
      const id = editing?.id ?? crypto.randomUUID();
      const costText = String(data.get('costAmount') ?? '').trim();
      // A formula name alone lets templates use the selling price; a cost is optional (needed when private).
      const costing =
        costed || privateItem
          ? {
              key: String(data.get('costKey') ?? '').trim(),
              ...(costText
                ? {
                    amount: money(costText),
                    per: Number(data.get('costPer') || 1),
                    ...(String(data.get('costUnit') ?? '').trim()
                      ? { unit: String(data.get('costUnit')).trim() }
                      : {}),
                  }
                : {}),
            }
          : null;
      await commit(editing ? 'service.updated' : 'service.created', {
        id,
        baseVersion: editing?.version,
        description: String(data.get('description')).trim(),
        materialId: materialValue === CHOICE ? null : materialValue || null,
        materialOptions: materialValue === CHOICE ? choiceIds : [],
        ...(materialValue === CHOICE ? { confirmStage } : {}),
        price,
        shelfItem: !privateItem && materialValue !== CHOICE && data.get('shelfItem') === 'on',
        private: privateItem,
        costing,
        packPrices: privateItem ? [] : packPricesFrom(packs),
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
      if (withVariants) {
        await onSaveMany(
          newVariantProductEvents(
            ledgerFor(),
            {
              name,
              unit: String(data.get('unit')).trim(),
              price,
              packPrices: packPricesFrom(packs),
              variants: variantRows,
            },
            actor,
          ),
        );
        setProduct(false);
        return;
      }
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
          data: {
            id: crypto.randomUUID(),
            description: name,
            materialId,
            price,
            shelfItem: true,
            packPrices: packPricesFrom(packs),
            ...audit,
          },
        },
      ]);
      setProduct(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the product.');
    }
  }
  return (
    <>
      <section className="stats catalogue-stats">
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
          <ToolbarActions
            more={
              <>
                <MenuToggle pressed={audit} icon="audit" onClick={() => setAudit(!audit)}>
                  Audit view
                </MenuToggle>
                {onEditProduct && (
                  <button className="secondary" disabled={!ready || busy} onClick={() => onEditProduct('')}>
                    <Icon name="edit" /> {w('Edit product')}
                  </button>
                )}
              </>
            }
          >
            <button
              className="secondary"
              disabled={!ready || busy}
              title="Creates the stock item and its shelf item together"
              onClick={() => {
                setPacks([]);
                setPriceText('');
                setWithVariants(false);
                setVariantRows(blankVariants());
                setProduct(true);
                setEditor(null);
                setConfirmation(null);
                setError('');
              }}
            >
              <Icon name="add" /> Add product
            </button>
            <button
              disabled={!ready || busy}
              onClick={() => {
                openEditor('new');
                setConfirmation(null);
                setError('');
              }}
            >
              <Icon name="add" /> {w('Add service')}
            </button>
          </ToolbarActions>
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
                { index: 0, label: w('Service'), details: [1, 3] },
                { index: 2, label: 'Price' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 1: w('Material') }}
              extraSortOptions={[{ key: 'id', label: w('Service ID') }]}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label={w('Service')} column="description" sort={sorting} />
                    <SortHeader label={w('Base material')} column="material" sort={sorting} />
                    <SortHeader label="Price" column="price" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    {audit && <AuditHeaders sort={sorting} />}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((service) => {
                    const material = materials.find((item) => item.id === service.materialId);
                    return (
                      <tr key={service.id}>
                        <td>
                          <strong>{service.description}</strong>
                          <small className="record-id">{serviceCode(service.id, services)}</small>
                          {service.shelfItem && (
                            <small>
                              <span className="badge paid">Shelf</span> Collected when sold
                            </small>
                          )}
                          {service.private && (
                            <small>
                              <span className="badge partial">Private</span> Used in templates only
                            </small>
                          )}
                          {service.packPrices?.length ? (
                            <small>Packs: {packList(service.packPrices)}</small>
                          ) : null}
                          {service.costing && (
                            <small>
                              In templates as <code>{service.costing.key}</code>
                              {hasCost(service.costing) ? (
                                <>
                                  : cost {servicePrice(service.costing.amount!)} for {service.costing.per}{' '}
                                  {consumptionUnit(service, materials)} (₦
                                  {canonical(costRate(service.costing))} each)
                                </>
                              ) : null}
                              {!service.private && (
                                <>
                                  {' '}
                                  · selling price as <code>{service.costing.key}_price</code>
                                </>
                              )}
                            </small>
                          )}
                        </td>
                        <td>
                          {service.materialOptions?.length
                            ? `${w('Choice')}: ${service.materialOptions
                                .map((id) => shortLabel(materials.find((m) => m.id === id)?.name ?? '?'))
                                .join(', ')}`
                            : service.materialId === null
                              ? w('No material')
                              : (material?.name ?? w('Material unavailable'))}
                          <small>
                            {material ? materialCode(material.id, materials) : ''}
                            {material?.archived ? w(' · Archived material') : ''}
                          </small>
                        </td>
                        <td className="cell-fit">{servicePrice(service.price)}</td>
                        <td className="cell-fit">
                          <span className={`badge ${service.archived ? 'unpaid' : 'paid'}`}>
                            {service.archived ? 'Archived' : 'Active'}
                          </span>
                        </td>
                        {audit && <AuditCells record={service} format={timestamp} />}
                        <td>
                          <div className="material-actions">
                            {!service.archived && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => {
                                  openEditor(service);
                                  setConfirmation(null);
                                  setError('');
                                }}
                              >
                                <Icon name="edit" /> Edit
                              </button>
                            )}
                            {!service.archived && service.materialId && onEditProduct && (
                              <button
                                className="text-button"
                                disabled={busy}
                                title="Name, price and stock together"
                                onClick={() => onEditProduct(service.id)}
                              >
                                <Icon name="quantity" /> Price & stock
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
          footer={
            <DialogActions form={formId} busy={busy} onCancel={() => setEditor(null)}>
              {w('Save service')}
            </DialogActions>
          }
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
          <form id={formId} key={editing ? editing.id + ':' + editing.version : 'new'} onSubmit={submit}>
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
                  <select
                    name="material"
                    value={materialValue}
                    onChange={(e) => setMaterialValue(e.target.value)}
                  >
                    <option value="">{w('No material — service only')}</option>
                    {!privateItem && <option value={CHOICE}>{w('A choice of materials…')}</option>}
                    {options.map((item) => (
                      <option key={item.id} value={item.id} title={item.name}>
                        {shortLabel(item.name)} ({materialCode(item.id, materials)})
                        {item.archived ? ' · Archived' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {!privateItem && (
                  <label>
                    Price (₦)
                    <CurrencyInput
                      name="price"
                      defaultValue={editing ? (editing.price / 100).toFixed(2) : ''}
                      onValueChange={setPriceText}
                      required
                    />
                  </label>
                )}
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={privateItem}
                  onChange={(e) => {
                    setPrivateItem(e.target.checked);
                    if (e.target.checked) setCosted(true);
                  }}
                />
                Private: used in pricing templates only, never sold
              </label>
              {materialValue === CHOICE && !privateItem && (
                <fieldset className="material-choice">
                  <legend>{w('Materials that can do this job')}</legend>
                  <p className="muted">
                    {w(
                      'Tick 2 to 10 materials with the same unit, for example 2 ft, 5 ft and 10 ft rolls. The price stays the same whichever is used. No stock is taken at the sale; staff confirm what was really used, and how much, when the job leaves the stage below.',
                    )}
                  </p>
                  <div className="material-choice-list">
                    {materials
                      .filter((m) => !m.archived || choiceIds.includes(m.id))
                      .map((m) => (
                        <label className="checkbox" key={m.id}>
                          <input
                            type="checkbox"
                            checked={choiceIds.includes(m.id)}
                            onChange={(e) =>
                              setChoiceIds((ids) =>
                                e.target.checked ? [...ids, m.id] : ids.filter((x) => x !== m.id),
                              )
                            }
                          />
                          {shortLabel(m.name)}
                          <small>
                            {m.measurementUnit}
                            {m.requireSize ? ' · by size' : ''}
                            {m.archived ? ' · Archived' : ''}
                          </small>
                        </label>
                      ))}
                  </div>
                  <label>
                    {w('Confirm material used when the job leaves')}
                    <select value={confirmStage} onChange={(e) => setConfirmStage(e.target.value)}>
                      {[...new Set([...confirmStages, confirmStage])].map((s) => (
                        <option key={s} value={s}>
                          {stage(s)}
                        </option>
                      ))}
                    </select>
                    <small>
                      {w(
                        'Moving a job past this stage, or straight to Completed, asks which material was used and how much.',
                      )}
                    </small>
                  </label>
                </fieldset>
              )}
              {!privateItem && materialValue !== CHOICE && (
                <label className="checkbox">
                  <input type="checkbox" name="shelfItem" defaultChecked={editing?.shelfItem ?? false} />
                  Sold off the shelf
                </label>
              )}
              {!privateItem && (
                <PackPricesField value={packs} onChange={setPacks} unitPrice={kobo(priceText)} />
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={costed || privateItem}
                  disabled={privateItem}
                  onChange={(e) => setCosted(e.target.checked)}
                />
                Use in pricing templates (gives it a formula name)
              </label>
              {(costed || privateItem) && (
                <div className="form-grid hint-grid">
                  <label>
                    Formula name
                    <input
                      name="costKey"
                      required
                      value={costKey}
                      spellCheck={false}
                      onChange={(e) => setCostKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                      onFocus={(e) => {
                        if (!costKey) {
                          const form = e.currentTarget.form;
                          const name = String(new FormData(form!).get('description') ?? '');
                          setCostKey(suggestCostKey(name, services, editing?.id));
                        }
                      }}
                    />
                    <small>
                      Lowercase letters, numbers and _. Renaming it breaks formulas that use the old name.
                    </small>
                  </label>
                  <label>
                    {privateItem ? 'Cost (₦)' : 'Cost (₦, optional)'}
                    <CurrencyInput
                      name="costAmount"
                      defaultValue={
                        hasCost(editing?.costing) ? (editing!.costing!.amount! / 100).toFixed(2) : ''
                      }
                      required={privateItem}
                    />
                    <small>
                      In formulas, <code>{costKey || 'name'}</code> is the cost
                      {privateItem ? (
                        ''
                      ) : (
                        <>
                          {' '}
                          and <code>{(costKey || 'name') + '_price'}</code> the selling price. Leave the cost
                          empty to use only the selling price
                        </>
                      )}
                      .
                    </small>
                  </label>
                  <label>
                    For how many units
                    <input
                      name="costPer"
                      type="number"
                      min="0.001"
                      step="0.001"
                      defaultValue={editing?.costing?.per ?? 1}
                    />
                    <small>
                      Units are the {w('material')}'s unit, or items. e.g. ₦5,000 for 500 sheets: enter 500.
                    </small>
                  </label>
                  <label>
                    Bought as (optional)
                    <input
                      name="costUnit"
                      maxLength={40}
                      defaultValue={editing?.costing?.unit ?? ''}
                      placeholder="e.g. ream"
                    />
                  </label>
                </div>
              )}
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
              <div className="form-grid hint-grid">
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
                  <CurrencyInput name="price" required onValueChange={setPriceText} />
                </label>
                {!withVariants && (
                  <>
                    <label>
                      Opening stock
                      <input name="stock" type="number" min="0" step="0.001" defaultValue="0" />
                    </label>
                    <label>
                      Minimum stock
                      <input name="minimumStock" type="number" min="0" step="0.001" defaultValue="0" />
                      <small>Shows a low-stock warning at or below this.</small>
                    </label>
                  </>
                )}
              </div>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={withVariants}
                  onChange={(e) => setWithVariants(e.target.checked)}
                />
                Comes in variants (colours, sizes…)
              </label>
              {withVariants && (
                <fieldset className="variant-rows">
                  <legend>Variants</legend>
                  <p className="muted">
                    Each variant keeps its own stock. They share the price and pack prices, and each is priced
                    on its own: pieces of different variants never make up a pack.
                  </p>
                  {variantRows.map((row, index) => (
                    <div className="variant-row" key={index}>
                      <label>
                        Variant
                        <input
                          aria-label={`Variant ${index + 1} name`}
                          maxLength={60}
                          placeholder={['e.g. Pink', 'e.g. Blue', 'e.g. White'][index] ?? 'Name'}
                          value={row.name}
                          onChange={(e) =>
                            setVariantRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                            )
                          }
                        />
                      </label>
                      <label>
                        Opening stock
                        <input
                          aria-label={`Variant ${index + 1} opening stock`}
                          type="number"
                          min="0"
                          step="0.001"
                          value={row.stock}
                          onChange={(e) =>
                            setVariantRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, stock: e.target.value } : r)),
                            )
                          }
                        />
                      </label>
                      <label>
                        Minimum stock
                        <input
                          aria-label={`Variant ${index + 1} minimum stock`}
                          type="number"
                          min="0"
                          step="0.001"
                          value={row.minimum}
                          onChange={(e) =>
                            setVariantRows((rows) =>
                              rows.map((r, i) => (i === index ? { ...r, minimum: e.target.value } : r)),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        aria-label={`Remove variant ${index + 1}`}
                        disabled={variantRows.length <= 2}
                        onClick={() => setVariantRows((rows) => rows.filter((_, i) => i !== index))}
                      >
                        <Icon name="close" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setVariantRows((rows) => [...rows, { name: '', stock: '', minimum: '' }])}
                  >
                    <Icon name="add" /> Add variant
                  </button>
                </fieldset>
              )}
              <PackPricesField value={packs} onChange={setPacks} unitPrice={kobo(priceText)} />
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
