import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { dashboardRange } from './dashboard.mjs';
import { defaultPeriods } from './business-branding.mjs';

export type Period = { preset: string; from: string; to: string };
export type PeriodPage = keyof ReturnType<typeof defaultPeriods>;

/** A period showing everything (only offered where `allowAll` is set). */
export const allDates = (): Period => ({ preset: 'all', from: '', to: '' });
export const periodOf = (preset: string): Period =>
  preset === 'all' ? allDates() : { preset, ...dashboardRange(preset) };

const presetLabels: Record<string, string> = {
  all: 'All dates',
  today: 'Today',
  week: 'Last 7 days',
  month: 'This month',
  '30days': 'Last 30 days',
};
const short = (day: string) =>
  day ? new Date(day + 'T12:00:00Z').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '…';
/** "Last 30 days", or "1 Oct – 12 Oct" for custom dates. */
export const periodLabel = (period: Period) =>
  presetLabels[period.preset] ?? `${short(period.from)} – ${short(period.to)}`;

/** The business's default period for each page (Business Settings → Jobs & payments). */
export const PeriodDefaultsContext = createContext(defaultPeriods());

/**
 * A page's period, starting at the business default. If the default arrives or changes after
 * the page opened (settings load in the background), it is applied unless someone already chose.
 */
export function usePeriod(page: PeriodPage) {
  const preset = useContext(PeriodDefaultsContext)[page];
  const [period, setPeriod] = useState(() => periodOf(preset));
  const chosen = useRef(false);
  useEffect(() => {
    if (!chosen.current) setPeriod(periodOf(preset));
  }, [preset]);
  const choose = (next: Period) => {
    chosen.current = true;
    setPeriod(next);
  };
  const reset = () => {
    chosen.current = false;
    setPeriod(periodOf(preset));
  };
  return [period, choose, reset] as const;
}

/** Period, From and To controls — the Dashboard's choices. Dates are business days in Lagos. */
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
      <label className="period-preset">
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
          <label className="period-day">
            From
            <input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => onChange({ ...value, preset: 'custom', from: e.target.value })}
            />
          </label>
          <label className="period-day">
            To
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => onChange({ ...value, preset: 'custom', to: e.target.value })}
            />
          </label>
        </>
      )}
    </>
  );
}

/**
 * A list page's date filter: a calendar button for the toolbar that opens the period controls
 * on their own row underneath. Returns the period plus the two pieces to place.
 */
export function useDateFilter(page: PeriodPage, { allowAll = true } = {}) {
  const [period, setPeriod, reset] = usePeriod(page);
  const [open, setOpen] = useState(false);
  const button = (
    <button
      type="button"
      className={`secondary date-filter-button${period.preset === 'all' ? '' : ' filtered'}`}
      aria-expanded={open}
      aria-label={`Dates: ${periodLabel(period)}`}
      onClick={() => setOpen(!open)}
    >
      <Icon name="calendar" /> {periodLabel(period)}
    </button>
  );
  const panel = open ? (
    <div className="period-panel" role="group" aria-label="Date filter">
      <PeriodFilter value={period} onChange={setPeriod} allowAll={allowAll} />
      <small>Dates use Africa/Lagos.</small>
    </div>
  ) : null;
  return { period, setPeriod, reset, button, panel };
}
