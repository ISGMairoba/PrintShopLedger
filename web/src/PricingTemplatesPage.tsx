import { useEffect, useState, type FormEvent } from 'react';
import TemplateEditor from './PricingTemplatesEditor';
import Modal from './Modal';
import Icon from './Icon';
import { TemplateCalculator, useTemplateAudit, type TemplateStart } from './TemplateFields';
import CurrencyInput from './CurrencyInput';
import type { Ledger, PricingTemplate, ServiceEvent } from './types';
import type { Branding } from './useBusinessBranding';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import {
  canonical,
  consumptionUnit,
  costRate,
  hasCost,
  newTemplate,
  suggestCostKey,
  templateProblem,
  validCosting,
} from './pricing-templates.mjs';
import { currency } from './receipts.mjs';
import { money } from './domain.mjs';
import { useWords } from './Words';

export default function PricingTemplatesPage({
  settings,
  version,
  ledger,
  ready,
  online,
  demo,
  actor,
  onSave,
  onReload,
  onSaveService,
  canManage,
  canEditCosts,
  onStartCheckout,
  onStartQuotation,
}: {
  settings: Branding;
  version: number;
  ledger: Ledger;
  ready: boolean;
  online: boolean;
  demo: boolean;
  actor: { id: string; label: string };
  onSave: (settings: Branding, version: number) => Promise<unknown>;
  onReload: () => Promise<void>;
  onSaveService: (event: ServiceEvent) => Promise<void>;
  /** May build and change templates (Business Settings access). */
  canManage: boolean;
  /** May add private costs (catalogue editing). */
  canEditCosts: boolean;
  onStartCheckout: (start: TemplateStart) => void;
  onStartQuotation: (start: TemplateStart) => void;
}) {
  const { w } = useWords();
  const [editing, setEditing] = useState<PricingTemplate | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [message, setMessage, tone] = useFeedbackMessage('success');
  const [costKey, setCostKey] = useState('');
  // Costs are shown to the ranks allowed to see template costs, and to template managers.
  const canSeeCosts = useTemplateAudit() || canManage;
  const tabs = [
    ['price', 'Price & compare'],
    ...(canManage ? [['templates', 'Templates']] : []),
    ...(canSeeCosts ? [['costs', 'Costs']] : []),
  ];
  const [tab, setTab] = useState('price');
  const canSave = ready && (demo || online) && !busy;
  const pricing = settings.pricing;
  useEffect(() => {
    if (!online && !demo && canManage && tab === 'templates')
      setMessage('Connect to save pricing templates.', 'error');
  }, [online, demo, canManage, tab, setMessage]);
  async function saveTemplates(templates: PricingTemplate[], done: string) {
    setBusy(true);
    setMessage('');
    try {
      await onSave({ ...settings, pricing: { ...pricing, templates } }, version);
      setMessage(done);
      return true;
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(text, 'error');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function saveOne(t: PricingTemplate) {
    const old = pricing.templates.find((x) => x.id === t.id);
    if (
      pricing.templates.some(
        (x) => x.id !== t.id && !x.archived && x.name.toLowerCase() === t.name.toLowerCase(),
      )
    )
      throw Error('Use a name that no other template has.');
    if (!old && pricing.templates.filter((x) => !x.archived).length >= (pricing.maxTemplates ?? 100))
      throw Error(
        `Your limit is ${pricing.maxTemplates ?? 100} active templates. Archive one or raise the limit in Business Settings.`,
      );
    const next = { ...t, version: old ? old.version + 1 : 1 };
    await saveTemplates(
      old ? pricing.templates.map((x) => (x.id === t.id ? next : x)) : [...pricing.templates, next],
      `${t.name} saved (version ${next.version}).`,
    );
    setEditing(null);
  }
  async function addCost(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    try {
      const description = String(data.get('description')).trim();
      if (!description) throw Error('Enter a name.');
      const costing = validCosting({
        key: String(data.get('key')).trim(),
        amount: money(String(data.get('amount'))),
        per: Number(data.get('per') || 1),
        unit: String(data.get('unit') ?? ''),
      });
      setBusy(true);
      await onSaveService({
        id: crypto.randomUUID(),
        kind: 'service.created',
        data: {
          id: crypto.randomUUID(),
          description,
          materialId: String(data.get('material')) || null,
          price: 0,
          shelfItem: false,
          private: true,
          costing,
          modifiedBy: actor.id,
          modifiedByLabel: actor.label,
          modifiedAt: new Date().toISOString(),
        },
      });
      setAdding(false);
      setMessage(`${description} added. Use ${costing!.key} in formulas.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setBusy(false);
    }
  }
  const visible = pricing.templates.filter((t) => showArchived || !t.archived);
  const costs = ledger.services.filter((s) => !s.archived && s.costing);
  return (
    <section className="panel editor" aria-label="Pricing templates">
      <FeedbackBanner message={message} tone={tone} />
      <div className="settings-tabs" role="tablist" aria-label="Pricing templates sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : 'secondary'}
            onClick={() => {
              setTab(key);
              setMessage('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'price' && (
        <TemplateCalculator
          ledger={ledger}
          templates={pricing.templates}
          onCheckout={onStartCheckout}
          onQuotation={onStartQuotation}
        />
      )}
      {tab === 'templates' && canManage && (
        <>
          <section className="stats">
            <article>
              <span>Active templates</span>
              <strong>{pricing.templates.filter((t) => !t.archived).length}</strong>
              <small>Limit {pricing.maxTemplates ?? 100} (Business Settings)</small>
            </article>
          </section>
          <div className="toolbar">
            <button
              type="button"
              disabled={!canSave}
              onClick={() => setEditing(newTemplate() as PricingTemplate)}
            >
              <Icon name="add" /> New template
            </button>
            <label className="check-label">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                void onReload().catch((e) => setMessage(e instanceof Error ? e.message : String(e), 'error'))
              }
            >
              Reload saved templates
            </button>
          </div>
          {!visible.length ? (
            <div className="empty">
              <h2>No templates yet</h2>
              <p>
                A template works out a price from costs: enter the variables staff fill in, the quantities to
                calculate, the expenses, and your markup or margin.
              </p>
            </div>
          ) : (
            <div className="template-grid">
              {visible.map((t) => {
                const problem = t.archived ? '' : templateProblem(ledger, t);
                return (
                  <article className="template-card" key={t.id}>
                    <div className="row-between">
                      <span className="badge">{t.category || 'General'}</span>
                      <small>v{t.version}</small>
                    </div>
                    <h3>{t.name}</h3>
                    <p className="muted">{t.description || 'A reusable pricing template.'}</p>
                    <small>
                      {t.variables.length} editable variables · {t.computed.length} computed variables ·{' '}
                      {t.expenses.length} expenses · {t.pricing.rate}% {t.pricing.method}
                    </small>
                    {t.archived && <span className="badge unpaid">Archived</span>}
                    {problem && (
                      <p className="danger-text" role="status">
                        Cannot price with today's costs: {problem}
                      </p>
                    )}
                    <div className="material-actions">
                      {!t.archived && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={!canSave}
                          onClick={() => setEditing(structuredClone(t))}
                        >
                          <Icon name="edit" /> Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-button"
                        disabled={!canSave}
                        onClick={() =>
                          setEditing({
                            ...structuredClone(t),
                            id: crypto.randomUUID(),
                            name: `${t.name} copy`,
                            version: 1,
                            archived: false,
                          })
                        }
                      >
                        <Icon name="copy" /> Duplicate
                      </button>
                      <button
                        type="button"
                        className={`text-button ${t.archived ? '' : 'danger-text'}`}
                        disabled={!canSave}
                        onClick={() =>
                          void saveTemplates(
                            pricing.templates.map((x) =>
                              x.id === t.id ? { ...x, archived: !x.archived, version: x.version + 1 } : x,
                            ),
                            `${t.name} ${t.archived ? 'restored' : 'archived'}.`,
                          ).catch(() => {})
                        }
                      >
                        <Icon name={t.archived ? 'restore' : 'archive'} />{' '}
                        {t.archived ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {tab === 'costs' && canSeeCosts && (
        <>
          <section className="stats">
            <article>
              <span>Costs for formulas</span>
              <strong>{costs.length}</strong>
              <small>{w('Services')} with a template cost</small>
            </article>
            <article>
              <span>Private costs</span>
              <strong>{costs.filter((s) => s.private).length}</strong>
              <small>Used in templates only, never sold</small>
            </article>
          </section>
          {canEditCosts && (
            <div className="toolbar">
              <button
                type="button"
                className="secondary"
                disabled={!ready || busy}
                onClick={() => {
                  setAdding(true);
                  setCostKey('');
                }}
              >
                <Icon name="add" /> Add private cost
              </button>
            </div>
          )}
          <h3>Costs used in formulas</h3>
          <p className="muted">
            Any {w('service')} or product with a template cost can be used in formulas by its formula name.
            Private ones are for templates only and never appear at checkout. Change costs on the{' '}
            {w('Services')} page; saved orders and quotations keep the costs they were priced with.
          </p>
          {!costs.length ? (
            <p className="empty">
              No costs yet. Add a template cost to a {w('service')}, or use Add private cost.
            </p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Costs used in formulas">
                <thead>
                  <tr>
                    <th>{w('Item')}</th>
                    <th>Formula name</th>
                    <th className="numeric">Cost</th>
                    <th className="numeric">Per unit</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.map((s) => {
                    const unit = consumptionUnit(s, ledger.materials);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.description}
                          <small>
                            {s.private ? 'Private · templates only' : 'Also sold'}
                            {s.materialId
                              ? ` · ${w('stock item')}: ${ledger.materials.find((m) => m.id === s.materialId)?.name}`
                              : ''}
                          </small>
                        </td>
                        <td>
                          {hasCost(s.costing) && <code>{s.costing!.key}</code>}
                          {!s.private && (
                            <small>
                              <code>{s.costing!.key}_price</code> = {currency(s.price)} selling price
                            </small>
                          )}
                        </td>
                        <td className="numeric">
                          {hasCost(s.costing) ? (
                            <>
                              {currency(s.costing!.amount!)} for {s.costing!.per} {unit}
                              {s.costing!.unit ? <small>bought as {s.costing!.unit}</small> : null}
                            </>
                          ) : (
                            <small>No cost · selling price only</small>
                          )}
                        </td>
                        <td className="numeric">
                          {hasCost(s.costing) ? `₦${canonical(costRate(s.costing!))} / ${unit}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && (
        <TemplateEditor
          key={editing.id}
          initial={editing}
          ledger={ledger}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={saveOne}
        />
      )}
      {adding && (
        <Modal title="Add private cost" busy={busy} onClose={() => setAdding(false)}>
          <p className="muted">
            A cost used only in templates (for example labour, plates, electricity or a material you never
            sell on its own). It is saved as a private {w('service')} and never offered at checkout.
          </p>
          <form onSubmit={addCost}>
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Name
                  <input
                    name="description"
                    maxLength={500}
                    required
                    placeholder="e.g. Printing plate"
                    onChange={(e) => setCostKey(suggestCostKey(e.target.value, ledger.services))}
                  />
                </label>
                <label>
                  Formula name
                  <input name="key" required value={costKey} onChange={(e) => setCostKey(e.target.value)} />
                  <small>Lowercase letters, numbers and _.</small>
                </label>
                <label>
                  Cost (₦)
                  <CurrencyInput name="amount" required />
                </label>
                <label>
                  For how many units
                  <input name="per" type="number" min="0.001" step="0.001" defaultValue="1" required />
                  <small>e.g. ₦5,000 for 500 sheets: enter 500.</small>
                </label>
                <label>
                  Bought as (optional)
                  <input name="unit" maxLength={40} placeholder="e.g. ream" />
                </label>
                <label>
                  {w('Stock item')} (optional)
                  <select name="material" defaultValue="">
                    <option value="">No stock — cost only</option>
                    {ledger.materials
                      .filter((m) => !m.archived)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.measurementUnit})
                        </option>
                      ))}
                  </select>
                  <small>Link a material when templates should take it out of stock.</small>
                </label>
              </div>
              <button type="submit">
                <Icon name="save" /> {busy ? 'Saving...' : 'Save private cost'}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
    </section>
  );
}
