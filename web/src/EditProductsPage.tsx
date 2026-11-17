import ItemIcon from './ItemIcon';
import ItemLookDialog from './ItemLookDialog';
import { useMemo, useState } from 'react';
import Icon from './Icon';
import ResponsiveTable from './ResponsiveTable';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { editableProducts } from './product-edit.mjs';
import { variantGroups } from './variants.mjs';
import AddProduct from './AddProduct';
import SplitStock from './SplitStock';
import StockAdjustDialog from './StockAdjustDialog';
import ReorderList from './ReorderList';
import { reorderList } from './reorder.mjs';
import type {
  ExpenseEvent,
  Ledger,
  Material,
  MaterialEvent,
  ServiceEvent,
  FieldEvent,
  Service,
} from './types';

/**
 * Products: every product and service with its stock. Edit changes name, price and minimum stock;
 * stock changes through the row actions (Add stock, Set quantity, Split), as on Stock items.
 */
export default function EditProductsPage({
  ledger,
  ready,
  busy,
  onEdit,
  actor,
  onSaveMany,
  onSaveStock,
  businessName = '',
  canRecordPurchase = false,
  onSaveExpense,
}: {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  onEdit: (serviceId: string) => void;
  actor?: { id: string; label: string };
  /** Add product here too (so a shop without Services can add them). */
  onSaveMany?: (events: (MaterialEvent | ServiceEvent | FieldEvent)[]) => Promise<void>;
  /** Stock changes (left out for people who may not change stock). */
  onSaveStock?: (event: MaterialEvent) => Promise<void>;
  /** The reorder list (as on Stock items): send it to a supplier, record the purchase. */
  businessName?: string;
  canRecordPurchase?: boolean;
  onSaveExpense?: (event: ExpenseEvent) => Promise<void>;
}) {
  const [reorder, setReorder] = useState(false);
  const toReorder = useMemo(() => reorderList(ledger).length, [ledger]);
  const [stock, setStock] = useState<{ material: Material; mode: 'add' | 'set' } | null>(null);
  const [splitting, setSplitting] = useState<Material | null>(null);
  const [look, setLook] = useState<Service | null>(null);
  const live = (m: Material) => ledger.materials.find((x) => x.id === m.id) ?? m;
  const { w } = useWords();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [stockOnly, setStockOnly] = useState(true);
  const products = useMemo(() => editableProducts(ledger), [ledger]);
  // Stock across all variants of a product, e.g. "1,000 piece in all: Blue 600 · Pink 400".
  const groups = useMemo(() => new Map(variantGroups(ledger).map((g) => [g.id, g])), [ledger]);
  const groupLine = (id: string) => {
    const g = groups.get(id);
    if (!g) return '';
    const total = g.members.reduce((n, m) => n + (m.material?.available ?? 0), 0);
    const unit = g.members[0].material?.measurementUnit ?? '';
    return `${g.name}: ${Math.round(total * 1000) / 1000} ${unit} in all (${g.members
      .map((m) => `${m.service.variantName} ${m.material?.available ?? 0}`)
      .join(' · ')})`;
  };
  const shown = products.filter(
    (p) =>
      (!stockOnly || p.material) &&
      `${p.service.description} ${p.material?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="toolbar">
        <input
          aria-label={w('Search products')}
          placeholder={w('Search products and stock items')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check-label">
          <input type="checkbox" checked={stockOnly} onChange={(e) => setStockOnly(e.target.checked)} />
          {w('Only items with stock')}
        </label>
        {actor && (
          <button type="button" className="secondary" disabled={!ready} onClick={() => setReorder(true)}>
            <Icon name="materials" /> Reorder list{toReorder ? ` (${toReorder})` : ''}
          </button>
        )}
        {onSaveMany && actor && (
          <button type="button" disabled={!ready || busy} onClick={() => setAdding(true)}>
            <Icon name="add" /> {w('Add product')}
          </button>
        )}
      </div>
      {adding && onSaveMany && actor && (
        <AddProduct
          services={ledger.services}
          materials={ledger.materials}
          busy={busy}
          actor={actor}
          onSaveMany={onSaveMany}
          onClose={() => setAdding(false)}
        />
      )}
      {!ready ? (
        <p className="empty">Loading…</p>
      ) : !shown.length ? (
        <div className="empty">
          <h2>{query ? w('No matching products') : w('No products yet')}</h2>
          <p>{w('Tap Add product to add one. Each keeps its own stock.')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <ResponsiveTable
            columns={[
              { index: 0, label: w('Product'), details: [1] },
              { index: 2, label: 'Price' },
              { index: -1, label: 'Actions', actions: true },
            ]}
            labels={{ 1: 'In stock' }}
          >
            <table aria-label={w('Products')}>
              <thead>
                <tr>
                  <th>{w('Product')}</th>
                  <th className="numeric">In stock</th>
                  <th className="numeric">Price</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ service, material, sharedWith }) => {
                  const low =
                    material &&
                    material.available <= (material.minimumHere ?? material.minimumStock ?? 0) &&
                    (material.minimumHere ?? material.minimumStock ?? 0) > 0;
                  return (
                    <tr key={service.id}>
                      <td>
                        <strong className="product-name-with-icon">
                          <ItemIcon name={service.icon} />
                          {service.description}
                        </strong>
                        <small>
                          {service.category ? `${service.category} · ` : ''}
                          {service.variantGroup
                            ? groupLine(service.variantGroup)
                            : material
                              ? material.name === service.description
                                ? w('Own stock item')
                                : `${w('Stock item')}: ${material.name}`
                              : w('No stock item')}
                          {sharedWith.length ? ` · shared with ${sharedWith.length}` : ''}
                          {service.private ? ' · Private' : ''}
                        </small>
                      </td>
                      <td className="numeric">
                        {material ? (
                          <>
                            {material.available} {material.measurementUnit}
                            {low && <small className="danger-text">Low stock</small>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="numeric">{service.private ? '—' : currency(service.price)}</td>
                      <td>
                        <div className="material-actions">
                          <button className="text-button" disabled={busy} onClick={() => onEdit(service.id)}>
                            <Icon name="edit" /> Edit
                          </button>
                          {onSaveMany && actor && (
                            <button className="text-button" disabled={busy} onClick={() => setLook(service)}>
                              <Icon name="edit" /> Icon, code & tags
                            </button>
                          )}
                          {material && onSaveStock && actor && (
                            <>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => setStock({ material, mode: 'add' })}
                              >
                                <Icon name="add" /> Add stock
                              </button>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => setStock({ material, mode: 'set' })}
                              >
                                <Icon name="quantity" /> Set quantity
                              </button>
                              {material.canSplit && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setSplitting(material)}
                                >
                                  <Icon name="copy" /> Split
                                </button>
                              )}
                            </>
                          )}
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
      {stock && onSaveStock && actor && (
        <StockAdjustDialog
          key={stock.material.id + stock.mode}
          material={live(stock.material)}
          mode={stock.mode}
          history={ledger.materialHistory}
          busy={busy}
          actor={actor}
          onSave={onSaveStock}
          onClose={() => setStock(null)}
        />
      )}
      {reorder && actor && (
        <ReorderList
          ledger={ledger}
          businessName={businessName}
          actor={actor}
          busy={busy}
          canRecordPurchase={canRecordPurchase && !!onSaveExpense}
          onSaveExpense={async (event) => {
            await onSaveExpense!(event);
          }}
          onClose={() => setReorder(false)}
        />
      )}
      {look && onSaveMany && actor && (
        <ItemLookDialog
          key={look.id}
          service={ledger.services.find((x) => x.id === look.id) ?? look}
          services={ledger.services}
          actor={actor}
          busy={busy}
          onSave={onSaveMany}
          onClose={() => setLook(null)}
        />
      )}
      {splitting && onSaveStock && actor && (
        <SplitStock
          material={live(splitting)}
          materials={ledger.materials}
          busy={busy}
          actor={actor}
          onSave={onSaveStock}
          onClose={() => setSplitting(null)}
        />
      )}
    </section>
  );
}
