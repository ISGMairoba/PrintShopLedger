import {
  TemplateInputs,
  TemplateEstimate,
  TemplateSummary,
  tryTemplate,
  type TemplateStart,
} from './TemplateFields';
import { serviceMaterial } from './material-choice.mjs';
import { templateDefaults } from './pricing-templates.mjs';
import type { TemplateSnapshot } from './types';
import { lineWithDescription } from './job-batches.mjs';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ToolbarActions from './ToolbarActions';
import ResponsiveTable from './ResponsiveTable';
import ListedCombobox from './ListedCombobox';
import { SortHeader, useTableSort } from './TableSort';
import { useFeedback, useFeedbackMessage } from './Feedback';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { units } from './checkout.mjs';
import {
  defaultValidUntil,
  prepareQuotation,
  priceQuotation,
  quotationRef,
  quotationState,
  stateLabels,
} from './quotations.mjs';
import {
  DiscountFields,
  discountDraft,
  discountSpec,
  noDiscount,
  type DiscountDraft,
} from './CheckoutEditor';
import type { Branding } from './useBusinessBranding';
import type { Ledger, Quotation, QuotationEvent } from './types';
import { quotationMessage } from './share.mjs';

type Props = {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  branding: Branding;
  discountPolicy: { maxPercent: number; canFlat: boolean };
  onSave: (event: QuotationEvent) => Promise<void>;
  onCreateOrder: (quote: Quotation) => void;
  /** Open a new quotation with one template line (from the Pricing Templates page). */
  start?: TemplateStart | null;
};
type Line = {
  templateInputs?: Record<string, number | string>;
  templateSnapshot?: TemplateSnapshot;
  id: string;
  serviceId: string;
  description: string;
  quantity: string;
  width: string;
  height: string;
  discountDraft: DiscountDraft;
};
const newLine = (): Line => ({
  id: crypto.randomUUID(),
  serviceId: '',
  description: '',
  quantity: '1',
  width: '',
  height: '',
  discountDraft: noDiscount(),
});
const date = (value: string) =>
  new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const badge = { open: 'paid', expired: 'unpaid', converted: 'partial', archived: 'unpaid' } as const;
const customerLabel = (c: { name: string; phone: string }) => (c.phone ? `${c.name} — ${c.phone}` : c.name);

export default function QuotationsPage({
  ledger,
  ready,
  busy,
  actor,
  branding,
  discountPolicy,
  onSave,
  onCreateOrder,
  start = null,
}: Props) {
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./receipt-pdf');
    void import('./share-pdf');
  }, []);
  const { w } = useWords();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('current');
  const [editor, setEditor] = useState<Quotation | 'new' | null>(start ? 'new' : null);
  // The template line is only for the first new quotation opened from Pricing Templates.
  const [pendingStart, setPendingStart] = useState(start);
  const [viewing, setViewing] = useState<Quotation | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const notify = useFeedback();
  const sorting = useTableSort<Quotation>('date', 'desc');
  const quotes = ledger.quotations ?? [];
  const visible = sorting.sortRows(
    quotes.filter((q) => {
      const state = quotationState(q);
      if (filter === 'current' && !['open', 'expired'].includes(state)) return false;
      if (['converted', 'archived'].includes(filter) && state !== filter) return false;
      const text = `${quotationRef(q.id)} ${q.customerName} ${q.customerPhone} ${q.note} ${q.lines
        .map((l) => `${l.description} ${l.service}`)
        .join(' ')}`.toLowerCase();
      return text.includes(query.trim().toLowerCase());
    }),
    {
      ref: (q) => quotationRef(q.id),
      customer: (q) => q.customerName,
      date: (q) => Date.parse(q.modifiedAt),
      validUntil: (q) => q.validUntil,
      total: (q) => q.total,
      status: (q) => stateLabels[quotationState(q)],
    },
  );
  const open = quotes.filter((q) => quotationState(q) === 'open');
  async function pdf(quote: Quotation, size: 'a4' | 'roll', action: 'download' | 'open') {
    setError('');
    try {
      const { downloadQuotationPdf, openQuotationPdf } = await import('./receipt-pdf');
      (action === 'open' ? openQuotationPdf : downloadQuotationPdf)(quote, branding, size);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the PDF.');
    }
  }
  async function share(quote: Quotation) {
    setError('');
    try {
      const [{ createQuotationPdf }, { sharePdf, shareResult }] = await Promise.all([
        import('./receipt-pdf'),
        import('./share-pdf'),
      ]);
      const ref = quotationRef(quote.id);
      const result = await sharePdf(createQuotationPdf(quote, branding, 'a4'), `Quotation-${ref}`, {
        title: `Quotation ${ref}`,
        text: quotationMessage(quote, ref, branding.businessName, date(quote.validUntil)),
        phone: quote.customerPhone,
      });
      const note = shareResult(result);
      if (note) notify(note, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share the quotation.');
    }
  }
  async function setStatus(quote: Quotation, kind: 'quotation.archived' | 'quotation.restored') {
    setError('');
    try {
      await onSave({
        id: crypto.randomUUID(),
        kind,
        data: {
          id: quote.id,
          baseVersion: quote.version,
          modifiedBy: actor.id,
          modifiedByLabel: actor.label,
          modifiedAt: new Date().toISOString(),
        },
      });
      setViewing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the quotation.');
    }
  }
  const current = viewing ? (quotes.find((q) => q.id === viewing.id) ?? viewing) : null;
  return (
    <>
      <section className="stats">
        <article>
          <span>Open quotations</span>
          <strong>{open.length}</strong>
          <small>Worth {currency(open.reduce((n, q) => n + q.total, 0))}</small>
        </article>
        <article>
          <span>Expired</span>
          <strong>{quotes.filter((q) => quotationState(q) === 'expired').length}</strong>
          <small>Past their valid-until date</small>
        </article>
        <article>
          <span>Converted</span>
          <strong>{quotes.filter((q) => q.status === 'converted').length}</strong>
          <small>{w('Turned into jobs')}</small>
        </article>
      </section>
      {error && !editor && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search quotations"
            placeholder="Search number, customer or item"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Quotation status" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="current">Open and expired</option>
            <option value="converted">Converted</option>
            <option value="archived">Archived</option>
            <option value="all">All quotations</option>
          </select>
          <ToolbarActions>
            <button disabled={!ready || busy} onClick={() => setEditor('new')}>
              <Icon name="add" /> New quotation
            </button>
          </ToolbarActions>
        </div>
        {!ready ? (
          <div className="empty">Loading quotations.</div>
        ) : !visible.length ? (
          <div className="empty">
            <h2>{query ? 'No matching quotations' : 'No quotations here yet'}</h2>
            <p>
              {w(
                'Price work for a customer, send them the quotation, then turn it into a job when they accept.',
              )}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: 'Quotation', details: [1, 2] },
                { index: 3, label: 'Total' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 1: 'Date', 2: 'Valid until' }}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Quotation" column="customer" sort={sorting} />
                    <SortHeader label="Date" column="date" sort={sorting} />
                    <SortHeader label="Valid until" column="validUntil" sort={sorting} />
                    <SortHeader label="Total" column="total" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((q) => {
                    const state = quotationState(q);
                    return (
                      <tr key={q.id}>
                        <td>
                          <button className="text-button job-service" onClick={() => setViewing(q)}>
                            {q.customerName}
                          </button>
                          <small>
                            {quotationRef(q.id)} · {q.lines.length}{' '}
                            {q.lines.length === 1 ? w('item') : w('items')}
                          </small>
                        </td>
                        <td>
                          {date(q.modifiedAt)}
                          <small>{q.modifiedByLabel}</small>
                        </td>
                        <td>{date(q.validUntil)}</td>
                        <td>
                          <strong>{currency(q.total)}</strong>
                          {q.discountTotal > 0 && <small>After {currency(q.discountTotal)} discount</small>}
                        </td>
                        <td>
                          <span className={`badge ${badge[state]}`}>{stateLabels[state]}</span>
                        </td>
                        <td>
                          <div className="material-actions">
                            <button className="text-button" onClick={() => setViewing(q)}>
                              <Icon name="details" /> View
                            </button>
                            {['open', 'expired'].includes(state) && (
                              <>
                                <button className="text-button" disabled={busy} onClick={() => setEditor(q)}>
                                  <Icon name="edit" /> Edit
                                </button>
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => onCreateOrder(q)}
                                >
                                  <Icon name="next" /> {w('Create job')}
                                </button>
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
      </section>
      {current && (
        <Modal title={`Quotation ${quotationRef(current.id)}`} busy={busy} onClose={() => setViewing(null)}>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <QuotationSummary quote={current} />
          <div className="material-actions">
            {['open', 'expired'].includes(quotationState(current)) && (
              <>
                <button
                  disabled={busy}
                  onClick={() => {
                    setViewing(null);
                    onCreateOrder(current);
                  }}
                >
                  <Icon name="next" /> {w('Create job')}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setViewing(null);
                    setEditor(current);
                  }}
                >
                  <Icon name="edit" /> Edit
                </button>
              </>
            )}
            <button className="secondary" onClick={() => void share(current)}>
              <Icon name="share" /> Share
            </button>
            <button className="secondary" onClick={() => void pdf(current, 'a4', 'download')}>
              Download PDF (A4)
            </button>
            <button className="secondary" onClick={() => void pdf(current, 'roll', 'download')}>
              Download PDF (80 mm)
            </button>
            <button className="secondary" onClick={() => void pdf(current, 'a4', 'open')}>
              <Icon name="services" /> Print
            </button>
            {current.status === 'open' && (
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => void setStatus(current, 'quotation.archived')}
              >
                <Icon name="archive" /> Archive
              </button>
            )}
            {current.status === 'archived' && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void setStatus(current, 'quotation.restored')}
              >
                <Icon name="restore" /> Restore
              </button>
            )}
          </div>
        </Modal>
      )}
      {editor && (
        <QuotationEditor
          descriptionMode={branding.jobs.descriptionMode}
          ledger={ledger}
          quote={editor === 'new' ? null : editor}
          start={editor === 'new' ? pendingStart : null}
          busy={busy}
          actor={actor}
          discountPolicy={discountPolicy}
          onClose={() => {
            setEditor(null);
            setPendingStart(null);
          }}
          onSave={async (event) => {
            await onSave(event);
            setEditor(null);
            setPendingStart(null);
            setViewing(null);
          }}
        />
      )}
    </>
  );
}

function QuotationSummary({ quote }: { quote: Quotation }) {
  const { w } = useWords();
  const state = quotationState(quote);
  return (
    <>
      <p>
        <strong>{quote.customerName}</strong>
        {quote.customerPhone && ` · ${quote.customerPhone}`}
        <br />
        <small>
          Valid until {date(quote.validUntil)} ·{' '}
          <span className={`badge ${badge[state]}`}>{stateLabels[state]}</span>
          {quote.status === 'converted' &&
            ` · ${w('Turned into a job')} ${quote.convertedAt ? date(quote.convertedAt) : ''}${quote.convertedByLabel ? ` by ${quote.convertedByLabel}` : ''}`}
        </small>
      </p>
      <div className="table-wrap">
        <table aria-label="Quotation items">
          <thead>
            <tr>
              <th>{w('Item')}</th>
              <th className="numeric">Qty</th>
              <th className="numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.description}
                  <small>
                    {l.service} · {currency(l.unitPrice)} each
                    {l.requireSize && l.width && l.height ? ` · ${l.width} × ${l.height}` : ''}
                    {l.discountAmount > 0 ? ` · Discount -${currency(l.discountAmount)}` : ''}
                  </small>
                  {l.templateSnapshot && (
                    <TemplateSummary snapshot={l.templateSnapshot} quantity={l.quantity} amount={l.amount} />
                  )}
                </td>
                <td className="numeric">{l.quantity}</td>
                <td className="numeric">{currency(l.amount)}</td>
              </tr>
            ))}
            {quote.discountTotal > 0 && (
              <tr>
                <td colSpan={2}>Subtotal · Discount</td>
                <td className="numeric">
                  {currency(quote.subtotal)} · -{currency(quote.discountTotal)}
                </td>
              </tr>
            )}
            <tr className="report-total">
              <td colSpan={2}>Total</td>
              <td className="numeric">{currency(quote.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {quote.note && <p className="muted">Note: {quote.note}</p>}
    </>
  );
}

function QuotationEditor({
  ledger,
  descriptionMode,
  quote,
  busy,
  actor,
  discountPolicy,
  onClose,
  onSave,
  start,
}: {
  ledger: Ledger;
  descriptionMode: string;
  quote: Quotation | null;
  start: TemplateStart | null;
  busy: boolean;
  actor: { id: string; label: string };
  discountPolicy: { maxPercent: number; canFlat: boolean };
  onClose: () => void;
  onSave: (event: QuotationEvent) => Promise<void>;
}) {
  const { w } = useWords();
  const customers = ledger.customers.filter((c) => !c.archived);
  const [customerText, setCustomerText] = useState(() => {
    const saved = quote?.customerId ? customers.find((c) => c.id === quote.customerId) : null;
    return saved ? customerLabel(saved) : (quote?.customerName ?? '');
  });
  const [phone, setPhone] = useState(quote?.customerPhone ?? '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? defaultValidUntil());
  const [note, setNote] = useState(quote?.note ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    quote
      ? quote.lines.map((l) => ({
          id: l.id,
          serviceId: l.serviceId,
          templateInputs: l.templateInputs,
          templateSnapshot: l.templateSnapshot,
          description: l.description,
          quantity: String(l.quantity),
          width: l.width == null ? '' : String(l.width),
          height: l.height == null ? '' : String(l.height),
          discountDraft: discountDraft(l.discount),
        }))
      : start
        ? [
            {
              ...newLine(),
              serviceId: start.templateId,
              templateInputs: start.inputs,
              description: ledger.pricing?.templates.find((t) => t.id === start.templateId)?.name ?? '',
              quantity: start.quantity,
            },
          ]
        : [newLine()],
  );
  const [orderDiscount, setOrderDiscount] = useState<DiscountDraft>(() =>
    discountDraft(quote?.orderDiscount),
  );
  const [error, setError] = useFeedbackMessage('error');
  const savedCustomer = customers.find((c) => customerLabel(c) === customerText) ?? null;
  const services = ledger.services.filter(
    (s) =>
      !s.archived &&
      !s.private &&
      (s.materialId === null || ledger.materials.some((m) => m.id === s.materialId && !m.archived)),
  );
  const input = () => ({
    lines: lines.map(({ discountDraft: draft, ...l }) => {
      const discount = discountSpec(draft);
      return lineWithDescription(
        { ...l, ...(discount ? { discount } : {}) },
        [
          ...ledger.services,
          ...(ledger.pricing?.templates ?? []).map((t) => ({ id: t.id, description: t.name })),
        ],
        descriptionMode,
      );
    }),
    orderDiscount: discountSpec(orderDiscount),
  });
  const priced = useMemo(() => {
    try {
      const { lines: ls, orderDiscount: od } = input();
      return { ok: priceQuotation(ledger, ls, od, discountPolicy), error: '' };
    } catch (cause) {
      return { ok: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, orderDiscount, ledger, discountPolicy, descriptionMode]);
  const edit = (id: string, change: Partial<Line>) =>
    setLines((items) => items.map((l) => (l.id === id ? { ...l, ...change } : l)));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError('');
    try {
      for (const l of lines) units(l.quantity);
      const event = prepareQuotation(
        ledger,
        {
          id: quote?.id,
          baseVersion: quote?.version,
          customerId: savedCustomer?.id ?? null,
          customerName: savedCustomer ? savedCustomer.name : customerText,
          customerPhone: savedCustomer ? savedCustomer.phone : phone,
          validUntil,
          note,
          ...input(),
        },
        actor,
        discountPolicy,
      );
      await onSave(event as QuotationEvent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the quotation.');
    }
  }
  return (
    <Modal
      title={quote ? `Edit quotation ${quotationRef(quote.id)}` : 'New quotation'}
      busy={busy}
      onClose={onClose}
      className="checkout-modal"
    >
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <ListedCombobox
              label="Customer"
              emptyText="No saved customer matches. The name you typed will be used."
              name="customer"
              options={customers.map(customerLabel)}
              value={customerText}
              onChange={setCustomerText}
            />
            <label>
              Phone
              <input
                maxLength={40}
                value={savedCustomer ? savedCustomer.phone : phone}
                disabled={!!savedCustomer}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
              <small>
                {savedCustomer ? 'Saved customer' : 'Type any name; they need not be a saved customer.'}
              </small>
            </label>
            <label>
              Valid until
              <input
                type="date"
                required
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </label>
          </div>
          <h3>{w('Items')}</h3>
          {lines.map((item, index) => {
            const template = ledger.pricing?.templates.find((t) => t.id === item.serviceId);
            const service = ledger.services.find((s) => s.id === item.serviceId);
            const material = serviceMaterial(ledger, service);
            const line = priced.ok?.lines[index];
            const templateCheck = template
              ? tryTemplate(ledger, template, item.templateInputs ?? {}, item.quantity)
              : null;
            const quantityVariable = template?.variables.find((v) => v.key === 'quantity');
            return (
              <section className="cart-line" key={item.id}>
                <div className="cart-line-title">
                  <strong>
                    {w('Item')} {index + 1}
                  </strong>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() => setLines((v) => v.filter((l) => l.id !== item.id))}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="form-grid">
                  <label>
                    {w('Service')}
                    <select
                      aria-label={w('Service')}
                      required
                      value={item.serviceId}
                      onChange={(e) => {
                        const picked = ledger.services.find((s) => s.id === e.target.value);
                        const t = ledger.pricing?.templates.find((t) => t.id === e.target.value);
                        edit(item.id, {
                          serviceId: e.target.value,
                          templateSnapshot: undefined,
                          templateInputs: t ? templateDefaults(t) : undefined,
                          ...(t
                            ? {
                                description: t.name,
                                quantity: String(t.variables.find((v) => v.key === 'quantity')?.default ?? 1),
                              }
                            : {}),
                          ...(!item.description.trim() && picked
                            ? { description: picked.description.slice(0, 500) }
                            : {}),
                        });
                      }}
                    >
                      <option value="">{w('Select service')}</option>
                      {ledger.pricing?.enabled && (
                        <optgroup label="Pricing templates">
                          {ledger.pricing.templates
                            .filter((t) => !t.archived)
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} — Template
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.description} — {currency(s.price)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {descriptionMode !== 'hidden' && (
                    <label>
                      Description{descriptionMode === 'optional' ? ' (optional)' : ''}
                      <input
                        aria-label="Description"
                        required={descriptionMode === 'required'}
                        maxLength={500}
                        value={item.description}
                        onChange={(e) => edit(item.id, { description: e.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    {quantityVariable?.label ?? 'Quantity'}
                    <input
                      type="number"
                      min={quantityVariable?.min ?? 0.001}
                      max={quantityVariable?.max ?? 1000000}
                      step={quantityVariable?.integer ? 1 : 0.001}
                      required
                      value={item.quantity}
                      onChange={(e) => edit(item.id, { quantity: e.target.value })}
                    />
                    {templateCheck?.field === 'quantity' && (
                      <small className="danger-text" role="alert">
                        {templateCheck.error}
                      </small>
                    )}
                  </label>
                  {template && (
                    <TemplateInputs
                      template={template}
                      errorField={templateCheck?.field}
                      error={templateCheck?.error}
                      value={item.templateInputs ?? {}}
                      onChange={(value) => edit(item.id, { templateInputs: value })}
                    />
                  )}
                  {material?.requireSize && (
                    <>
                      <label>
                        Width
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          required
                          value={item.width}
                          onChange={(e) => edit(item.id, { width: e.target.value })}
                        />
                      </label>
                      <label>
                        Height
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          required
                          value={item.height}
                          onChange={(e) => edit(item.id, { height: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                </div>
                {(discountPolicy.maxPercent > 0 || item.discountDraft.kind) && (
                  <DiscountFields
                    label="Item discount"
                    value={item.discountDraft}
                    allowFlat={discountPolicy.canFlat}
                    maxPercent={discountPolicy.maxPercent}
                    onChange={(value) => edit(item.id, { discountDraft: value })}
                  />
                )}
                {line && (
                  <p>
                    {currency(line.unitPrice)} each · <strong>{currency(line.amount)}</strong>
                    {line.discountAmount > 0 && (
                      <small>
                        {' '}
                        (price {currency(line.grossAmount)}, discount -{currency(line.discountAmount)})
                      </small>
                    )}
                  </p>
                )}
                {template && (
                  <TemplateEstimate
                    ledger={ledger}
                    template={template}
                    inputs={item.templateInputs ?? {}}
                    quantity={item.quantity}
                    amount={line?.amount}
                    error=""
                  />
                )}
              </section>
            );
          })}
          <button
            type="button"
            className="secondary"
            disabled={lines.length >= 50}
            onClick={() => setLines((v) => [...v, newLine()])}
          >
            <Icon name="add" /> Add another item
          </button>
          {(discountPolicy.canFlat || orderDiscount.kind) && (
            <DiscountFields
              label="Quotation discount"
              value={orderDiscount}
              allowFlat={discountPolicy.canFlat}
              maxPercent={discountPolicy.maxPercent}
              onChange={setOrderDiscount}
            />
          )}
          <label>
            Note
            <textarea
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional: delivery time, terms, design notes"
            />
          </label>
          <div className="cart-total" role="status">
            {priced.ok ? (
              <>
                {priced.ok.discountTotal > 0 && (
                  <small>
                    Subtotal {currency(priced.ok.subtotal)} · Discount -{currency(priced.ok.discountTotal)}
                  </small>
                )}
                <span>
                  Total <strong>{currency(priced.ok.total)}</strong>
                </span>
              </>
            ) : (
              <small>
                {lines.some((l) => l.serviceId) ? priced.error : 'Choose what you are quoting for.'}
              </small>
            )}
          </div>
          <button type="submit">
            <Icon name="save" /> {busy ? 'Saving...' : 'Save quotation'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
