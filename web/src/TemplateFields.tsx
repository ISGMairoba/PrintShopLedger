import type { PricingTemplate, TemplateSnapshot } from './types';
import { currency } from './receipts.mjs';

export function TemplateInputs({
  template,
  value,
  onChange,
}: {
  template: PricingTemplate;
  value: Record<string, number | string>;
  onChange: (value: Record<string, number | string>) => void;
}) {
  return (
    <>
      {template.inputs.map((i) => (
        <label key={i.key}>
          {i.label}
          {i.kind === 'choice' ? (
            <select
              value={value[i.key] ?? i.default}
              onChange={(e) => onChange({ ...value, [i.key]: e.target.value })}
            >
              {i.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="number"
              required
              min={i.min}
              max={i.max}
              step="0.001"
              value={value[i.key] ?? i.default}
              onChange={(e) => onChange({ ...value, [i.key]: e.target.value })}
            />
          )}
        </label>
      ))}
    </>
  );
}
export function TemplateBreakdown({ snapshot }: { snapshot: TemplateSnapshot }) {
  return (
    <details className="template-breakdown">
      <summary>Component breakdown · {snapshot.components.length} items</summary>
      <p className="muted">
        {snapshot.template.name} · Version {snapshot.template.version}
      </p>
      <ul>
        {snapshot.components.map((c) => (
          <li key={c.id}>
            <span>
              <strong>{c.label}</strong>
              <small>
                {c.service} · {c.quantity}
                {c.requireSize ? ` × ${c.width} × ${c.height}` : ''}
                {c.materialId
                  ? ` · Stock: ${c.materialNeeded} ${c.measurementUnit}`
                  : ' · No stock deduction'}
              </small>
            </span>
            <strong>{currency(c.amount)}</strong>
          </li>
        ))}
      </ul>
    </details>
  );
}
