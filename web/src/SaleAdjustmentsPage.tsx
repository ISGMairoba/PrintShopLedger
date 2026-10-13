import { useState } from 'react';
import Modal from './Modal';
import JobCorrectionPicker from './JobCorrectionPicker';
import CurrencyInput from './CurrencyInput';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { accountToken, walletBalance } from './checkout.mjs';
import { applySaleAdjustment, adjustmentLabels, returnableStock } from './sale-adjustments.mjs';
import { paymentCorrectionToken, quoteCorrectedJob } from './full-corrections.mjs';
import { money, customerBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { saleDay, drawerSnapshot } from './my-sales.mjs';
import type { Ledger, Job, SupervisedEvent, SaleAdjustment } from './types';
import { useWords } from './Words';
export function AdjustmentHistory({ records }: { records: SaleAdjustment[] }) {
  const { w, stage } = useWords();
  return (
    <>
      {[...records]
        .filter((r) => !r.groupId || !records.some((parent) => parent.id === r.groupId))
        .reverse()
        .map((r) => (
          <details className="history-detail" key={r.id}>
            <summary>
              {w(adjustmentLabels[r.action as keyof typeof adjustmentLabels])} ·{' '}
              {new Date(r.changedAt).toLocaleString()} · {r.changedByLabel}
            </summary>
            <p>{r.reason}</p>
            <p>
              Charge: {currency(r.before.amount)} → {currency(r.after.amount)}
              <br />
              Description: {r.before.description} → {r.after.description}
              <br />
              Stage: {stage(r.before.productionStatus ?? 'Added')} →{' '}
              {stage(r.after.productionStatus ?? 'Added')}
            </p>
            <p>
              Quantity: {r.before.quantity ?? '—'} → {r.after.quantity ?? '—'}
              <br />
              Size: {r.before.width ?? '—'} × {r.before.height ?? '—'} → {r.after.width ?? '—'} ×{' '}
              {r.after.height ?? '—'}
              <br />
              {w('Service')}: {r.before.service} → {r.after.service}
              <br />
              Material: {r.before.materialId ?? 'None'} → {r.after.materialId ?? 'None'}
            </p>
            {r.stockMode === 'keep' && (
              <p>{w('Recorded material usage was kept; consumed stock was not restored.')}</p>
            )}
            {r.stockChanges?.map((c) => (
              <p key={c.materialId}>
                Stock correction: {c.materialId.slice(0, 8).toUpperCase()} · {c.delta > 0 ? '+' : ''}
                {c.delta}
              </p>
            ))}
            {r.action === 'payment.corrected' && (
              <p>
                Cash effect: {currency(r.cashDelta ?? 0)} ·{' '}
                {r.historicalClosingId
                  ? 'Historical drawer variance; the recorded handover is preserved.'
                  : r.drawerActor
                    ? 'Included in the original cashier’s open drawer.'
                    : 'No original drawer association.'}
              </p>
            )}
            <p>
              Credit released: {currency(r.creditReleased)}
              <br />
              Money refunded: {currency(r.refundAmount)}
              {r.refundAmount > 0 && ` (${r.methodLabel ?? r.method})`}
              <br />
              {w('Usable material returned')}: {r.returnQuantity}
            </p>
            {r.paymentChanges.map((p) => (
              <p key={p.before.id}>
                Payment #{p.before.id.slice(0, 8).toUpperCase()}: {p.before.methodLabel ?? p.before.method}{' '}
                {currency(p.before.amount)} → {p.after.methodLabel ?? p.after.method}{' '}
                {currency(p.after.amount)}; {w('job allocation')}{' '}
                {currency(p.before.allocations.find((a) => a.jobId === r.jobId)?.amount ?? 0)} →{' '}
                {currency(p.after.allocations.find((a) => a.jobId === r.jobId)?.amount ?? 0)}; wallet added{' '}
                {currency(p.before.walletAdded ?? 0)} → {currency(p.after.walletAdded ?? 0)}; reference{' '}
                {p.before.reference || '—'} → {p.after.reference || '—'}
              </p>
            ))}
            <small>Adjustment #{r.id.toUpperCase()}</small>
          </details>
        ))}
    </>
  );
}
export default function SaleAdjustmentsPage({
  ledger,
  recentDays = 7,
  ready,
  busy,
  canSave,
  onAdjust,
}: {
  recentDays?: number;
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  canSave: boolean;
  onAdjust: (job: Job) => void;
}) {
  const { w } = useWords();
  const [query, setQuery] = useState(''),
    [jobId, setJobId] = useState('');
  const records = ledger.saleAdjustments.filter((r) =>
    [
      r.id,
      r.jobId,
      r.before.description,
      ledger.customers.find((c) => c.id === r.customerId)?.name,
      r.reason,
      r.changedByLabel,
      r.action,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel supervisor-page">
      <h2>Corrections, cancellations and refunds</h2>
      <p>
        Original receipts remain available. Changes record the reason, approver and before-and-after values.
      </p>
      <p className="muted">
        {w(
          'Connect and finish syncing before approving an adjustment. To refund money allocated to a job, reduce the charge or cancel the sale first; then return the resulting customer credit.',
        )}
      </p>
      <div className="form-grid">
        <JobCorrectionPicker ledger={ledger} days={recentDays} value={jobId} onChange={setJobId} />
        <button
          disabled={!ready || busy || !canSave || !jobId}
          onClick={() => onAdjust(ledger.jobs.find((j) => j.id === jobId)!)}
        >
          Adjust selected sale
        </button>
      </div>
      <h3>Adjustment history</h3>
      <input
        aria-label="Search sale adjustments"
        placeholder={w('Search customer, job, reason or approver')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {ready ? (
        <>
          <AdjustmentHistory records={records} />
          {!records.length && <p className="empty">No matching adjustments.</p>}
        </>
      ) : (
        <p>Loading adjustments…</p>
      )}
    </section>
  );
}
export function SaleAdjustmentEditor({
  ledger,
  job,
  busy,
  actor,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  job: Job;
  busy: boolean;
  actor: { id: string; label: string };
  onClose: () => void;
  onSave: (event: SupervisedEvent) => Promise<void>;
}) {
  const { w, stage } = useWords();
  const [submitted, setSubmitted] = useState<SupervisedEvent | null>(null);
  const options = useBusinessOptions(),
    methods = options.paymentMethods.filter((m) => m.enabled);
  const [action, setAction] = useState<SupervisedEvent['kind']>(
    job.productionStatus === 'Cancelled' ? 'sale.refunded' : 'sale.corrected',
  );
  const [amount, setAmount] = useState(String(job.amount / 100)),
    [description, setDescription] = useState(job.description),
    [reason, setReason] = useState(''),
    [returned, setReturned] = useState('0'),
    [refund, setRefund] = useState(''),
    [method, setMethod] = useState(methods[0]?.label ?? ''),
    [error, setError] = useFeedbackMessage('error');
  const [serviceId, setServiceId] = useState(job.serviceId ?? ''),
    [materialId, setMaterialId] = useState(job.materialId ?? ''),
    [quantity, setQuantity] = useState(String(job.quantity ?? 1)),
    [width, setWidth] = useState(String(job.width ?? 1)),
    [height, setHeight] = useState(String(job.height ?? 1)),
    [unitPrice, setUnitPrice] = useState(
      String(
        (job.unitPrice ??
          job.amount / ((job.quantity ?? 1) * (job.requireSize ? (job.width ?? 1) * (job.height ?? 1) : 1))) /
          100,
      ),
    ),
    [stockMode, setStockMode] = useState('');
  const [customerPayments] = useState(() =>
    structuredClone(ledger.payments.filter((p) => p.customerId === job.customerId && !p.refundId)),
  );
  const [paymentEdits, setPaymentEdits] = useState(() =>
    customerPayments.map((p) => ({
      eventId: crypto.randomUUID(),
      paymentId: p.id,
      expectedPayment: paymentCorrectionToken(p),
      paymentAmount: String(p.amount / 100),
      method: p.method,
      methodLabel: p.methodLabel ?? p.method,
      reference: p.reference,
    })),
  );
  const [detailsId] = useState(() => crypto.randomUUID());
  const [expectedAccount] = useState(() => accountToken(ledger, job.customerId));
  const [materialVersions] = useState(() =>
    Object.fromEntries(ledger.materials.map((m) => [m.id, m.version])),
  );
  const [serviceVersions] = useState(() => Object.fromEntries(ledger.services.map((s) => [s.id, s.version])));
  const [paymentId, setPaymentId] = useState(customerPayments[0]?.id ?? ''),
    [paymentAmount, setPaymentAmount] = useState(String((customerPayments[0]?.amount ?? 0) / 100)),
    [paymentMethod, setPaymentMethod] = useState(
      customerPayments[0]?.methodLabel ?? customerPayments[0]?.method ?? '',
    ),
    [reference, setReference] = useState(customerPayments[0]?.reference ?? '');
  const selectedPayment = customerPayments.find((p) => p.id === paymentId),
    selectedMaterial = ledger.materials.find((m) => m.id === materialId);
  const [stockIds] = useState(() =>
    Object.fromEntries(ledger.materials.map((m) => [m.id, crypto.randomUUID()])),
  );
  const [id] = useState(() => crypto.randomUUID()),
    [stockId] = useState(() => crypto.randomUUID());
  const mat = ledger.materials.find((m) => m.id === job.materialId),
    credit = walletBalance(ledger, job.customerId),
    availableReturn = returnableStock(ledger, job.id);
  function event(): SupervisedEvent {
    const chosen = methods.find((m) => m.label === (action === 'payment.corrected' ? paymentMethod : method)),
      now = new Date().toISOString();
    return {
      id,
      kind: action,
      data: {
        jobId: job.id,
        baseVersion: job.version ?? 1,
        expectedAccount,
        reason,
        modifiedBy: actor.id,
        modifiedByLabel: actor.label,
        modifiedAt: now,
        ...(['sale.details_corrected', 'sale.combined_corrected'].includes(action)
          ? {
              serviceId,
              serviceVersion: serviceVersions[serviceId],
              materialId: materialId || undefined,
              unitPrice: money(unitPrice),
              description,
              quantity: Number(quantity),
              width: Number(width),
              height: Number(height),
              stockMode,
              stockIds,
              materialVersions,
              ...(action === 'sale.combined_corrected'
                ? {
                    detailsId,
                    paymentEdits: paymentEdits.map((p) => ({ ...p, paymentAmount: money(p.paymentAmount) })),
                  }
                : {}),
            }
          : action === 'payment.corrected'
            ? {
                paymentId,
                paymentAmount: money(paymentAmount),
                expectedPayment: selectedPayment ? paymentCorrectionToken(selectedPayment) : undefined,
                method: chosen?.kind ?? selectedPayment?.method,
                methodLabel: chosen?.label ?? paymentMethod,
                reference,
              }
            : action === 'sale.corrected'
              ? { amount: money(amount), description }
              : action === 'sale.cancelled'
                ? {
                    returnQuantity: Number(returned),
                    materialVersion: materialVersions[job.materialId ?? ''],
                    stockEventId: stockId,
                  }
                : {
                    refundAmount: money(refund),
                    method: chosen?.kind,
                    methodLabel: chosen?.label,
                    paidOn: saleDay(now),
                  }),
      },
    };
  }
  const comparison: { label: string; before: string; after: string }[] = [];
  const value = (n: unknown) => (n === null || n === undefined || n === '' ? '—' : String(n));
  const materialName = (id?: string | null) =>
    id ? (ledger.materials.find((m) => m.id === id)?.name ?? id) : w('No material');
  let proposed: Job = job,
    next: Ledger = ledger,
    previewNotice = '';
  try {
    const command = event();
    if (['sale.details_corrected', 'sale.combined_corrected'].includes(action))
      proposed = quoteCorrectedJob(ledger, job, command.data);
    else if (action === 'sale.corrected') proposed = { ...job, description, amount: money(amount) };
    else if (action === 'sale.cancelled') proposed = { ...job, amount: 0, productionStatus: 'Cancelled' };
    try {
      next = applySaleAdjustment(ledger, {
        ...command,
        data: { ...command.data, reason: reason.trim() || 'Correction preview' },
      });
      proposed = next.jobs.find((j) => j.id === job.id) ?? proposed;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message !== 'Nothing changed.') previewNotice = message;
    }
  } catch (cause) {
    previewNotice = cause instanceof Error ? cause.message : String(cause);
  }
  const add = (label: string, before: unknown, after: unknown) =>
    comparison.push({ label, before: value(before), after: value(after) });
  if (action !== 'payment.corrected') {
    add('Name / description', job.description, proposed.description);
    add(w('Service'), job.service, proposed.service);
    add(w('Material'), materialName(job.materialId), materialName(proposed.materialId));
    add('Quantity', job.quantity, proposed.quantity);
    if (job.requireSize || proposed.requireSize) {
      add('Width', job.width, proposed.width);
      add('Height', job.height, proposed.height);
    }
    add(
      'Unit price',
      job.unitPrice === undefined ? '—' : currency(job.unitPrice),
      proposed.unitPrice === undefined ? '—' : currency(proposed.unitPrice),
    );
    add(w('Job charge'), currency(job.amount), currency(proposed.amount));
    add('Stage', stage(job.productionStatus ?? 'Added'), stage(proposed.productionStatus ?? 'Added'));
  }
  for (const original of action === 'sale.combined_corrected'
    ? customerPayments
    : action === 'payment.corrected' && selectedPayment
      ? [selectedPayment]
      : []) {
    const payment = next.payments.find((p) => p.id === original.id) ?? original,
      prefix =
        action === 'sale.combined_corrected'
          ? `Payment ${original.id.slice(0, 8).toUpperCase()} · `
          : 'Payment ';
    add(prefix + 'amount', currency(original.amount), currency(payment.amount));
    add(prefix + 'method', original.methodLabel ?? original.method, payment.methodLabel ?? payment.method);
    add(prefix + 'reference', original.reference, payment.reference);
  }
  for (const payment of ledger.payments) {
    const revised = next.payments.find((p) => p.id === payment.id);
    if (!revised) continue;
    const allocated = payment.allocations.find((a) => a.jobId === job.id)?.amount ?? 0,
      revisedAllocated = revised.allocations.find((a) => a.jobId === job.id)?.amount ?? 0;
    if (allocated !== revisedAllocated)
      add(
        w(`Payment ${payment.id.slice(0, 8).toUpperCase()} · Job allocation`),
        currency(allocated),
        currency(revisedAllocated),
      );
  }
  add('Customer credit', currency(credit), currency(walletBalance(next, job.customerId)));
  add(
    'Customer outstanding',
    currency(customerBalance(ledger, job.customerId)),
    currency(customerBalance(next, job.customerId)),
  );
  const affectedMaterials = [
    ...new Set(
      [
        job.materialId,
        proposed.materialId,
        ...(next.saleAdjustments.find((a) => a.id === id)?.stockChanges?.map((c) => c.materialId) ?? []),
      ].filter(Boolean),
    ),
  ];
  for (const materialId of affectedMaterials) {
    const before = ledger.materials.find((m) => m.id === materialId),
      after = next.materials.find((m) => m.id === materialId);
    if (before && after)
      add(
        `Stock · ${before.name}`,
        `${before.available} ${before.measurementUnit}`,
        `${after.available} ${after.measurementUnit}`,
      );
  }
  const adjustment = next.saleAdjustments.find((a) => a.id === id);
  if (action === 'sale.combined_corrected' && adjustment) {
    const children = next.saleAdjustments.filter((a) => a.groupId === id && a.action === 'payment.corrected');
    for (const userId of [...new Set(children.map((a) => a.drawerActor).filter(Boolean))])
      add(
        `Expected cash · cashier ${userId?.slice(0, 8).toUpperCase()}`,
        currency(drawerSnapshot(ledger, userId).expectedCash),
        currency(drawerSnapshot(next, userId).expectedCash),
      );
    for (const closingId of [...new Set(children.map((a) => a.historicalClosingId).filter(Boolean))]) {
      const closing = ledger.drawerClosings.find((c) => c.id === closingId),
        before =
          (closing?.expectedCash ?? 0) +
          ledger.saleAdjustments
            .filter((a) => a.historicalClosingId === closingId)
            .reduce((n, a) => n + (a.cashDelta ?? 0), 0);
      add(
        `Historical expected cash · ${closingId?.slice(0, 8).toUpperCase()}`,
        currency(before),
        currency(
          before +
            children
              .filter((a) => a.historicalClosingId === closingId)
              .reduce((n, a) => n + (a.cashDelta ?? 0), 0),
        ),
      );
    }
    previewNotice = w(
      'Job and payment changes will be saved together. Original receipts and completed handovers remain available.',
    );
  }
  if (action === 'payment.corrected' && adjustment) {
    if (adjustment.drawerActor)
      add(
        'Expected cash · original cashier’s drawer',
        currency(drawerSnapshot(ledger, adjustment.drawerActor).expectedCash),
        currency(drawerSnapshot(next, adjustment.drawerActor).expectedCash),
      );
    else if (adjustment.historicalClosingId) {
      const closing = ledger.drawerClosings.find((c) => c.id === adjustment.historicalClosingId);
      const before =
        (closing?.expectedCash ?? 0) +
        ledger.saleAdjustments
          .filter((a) => a.historicalClosingId === adjustment.historicalClosingId)
          .reduce((n, a) => n + (a.cashDelta ?? 0), 0);
      add('Historical expected cash', currency(before), currency(before + (adjustment.cashDelta ?? 0)));
    }
    previewNotice = adjustment.historicalClosingId
      ? 'This affects historical drawer variance. The recorded handover stays unchanged.'
      : adjustment.drawerActor
        ? 'The cash difference is applied to the original cashier’s open drawer.'
        : 'This payment has no original drawer association.';
  }
  if (action === 'sale.refunded') add('Money returned', currency(0), currency(adjustment?.refundAmount ?? 0));

  return (
    <Modal title="Adjust sale" wide busy={busy} onClose={onClose}>
      <p>
        {ledger.customers.find((c) => c.id === job.customerId)?.name} · {job.service} · {w('Job')} #
        {job.id.slice(0, 8).toUpperCase()}
      </p>
      <p>
        Current charge: <strong>{currency(job.amount)}</strong> · Customer credit:{' '}
        <strong>{currency(credit)}</strong>
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <form
        className="supervisor-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            const command = submitted ?? event();
            applySaleAdjustment(ledger, command);
            setSubmitted(command);
            await onSave(command);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy || !!submitted}>
          <label>
            Adjustment type
            <select value={action} onChange={(e) => setAction(e.target.value as SupervisedEvent['kind'])}>
              {job.productionStatus !== 'Cancelled' && (
                <>
                  {!job.templateSnapshot && (
                    <option value="sale.combined_corrected">{w('Correct job and payments together')}</option>
                  )}
                  <option value="sale.corrected">Correct charge / description</option>
                  {!job.templateSnapshot && (
                    <option value="sale.details_corrected">
                      {w('Correct quantity / size / service / material')}
                    </option>
                  )}
                  <option value="sale.cancelled">Cancel sale</option>
                </>
              )}
              <option value="payment.corrected">Correct payment details</option>
              <option value="sale.refunded">Refund customer credit</option>
            </select>
          </label>
          {action === 'sale.corrected' && (
            <div className="form-grid">
              <label>
                Corrected description
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  maxLength={500}
                />
              </label>
              <label>
                Corrected charge (₦)
                <CurrencyInput value={amount} onValueChange={setAmount} required />
              </label>
            </div>
          )}
          {['sale.details_corrected', 'sale.combined_corrected'].includes(action) && (
            <>
              <h3>{w('Job details')}</h3>
              <div className="form-grid">
                <label>
                  {w('Corrected service')}
                  <select
                    value={serviceId}
                    onChange={(e) => {
                      const service = ledger.services.find((s) => s.id === e.target.value)!;
                      setServiceId(service.id);
                      setMaterialId(service.materialId ?? '');
                      setUnitPrice(String(service.price / 100));
                    }}
                    required
                  >
                    <option value="">{w('Choose a service')}</option>
                    {ledger.services
                      .filter((s) => !s.archived && !s.private)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.description}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {w('Corrected material')}
                  <select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
                    <option value="">{w('No material')}</option>
                    {ledger.materials
                      .filter((m) => !m.archived)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Corrected quantity
                  <input
                    type="number"
                    min="0.001"
                    max="1000000"
                    step="0.001"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </label>
                {selectedMaterial?.requireSize && (
                  <>
                    <label>
                      Corrected width
                      <input
                        type="number"
                        min="0.001"
                        max="1000000"
                        step="0.001"
                        value={width}
                        onChange={(e) => setWidth(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Corrected height
                      <input
                        type="number"
                        min="0.001"
                        max="1000000"
                        step="0.001"
                        value={height}
                        onChange={(e) => setHeight(e.target.value)}
                        required
                      />
                    </label>
                  </>
                )}
                <label>
                  Corrected unit price (₦)
                  <CurrencyInput value={unitPrice} onValueChange={setUnitPrice} required />
                  <small className="muted">
                    {selectedMaterial?.requireSize
                      ? 'Rate per size unit: quantity × width × height × unit price.'
                      : 'Rate per item: quantity × unit price.'}{' '}
                    {w('This changes this job only.')}
                  </small>
                </label>
                <label>
                  Corrected description
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                    maxLength={500}
                  />
                </label>
              </div>
              <label>
                {w('Material usage treatment')}
                <select value={stockMode} onChange={(e) => setStockMode(e.target.value)} required>
                  <option value="">Choose how to handle stock</option>
                  <option value="reconcile">Correct the stock deduction — original entry was wrong</option>
                  <option value="keep">{w('Keep actual usage — the material was already consumed')}</option>
                </select>
              </label>
              <p className="muted">
                {w(
                  'Stock corrections adjust only the difference. Keeping actual usage changes the job and charge without restoring consumed material. Waste records remain separate.',
                )}
              </p>
            </>
          )}
          {action === 'sale.combined_corrected' && (
            <>
              <h3>Payments for this customer</h3>
              <p className="muted">
                {w(
                  'Edit the job and any of these payment records in one approval. Each payment may cover other jobs for this customer; its allocation and drawer effects appear below. Additional money received and refunds should be recorded through their normal actions.',
                )}
              </p>
              {paymentEdits.map((edit, index) => (
                <section
                  className="combined-payment"
                  aria-label={`Payment ${edit.paymentId.slice(0, 8).toUpperCase()}`}
                  key={edit.paymentId}
                >
                  <h4>Payment #{edit.paymentId.slice(0, 8).toUpperCase()}</h4>
                  <div className="form-grid">
                    <label>
                      Corrected amount paid (₦)
                      <CurrencyInput
                        value={edit.paymentAmount}
                        onValueChange={(value) =>
                          setPaymentEdits((current) =>
                            current.map((p, i) => (i === index ? { ...p, paymentAmount: value } : p)),
                          )
                        }
                        required
                      />
                    </label>
                    <label>
                      Corrected payment method
                      <select
                        value={edit.methodLabel}
                        required
                        onChange={(event) => {
                          const chosen = methods.find((m) => m.label === event.target.value)!;
                          setPaymentEdits((current) =>
                            current.map((p, i) =>
                              i === index
                                ? {
                                    ...p,
                                    method: chosen.kind as 'Cash' | 'POS' | 'Transfer',
                                    methodLabel: chosen.label,
                                  }
                                : p,
                            ),
                          );
                        }}
                      >
                        {!methods.some((m) => m.label === edit.methodLabel) && (
                          <option>{edit.methodLabel}</option>
                        )}
                        {methods.map((m) => (
                          <option key={m.label}>{m.label}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Corrected payment reference
                      <input
                        maxLength={500}
                        value={edit.reference}
                        onChange={(event) =>
                          setPaymentEdits((current) =>
                            current.map((p, i) =>
                              i === index ? { ...p, reference: event.target.value } : p,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                </section>
              ))}
              {!paymentEdits.length && (
                <p>{w('No payment record for this customer. You can still correct the job details here.')}</p>
              )}
            </>
          )}
          {action === 'payment.corrected' && (
            <>
              <h3>Payment details</h3>
              <label>
                Payment to correct
                <select
                  value={paymentId}
                  required
                  onChange={(e) => {
                    const payment = customerPayments.find((p) => p.id === e.target.value)!;
                    setPaymentId(payment.id);
                    setPaymentAmount(String(payment.amount / 100));
                    setPaymentMethod(payment.methodLabel ?? payment.method);
                    setReference(payment.reference);
                  }}
                >
                  <option value="">Choose a payment</option>
                  {customerPayments.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.id.slice(0, 8).toUpperCase()} · {currency(p.amount)} · {p.methodLabel ?? p.method}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid">
                <label>
                  Corrected amount paid (₦)
                  <CurrencyInput value={paymentAmount} onValueChange={setPaymentAmount} required />
                </label>
                <label>
                  Corrected payment method
                  <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} required>
                    {!methods.some((m) => m.label === paymentMethod) && paymentMethod && (
                      <option>{paymentMethod}</option>
                    )}
                    {methods.map((m) => (
                      <option key={m.label}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Corrected payment reference
                  <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} />
                </label>
              </div>
              <p className="muted">
                {w(
                  'Correct a mistaken record here. Record additional money received through checkout, and money returned through a refund. Increasing the recorded amount pays outstanding jobs first; reducing it removes unspent credit first, then reopens the affected job balances.',
                )}
              </p>
            </>
          )}
          {action === 'sale.cancelled' && (
            <>
              <p className="notice notice-warning">
                The charge becomes zero and paid allocations become customer credit. Money is returned through
                a separate refund.
              </p>
              {mat && !mat.archived && availableReturn > 0 ? (
                <label>
                  {w('Usable material returned')} ({mat.measurementUnit})
                  <input
                    type="number"
                    min="0"
                    max={availableReturn}
                    step="0.001"
                    value={returned}
                    onChange={(e) => setReturned(e.target.value)}
                    required
                  />
                  <small>
                    Maximum {availableReturn}.{' '}
                    {w('Return only unused, reusable material. Leave zero for materials already used.')}
                  </small>
                </label>
              ) : (
                <p>{w('No recorded material usage is eligible for stock return.')}</p>
              )}
            </>
          )}
          {action === 'sale.refunded' && (
            <>
              <p>
                Record this after returning the money. Available credit is {currency(credit)}
                {w('; the job charge will stay the same.')}
              </p>
              <div className="form-grid">
                <label>
                  Money returned (₦)
                  <CurrencyInput value={refund} onValueChange={setRefund} max={credit / 100} required />
                </label>
                <label>
                  Refund method
                  <select value={method} onChange={(e) => setMethod(e.target.value)} required>
                    {methods.map((m) => (
                      <option key={m.label}>{m.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              {methods.find((m) => m.label === method)?.kind === 'Cash' && (
                <p className="muted">
                  Cash refunds are deducted from your drawer, the approving user’s drawer.
                </p>
              )}
            </>
          )}
          <label>
            Reason
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} />
          </label>
          <section className="correction-comparison" aria-label="Correction comparison">
            <h3>Review changes</h3>
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Original</th>
                  <th scope="col">Corrected</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.label} className={row.before !== row.after ? 'comparison-changed' : ''}>
                    <th scope="row">{row.label}</th>
                    <td>{row.before}</td>
                    <td>
                      {row.before !== row.after ? (
                        <strong>
                          {row.after}
                          <small>Changed</small>
                        </strong>
                      ) : (
                        row.after
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {previewNotice && (
              <p className="muted" role="status">
                {previewNotice}
              </p>
            )}
          </section>
          <label className="check-label">
            <input type="checkbox" key={action} required />{' '}
            {w('I approve these changes and confirm the material or money returned.')}
          </label>
        </fieldset>
        {submitted && (
          <p className="muted">
            This request is fixed for a safe retry. If the records changed, close this dialog, sync and reopen
            it.
          </p>
        )}
        <button disabled={busy}>
          {busy ? 'Saving adjustment…' : submitted ? 'Retry same adjustment' : 'Approve and save adjustment'}
        </button>
      </form>
    </Modal>
  );
}
