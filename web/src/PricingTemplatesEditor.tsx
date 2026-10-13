import { useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import type { Ledger, PricingSettings, PricingTemplate } from './types';
import {
  bookTemplate,
  validatePricingSettings,
  parseFormula,
  templateDefaults,
} from './pricing-templates.mjs';
import { quoteLine } from './checkout.mjs';
import { currency } from './receipts.mjs';
import { TemplateBreakdown, TemplateInputs } from './TemplateFields';

function FormulaField({
  label,
  value,
  variables,
  onChange,
}: {
  label: string;
  value: string;
  variables: string[];
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  let error = '';
  try {
    parseFormula(value);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const insert = (token: string) => {
    const el = input.current;
    const at = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? at;
    onChange(value.slice(0, at) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return (
    <div className="formula-field">
      <label>
        {label}
        <input
          ref={input}
          value={value}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </label>
      <details>
        <summary>Insert variable or function</summary>
        <div className="formula-tokens">
          {[
            ...variables,
            ' + ',
            ' - ',
            ' * ',
            ' / ',
            '(',
            ')',
            'ceil(',
            'floor(',
            'round(',
            'min(',
            'max(',
          ].map((t) => (
            <button type="button" className="secondary compact" key={t} onClick={() => insert(t)}>
              {t}
            </button>
          ))}
        </div>
      </details>
      {error && <small className="danger-text">{error}</small>}
    </div>
  );
}
export default function PricingTemplatesEditor({
  value,
  ledger,
  onChange,
}: {
  value: PricingSettings;
  ledger: Ledger;
  onChange: (value: PricingSettings) => void;
}) {
  const [editing, setEditing] = useState<PricingTemplate | null>(null);
  const [error, setError] = useState('');
  function update(template: PricingTemplate) {
    const validated = validatePricingSettings({ enabled: value.enabled, templates: [template] }).templates[0];
    onChange({
      ...value,
      templates: value.templates.some((t) => t.id === template.id)
        ? value.templates.map((t) => (t.id === template.id ? validated : t))
        : [...value.templates, validated],
    });
    setEditing(null);
  }
  return (
    <>
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        Enable pricing templates
      </label>
      <p className="muted">
        Combine existing items and services into one job. Selling prices are added together; no extra profit
        is added. Stock is deducted only when checkout is saved.
      </p>
      <div className="toolbar">
        <button
          type="button"
          className="secondary"
          disabled={value.templates.length >= 30}
          onClick={() => {
            setError('');
            setEditing({
              id: crypto.randomUUID(),
              name: '',
              version: 1,
              archived: false,
              inputs: [],
              derived: [],
              components: [
                { id: crypto.randomUUID(), label: '', serviceId: '', quantityFormula: 'quantity' },
              ],
            });
          }}
        >
          <Icon name="add" />
          New template
        </button>
        <button
          type="button"
          className="secondary"
          disabled={value.templates.length >= 30}
          onClick={() => {
            setError('');
            setEditing(bookTemplate());
          }}
        >
          Start with book
        </button>
      </div>
      <div className="template-list">
        {value.templates.map((t) => (
          <div className="template-list-row" key={t.id}>
            <span>
              <strong>{t.name}</strong>
              <small>
                Version {t.version} · {t.components.length} components{t.archived ? ' · Archived' : ''}
              </small>
            </span>
            <div className="job-bulk-actions">
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  setError('');
                  setEditing(structuredClone(t));
                }}
              >
                <Icon name="edit" />
                Edit
              </button>
              <button
                type="button"
                className="secondary compact"
                onClick={() =>
                  onChange({
                    ...value,
                    templates: value.templates.map((i) =>
                      i.id === t.id ? { ...i, archived: !i.archived, version: i.version + 1 } : i,
                    ),
                  })
                }
              >
                {t.archived ? 'Restore' : 'Archive'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      {editing && (
        <TemplateEditor
          template={editing}
          ledger={ledger}
          existing={value.templates.some((t) => t.id === editing.id)}
          onClose={() => setEditing(null)}
          onSave={update}
        />
      )}
    </>
  );
}
function TemplateEditor({
  template,
  ledger,
  existing,
  onClose,
  onSave,
}: {
  template: PricingTemplate;
  ledger: Ledger;
  existing: boolean;
  onClose: () => void;
  onSave: (template: PricingTemplate) => void;
}) {
  const [draft, setDraft] = useState(template),
    [error, setError] = useState(''),
    [previewInputs, setPreviewInputs] = useState<Record<string, number | string>>({}),
    [quantity, setQuantity] = useState('1');
  const variables = [
    'quantity',
    ...draft.inputs.map((i) => i.key),
    ...draft.derived.map((i) => i.key),
  ].filter(Boolean);
  const services = ledger.services.filter(
    (s) =>
      !s.archived &&
      (s.materialId === null || ledger.materials.some((m) => m.id === s.materialId && !m.archived)),
  );
  let preview: ReturnType<typeof quoteLine> | null = null,
    previewError = '';
  try {
    const t = validatePricingSettings({ enabled: true, templates: [draft] }).templates[0];
    preview = quoteLine(
      { ...ledger, pricing: { enabled: true, templates: [t] } },
      {
        id: 'preview',
        serviceId: t.id,
        description: t.name,
        quantity,
        templateInputs: Object.keys(previewInputs).length ? previewInputs : templateDefaults(t),
        source: 'Template',
        sourceNote: '',
      },
    );
  } catch (e) {
    previewError = e instanceof Error ? e.message : String(e);
  }
  return (
    <Modal title={existing ? 'Edit pricing template' : 'New pricing template'} wide onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            onSave({ ...draft, version: existing ? template.version + 1 : 1 });
          } catch (c) {
            setError(c instanceof Error ? c.message : String(c));
          }
        }}
      >
        <label>
          Template name
          <input
            required
            maxLength={160}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <h3>Customer inputs</h3>
        <p className="muted">Quantity is already available. Add only what staff need to enter.</p>
        {draft.inputs.map((i, index) => (
          <section className="cart-line" key={index}>
            <div className="form-grid">
              <label>
                Label
                <input
                  required
                  value={i.label}
                  maxLength={80}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      inputs: draft.inputs.map((v, n) => (n === index ? { ...v, label: e.target.value } : v)),
                    })
                  }
                />
              </label>
              <label>
                Variable name
                <input
                  required
                  value={i.key}
                  pattern="[a-zA-Z][a-zA-Z0-9_]*"
                  maxLength={40}
                  onChange={(e) => {
                    setPreviewInputs({});
                    setDraft({
                      ...draft,
                      inputs: draft.inputs.map((v, n) => (n === index ? { ...v, key: e.target.value } : v)),
                    });
                  }}
                />
              </label>
              <label>
                Input type
                <select
                  value={i.kind}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      inputs: draft.inputs.map((v, n) => (n === index ? { ...v, kind: e.target.value } : v)),
                    })
                  }
                >
                  <option value="number">Number</option>
                  <option value="choice">Named options</option>
                </select>
              </label>
              {(['min', 'max', 'default'] as const).map((k) => (
                <label key={k}>
                  {k === 'min' ? 'Minimum' : k === 'max' ? 'Maximum' : 'Default'}
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={i[k]}
                    onChange={(e) => {
                      setPreviewInputs({});
                      setDraft({
                        ...draft,
                        inputs: draft.inputs.map((v, n) =>
                          n === index ? { ...v, [k]: Number(e.target.value) } : v,
                        ),
                      });
                    }}
                  />
                </label>
              ))}
            </div>
            {i.kind === 'choice' && (
              <>
                <p className="muted">Each label has a numeric value that formulas can use.</p>
                {i.options.map((o, n) => (
                  <div className="form-grid" key={n}>
                    <label>
                      Option label
                      <input
                        required
                        value={o.label}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            inputs: draft.inputs.map((v, x) =>
                              x === index
                                ? {
                                    ...v,
                                    options: v.options.map((a, b) =>
                                      b === n ? { ...a, label: e.target.value } : a,
                                    ),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Option value
                      <input
                        type="number"
                        step="0.001"
                        required
                        value={o.value}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            inputs: draft.inputs.map((v, x) =>
                              x === index
                                ? {
                                    ...v,
                                    options: v.options.map((a, b) =>
                                      b === n ? { ...a, value: Number(e.target.value) } : a,
                                    ),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button danger-text"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          inputs: draft.inputs.map((v, x) =>
                            x === index ? { ...v, options: v.options.filter((_, b) => b !== n) } : v,
                          ),
                        })
                      }
                    >
                      Remove option
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={i.options.length >= 20}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      inputs: draft.inputs.map((v, n) =>
                        n === index ? { ...v, options: [...v.options, { label: '', value: 1 }] } : v,
                      ),
                    })
                  }
                >
                  Add option
                </button>
              </>
            )}
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => {
                setPreviewInputs({});
                setDraft({ ...draft, inputs: draft.inputs.filter((_, n) => n !== index) });
              }}
            >
              Remove input
            </button>
          </section>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={draft.inputs.length >= 20}
          onClick={() =>
            setDraft({
              ...draft,
              inputs: [
                ...draft.inputs,
                { key: '', label: '', kind: 'number', min: 0, max: 1000000, default: 1, options: [] },
              ],
            })
          }
        >
          <Icon name="add" />
          Add input
        </button>
        <details>
          <summary>Reusable calculations (optional)</summary>
          <p className="muted">
            Calculate sheets, batches or other quantities. Calculations can refer to each other; circular
            references are rejected.
          </p>
          {draft.derived.map((d, index) => (
            <section className="cart-line" key={index}>
              <div className="form-grid">
                <label>
                  Calculation label
                  <input
                    required
                    value={d.label}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        derived: draft.derived.map((v, n) =>
                          n === index ? { ...v, label: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Calculation variable
                  <input
                    required
                    value={d.key}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        derived: draft.derived.map((v, n) =>
                          n === index ? { ...v, key: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <FormulaField
                label="Calculation formula"
                value={d.formula}
                variables={variables.filter((v) => v !== d.key)}
                onChange={(formula) =>
                  setDraft({
                    ...draft,
                    derived: draft.derived.map((v, n) => (n === index ? { ...v, formula } : v)),
                  })
                }
              />
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setDraft({ ...draft, derived: draft.derived.filter((_, n) => n !== index) })}
              >
                Remove calculation
              </button>
            </section>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={draft.derived.length >= 20}
            onClick={() =>
              setDraft({ ...draft, derived: [...draft.derived, { key: '', label: '', formula: 'quantity' }] })
            }
          >
            Add calculation
          </button>
        </details>
        <h3>Components</h3>
        <p className="muted">
          Choose a retail item or service and calculate how much it needs. A service's linked material is
          deducted automatically; do not add it again as another component.
        </p>
        {draft.components.map((c, index) => {
          const service = ledger.services.find((s) => s.id === c.serviceId),
            material = ledger.materials.find((m) => m.id === service?.materialId);
          const change = (patch: Partial<PricingTemplate['components'][number]>) =>
            setDraft({
              ...draft,
              components: draft.components.map((v, n) => (n === index ? { ...v, ...patch } : v)),
            });
          return (
            <section className="cart-line" key={c.id}>
              <div className="form-grid">
                <label>
                  Component label
                  <input
                    required
                    maxLength={80}
                    value={c.label}
                    onChange={(e) => change({ label: e.target.value })}
                  />
                </label>
                <label>
                  Item or service
                  <select
                    required
                    value={c.serviceId}
                    onChange={(e) => change({ serviceId: e.target.value })}
                  >
                    <option value="">Choose item or service</option>
                    {services.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.description} — {currency(s.price)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <FormulaField
                label="Component quantity formula"
                value={c.quantityFormula}
                variables={variables}
                onChange={(quantityFormula) => change({ quantityFormula })}
              />
              {material?.requireSize && (
                <div className="form-grid">
                  <FormulaField
                    label="Width formula"
                    value={c.widthFormula ?? ''}
                    variables={variables}
                    onChange={(widthFormula) => change({ widthFormula })}
                  />
                  <FormulaField
                    label="Height formula"
                    value={c.heightFormula ?? ''}
                    variables={variables}
                    onChange={(heightFormula) => change({ heightFormula })}
                  />
                </div>
              )}
              <p className="muted">
                {material ? `Stock: ${material.name} (${material.measurementUnit})` : 'No linked material'}
              </p>
              <button
                type="button"
                className="text-button danger-text"
                disabled={draft.components.length === 1}
                onClick={() =>
                  setDraft({ ...draft, components: draft.components.filter((_, n) => n !== index) })
                }
              >
                Remove component
              </button>
            </section>
          );
        })}
        <button
          type="button"
          className="secondary"
          disabled={draft.components.length >= 20}
          onClick={() =>
            setDraft({
              ...draft,
              components: [
                ...draft.components,
                { id: crypto.randomUUID(), label: '', serviceId: '', quantityFormula: 'quantity' },
              ],
            })
          }
        >
          <Icon name="add" />
          Add component
        </button>
        <h3>Test price</h3>
        <div className="form-grid">
          <label>
            Preview quantity
            <input
              type="number"
              min="0.001"
              max="1000000"
              step="0.001"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <TemplateInputs template={draft} value={previewInputs} onChange={setPreviewInputs} />
        </div>
        {preview ? (
          <>
            <p className="cart-total">
              <strong>{currency(preview.amount)}</strong>
            </p>
            <TemplateBreakdown snapshot={preview.templateSnapshot} />
          </>
        ) : (
          <p className="muted">{previewError}</p>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <p className="muted">
          Adding this template updates the settings draft. Save pricing templates to make it available at
          checkout.
        </p>
        <button disabled={!preview}>Use template</button>
      </form>
    </Modal>
  );
}
