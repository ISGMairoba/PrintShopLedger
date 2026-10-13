import { useMemo, useState } from 'react';
import Icon from './Icon';
import ResponsiveTable from './ResponsiveTable';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { editableProducts } from './product-edit.mjs';
import type { Ledger } from './types';

/** Every product and service, with its stock: pick one to change its name, price and stock together. */
export default function EditProductsPage({
  ledger,
  ready,
  busy,
  onEdit,
}: {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  onEdit: (serviceId: string) => void;
}) {
  const { w } = useWords();
  const [query, setQuery] = useState('');
  const [stockOnly, setStockOnly] = useState(true);
  const products = useMemo(() => editableProducts(ledger), [ledger]);
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
      </div>
      {!ready ? (
        <p className="empty">Loading…</p>
      ) : !shown.length ? (
        <div className="empty">
          <h2>{query ? w('No matching products') : w('No products yet')}</h2>
          <p>{w('Add products on the Services page. They appear here for quick changes.')}</p>
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
                    material.available <= (material.minimumStock ?? 0) &&
                    (material.minimumStock ?? 0) > 0;
                  return (
                    <tr key={service.id}>
                      <td>
                        <strong>{service.description}</strong>
                        <small>
                          {material
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
                        <button className="text-button" disabled={busy} onClick={() => onEdit(service.id)}>
                          <Icon name="edit" /> Edit
                        </button>
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
  );
}
