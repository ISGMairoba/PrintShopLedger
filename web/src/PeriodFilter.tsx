import { dashboardRange } from './dashboard.mjs';

export type Period = { preset: string; from: string; to: string };

/** A period showing everything (only offered where `allowAll` is set). */
export const allDates = (): Period => ({ preset: 'all', from: '', to: '' });
export const periodOf = (preset: string): Period =>
  preset === 'all' ? allDates() : { preset, ...dashboardRange(preset) };

/** The Dashboard's period choices, shared by list pages. Dates are business days in Lagos. */
export default function PeriodFilter({
  value,
  onChange,
  allowAll = false,
  label = 'Period',
}: {
  value: Period;
  onChange: (value: Period) => void;
  allowAll?: boolean;
  label?: string;
}) {
  return (
    <>
      <label>
        {label}
        <select
          aria-label={label}
          value={value.preset}
          onChange={(e) =>
            onChange(
              e.target.value === 'custom'
                ? { ...value, preset: 'custom', ...(value.preset === 'all' ? dashboardRange('30days') : {}) }
                : periodOf(e.target.value),
            )
          }
        >
          {allowAll && <option value="all">All dates</option>}
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">This month</option>
          <option value="30days">Last 30 days</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      {value.preset !== 'all' && (
        <>
          <label>
            From
            <input
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, preset: 'custom', from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, preset: 'custom', to: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}
