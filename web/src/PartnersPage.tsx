import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Icon from './Icon';
import Modal from './Modal';
import { END_RULES, readyToStock, refillNeeded, stockFrom } from './partners.mjs';
import { currency } from './receipts.mjs';
import type { Customer, Job, Ledger, PartnerItem, Service } from './types';

type Save = (kind: string, data: Record<string, unknown>) => Promise<void>;
type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; item: PartnerItem }
  | { kind: 'build'; item: PartnerItem }
  | { kind: 'count'; item: PartnerItem }
  | { kind: 'design'; item: PartnerItem }
  | { kind: 'end'; item: PartnerItem }
  | null;

/**
 * Partners (plans/partners.md): stock kept for regular clients. One card per partner item, with stock
 * on hand against the agreed level, and its actions: prepare stock (a job made in the best batch
 * size), count it, change the design, edit or end the agreement. Completed jobs whose stock is
 * ready are added to stock here.
 */
export default function PartnersPage({
  ledger,
  level,
  busy,
  canSave,
  onSave,
  onSaveService,
  onSell,
}: {
  ledger: Ledger;
  level: number;
  busy: boolean;
  canSave: boolean;
  onSave: Save;
  /** Mark a service as made for a partner (service.updated). */
  onSaveService: (service: Service, partnerOf: string) => Promise<void>;
  /** Open Point of Service for the partner. */
  onSell?: (customerId: string) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<string | null>(null);
  const items = [...(ledger.partnerItems ?? [])].sort(
    (a, b) =>
      (a.status === 'ended' ? 1 : 0) - (b.status === 'ended' ? 1 : 0) ||
      name(ledger, a).localeCompare(name(ledger, b)),
  );
  const ready = readyToStock(ledger) as Job[];
  const off = busy || !canSave;
  const run = async (action: () => Promise<void>, done: string) => {
    setError('');
    try {
      await action();
      setNotice(done);
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <section className="panel partners">
      <div className="section-heading">
        <h2>Partners</h2>
        {level >= 3 && (
          <button type="button" disabled={off} data-opens-dialog onClick={() => setDialog({ kind: 'add' })}>
            <Icon name="add" /> Add partner item
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {!canSave && <p className="muted">Partner stock is kept online: connect to change it.</p>}
      {ready.length > 0 && (
        <div className="notice" role="status">
          <strong>Ready to add to stock</strong>
          {ready.map((job) => (
            <div key={job.id} className="material-actions">
              <span>
                {job.description} · adds {stockFrom(job)}
              </span>
              <button
                type="button"
                disabled={off}
                onClick={() =>
                  void run(
                    () =>
                      onSave('partner.stock_built', {
                        id: job.partnerBuild?.itemId ?? job.partner?.itemId,
                        jobId: job.id,
                      }),
                    `${stockFrom(job)} added to stock.`,
                  )
                }
              >
                Add to stock
              </button>
            </div>
          ))}
        </div>
      )}
      {items.length === 0 ? (
        <p className="muted">
          No partner items yet. A partner item is a service made for one regular client at a fixed price: you
          keep an agreed stock ready, use it first, and make the rest in the best batch size. Add one with
          “Add partner item”.
        </p>
      ) : (
        <div className="card-grid">
          {items.map((item) => {
            const service = ledger.services.find((s) => s.id === item.id);
            const refill = refillNeeded(item);
            const low = item.status === 'active' && item.onHand < item.refillAt;
            return (
              <article key={item.id} className={`card${item.status === 'ended' ? ' muted' : ''}`}>
                <h3>{name(ledger, item)}</h3>
                <p>
                  <strong>
                    {item.onHand} / {item.agreedStock}
                  </strong>{' '}
                  on hand · refill below {item.refillAt} · batch {item.batchSize}
                  {low && <span className="badge warning">Low</span>}
                </p>
                <small>
                  {currency(service?.price ?? 0)} each · design {item.design}
                  {item.oldDesignStock ? ` (old design first: ${item.oldDesignStock})` : ''}
                  {item.status === 'ended' ? ` · ended (${endLabel(item.endRule)})` : ''}
                  {item.reviewOn ? ` · price review ${item.reviewOn}` : ''}
                </small>
                {item.status === 'active' && (
                  <div className="material-actions">
                    {onSell && (
                      <button type="button" className="secondary" onClick={() => onSell(item.customerId)}>
                        Sell
                      </button>
                    )}
                    {level >= 2 && (
                      <button
                        type="button"
                        disabled={off}
                        data-opens-dialog
                        onClick={() => setDialog({ kind: 'build', item })}
                      >
                        Prepare stock{refill && item.refillPrompt !== 'never' ? ` (${refill})` : ''}
                      </button>
                    )}
                    {level >= 2 && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={off}
                        data-opens-dialog
                        onClick={() => setDialog({ kind: 'count', item })}
                      >
                        Count
                      </button>
                    )}
                    {level >= 3 && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={off}
                          data-opens-dialog
                          onClick={() => setDialog({ kind: 'edit', item })}
                        >
                          Agreement
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={off}
                          data-opens-dialog
                          onClick={() => setDialog({ kind: 'design', item })}
                        >
                          New design
                        </button>
                        <button
                          type="button"
                          className="secondary danger-text"
                          disabled={off}
                          data-opens-dialog
                          onClick={() => setDialog({ kind: 'end', item })}
                        >
                          End
                        </button>
                      </>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="text-button"
                  aria-expanded={history === item.id}
                  onClick={() => setHistory(history === item.id ? null : item.id)}
                >
                  History
                </button>
                {history === item.id && (
                  <ul className="compact-list">
                    {[...item.moves].reverse().map((m, i) => (
                      <li key={`${m.at}-${i}`}>
                        {new Date(m.at).toLocaleDateString()} · {moveLabel(m)} · {m.onHand} on hand
                        {m.byLabel ? ` · ${m.byLabel}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
      {dialog && (dialog.kind === 'add' || dialog.kind === 'edit') && (
        <AgreementDialog
          ledger={ledger}
          item={dialog.kind === 'edit' ? dialog.item : null}
          busy={off}
          error={error}
          onClose={() => setDialog(null)}
          onSave={(customer, service, values) =>
            run(async () => {
              if (service.production?.partnerOf !== customer.id) await onSaveService(service, customer.id);
              const existing = dialog.kind === 'edit' ? dialog.item : null;
              await onSave('partner.item_saved', {
                id: service.id,
                customerId: customer.id,
                baseVersion: existing?.version ?? 0,
                ...values,
              });
            }, `${service.description} is a partner item for ${customer.name}.`)
          }
        />
      )}
      {dialog?.kind === 'build' && (
        <NumberDialog
          title={`Prepare ${name(ledger, dialog.item)}`}
          label="How many to prepare"
          start={refillNeeded(dialog.item) ?? dialog.item.batchSize}
          action="Prepare"
          busy={off}
          error={error}
          note="A job for the partner at no charge, with this item's own steps; its materials are taken when they are confirmed in production. When it is completed, add it to stock here."
          onClose={() => setDialog(null)}
          onSave={(quantity) =>
            run(
              () =>
                onSave('partner.build_started', { id: dialog.item.id, jobId: crypto.randomUUID(), quantity }),
              `A job to prepare ${quantity} is on the Jobs page.`,
            )
          }
        />
      )}
      {dialog?.kind === 'count' && (
        <NumberDialog
          title={`Count ${name(ledger, dialog.item)}`}
          label="On hand now"
          start={dialog.item.onHand}
          action="Save count"
          reason
          busy={off}
          error={error}
          onClose={() => setDialog(null)}
          onSave={(quantity, reason) =>
            run(
              () => onSave('partner.stock_adjusted', { id: dialog.item.id, quantity, reason }),
              `Stock set to ${quantity}.`,
            )
          }
        />
      )}
      {dialog?.kind === 'design' && (
        <NumberDialog
          title={`New design for ${name(ledger, dialog.item)}`}
          action="Start design"
          reason
          busy={off}
          error={error}
          note={`Design ${dialog.item.design + 1}. The ${dialog.item.onHand} already made (design ${dialog.item.design}) are used first; new stock is the new design.`}
          onClose={() => setDialog(null)}
          onSave={(_, reason) =>
            run(() => onSave('partner.design_changed', { id: dialog.item.id, reason }), 'New design started.')
          }
        />
      )}
      {dialog?.kind === 'end' && (
        <EndDialog
          item={dialog.item}
          title={name(ledger, dialog.item)}
          busy={off}
          error={error}
          onClose={() => setDialog(null)}
          onSave={(endRule) =>
            run(() => onSave('partner.ended', { id: dialog.item.id, endRule }), 'Agreement ended.')
          }
        />
      )}
    </section>
  );
}

const name = (ledger: Ledger, item: PartnerItem) => {
  const who = ledger.customers.find((c) => c.id === item.customerId)?.name ?? 'Partner';
  const what = ledger.services.find((s) => s.id === item.id)?.description ?? 'Removed item';
  return `${who}: ${what}`;
};
const endLabel = (rule: string) => END_RULES.find(([k]) => k === rule)?.[1] ?? rule;
const moveLabel = (m: PartnerItem['moves'][number]) =>
  m.kind === 'build'
    ? `Preparing ${m.planned}`
    : m.kind === 'built'
      ? `Prepared +${m.quantity}`
      : m.kind === 'sold'
        ? `Sold from stock ${m.quantity}`
        : m.kind === 'leftover'
          ? `Batch left over +${m.quantity}`
          : m.kind === 'set'
            ? `Counted ${(m.quantity ?? 0) >= 0 ? '+' : ''}${m.quantity} (${m.reason})`
            : m.kind === 'design'
              ? `New design${m.reason ? ` (${m.reason})` : ''}`
              : 'Agreement ended';

function AgreementDialog({
  ledger,
  item,
  busy,
  error,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  item: PartnerItem | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (customer: Customer, service: Service, values: Record<string, unknown>) => Promise<void>;
}) {
  const formId = useId();
  // Partner items are fixed-price services (not shelf items, templates or custom prices).
  const services = ledger.services.filter(
    (s) => !s.archived && !s.shelfItem && !s.customPrice && !s.private && !(s.priceTiers ?? []).length,
  );
  const [customerId, setCustomerId] = useState(item?.customerId ?? '');
  const [serviceId, setServiceId] = useState(item?.id ?? '');
  const taken = new Set((ledger.partnerItems ?? []).filter((p) => p.id !== item?.id).map((p) => p.id));
  return (
    <Modal
      title={item ? 'Partner agreement' : 'Add partner item'}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save agreement
        </DialogActions>
      }
    >
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const customer = ledger.customers.find((c) => c.id === customerId);
          const service = ledger.services.find((s) => s.id === serviceId);
          if (!customer || !service) return;
          void onSave(customer, service, {
            agreedStock: Math.round(Number(f.get('agreedStock'))),
            refillAt: Math.round(Number(f.get('refillAt'))),
            batchSize: Math.round(Number(f.get('batchSize'))),
            endRule: String(f.get('endRule')),
            collectRule: String(f.get('collectRule')),
            refillPrompt: String(f.get('refillPrompt')),
            costTiming: String(f.get('costTiming')),
            reviewOn: String(f.get('reviewOn') ?? '') || null,
            notes: String(f.get('notes') ?? ''),
          });
        }}
      >
        <label>
          Partner
          <select
            aria-label="Partner"
            required
            disabled={!!item}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Choose a customer</option>
            {[...ledger.customers]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Item (a fixed-price service)
          <select
            aria-label="Item"
            required
            disabled={!!item}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">Choose a service</option>
            {services
              .filter(
                (s) =>
                  !taken.has(s.id) && (!s.production?.partnerOf || s.production.partnerOf === customerId),
              )
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.description} · {currency(s.price)}
                </option>
              ))}
          </select>
          <small>
            Its price is the fixed price; its own steps (Services) leave out stages like Design. Its materials
            are taken in production, when they are confirmed.
          </small>
        </label>
        <label>
          Agreed stock
          <input name="agreedStock" type="number" min="0" required defaultValue={item?.agreedStock ?? 200} />
        </label>
        <label>
          Refill when below
          <input name="refillAt" type="number" min="0" required defaultValue={item?.refillAt ?? 80} />
        </label>
        <label>
          Best batch size
          <input name="batchSize" type="number" min="1" required defaultValue={item?.batchSize ?? 250} />
        </label>
        <label>
          If the agreement ends, the stock left is
          <select
            name="endRule"
            aria-label="If the agreement ends"
            defaultValue={item?.endRule ?? 'partnerPays'}
          >
            {END_RULES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Collecting
          <select name="collectRule" aria-label="Collecting" defaultValue={item?.collectRule ?? 'together'}>
            <option value="together">All together</option>
            <option value="parts">The ready part first, the rest later</option>
          </select>
        </label>
        <label>
          When stock gets low
          <select
            name="refillPrompt"
            aria-label="When stock gets low"
            defaultValue={item?.refillPrompt ?? 'ask'}
          >
            <option value="ask">Ask to prepare more</option>
            <option value="auto">Prepare a batch</option>
            <option value="never">Do nothing</option>
          </select>
        </label>
        <label>
          Cost of stock made in advance counts
          <select name="costTiming" aria-label="Cost counts" defaultValue={item?.costTiming ?? 'used'}>
            <option value="used">When the materials are used</option>
            <option value="sold">When it is sold</option>
          </select>
        </label>
        <label>
          Price review date (optional)
          <input name="reviewOn" type="date" defaultValue={item?.reviewOn ?? ''} />
        </label>
        <label>
          Notes (requirements, artwork link)
          <textarea name="notes" maxLength={1000} defaultValue={item?.notes ?? ''} />
        </label>
      </form>
    </Modal>
  );
}

function NumberDialog({
  title,
  label,
  start,
  action,
  reason = false,
  note,
  busy,
  error,
  onClose,
  onSave,
}: {
  title: string;
  label?: string;
  start?: number;
  action: string;
  reason?: boolean;
  note?: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (quantity: number, reason: string) => Promise<void>;
}) {
  const formId = useId();
  return (
    <Modal
      title={title}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {action}
        </DialogActions>
      }
    >
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void onSave(Math.round(Number(f.get('quantity') ?? 0)), String(f.get('reason') ?? '').trim());
        }}
      >
        {label && (
          <label>
            {label}
            <input name="quantity" type="number" min="0" required defaultValue={start} />
          </label>
        )}
        {reason && (
          <label>
            Reason
            <input name="reason" maxLength={200} required />
          </label>
        )}
      </form>
      {note && <p className="muted">{note}</p>}
    </Modal>
  );
}

function EndDialog({
  item,
  title,
  busy,
  error,
  onClose,
  onSave,
}: {
  item: PartnerItem;
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (endRule: string) => Promise<void>;
}) {
  const formId = useId();
  const [rule, setRule] = useState<string>(item.endRule);
  return (
    <Modal
      title={`End: ${title}`}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          End agreement
        </DialogActions>
      }
    >
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(rule);
        }}
      >
        <label>
          The {item.onHand} left in stock
          <select aria-label="The stock left" value={rule} onChange={(e) => setRule(e.target.value)}>
            {END_RULES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </form>
      <p className="muted">
        The agreement's choice is selected. Record the money (a sale to the partner, or the write-off) as
        usual.
      </p>
    </Modal>
  );
}
