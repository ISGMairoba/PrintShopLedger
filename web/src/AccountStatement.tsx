import { useMemo, useState } from 'react';
import Icon from './Icon';
import PeriodFilter, { allDates, periodLabel, type Period } from './PeriodFilter';
import { accountStatement, filterStatement, STATEMENT_TYPES } from './account-statement.mjs';
import { currency } from './app/shared';
import { downloadCsv, type ReportSection } from './export-csv';
import type { Branding } from './useBusinessBranding';
import type { Ledger, MoneyAccount } from './types';

type Row = ReturnType<typeof accountStatement>['rows'][number];
type Kind = keyof typeof STATEMENT_TYPES;

/**
 * Accounts → an account's Transactions: every movement in one list (sales, expenses, refunds, loans,
 * owner money, transfers, reconciliations), each with a type tag and the running balance. It can be
 * filtered, sorted, printed (PDF) and exported (spreadsheet). Entries made on the Accounts page can be
 * corrected from their row.
 */
export default function AccountStatement({
  ledger,
  account,
  accountName,
  payeeName,
  brand,
  busy,
  onCorrect,
}: {
  ledger: Ledger;
  account: MoneyAccount;
  accountName: (id: string) => string;
  payeeName: (id: string) => string;
  brand: string | Branding;
  busy: boolean;
  /** Correct a transfer, reconciliation or money in / out entry. */
  onCorrect: (entry: Record<string, any>) => void;
}) {
  const [period, setPeriod] = useState<Period>(allDates());
  const [type, setType] = useState(''),
    [direction, setDirection] = useState(''),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState('date-desc'),
    [filtersOpen, setFiltersOpen] = useState(false),
    [error, setError] = useState('');
  const statement = useMemo(
    () => accountStatement(ledger, account.id, { from: period.from, to: period.to, accountName, payeeName }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ledger, account.id, period.from, period.to],
  );
  const rows: Row[] = filterStatement(statement.rows, { type, direction, search, sort });
  const filtered = !!(type || direction || search.trim());
  const activeFilters = [type, direction, period.preset !== 'all' ? 'p' : ''].filter(Boolean).length;
  const day = (d: string) =>
    new Date(d + 'T12:00:00+01:00').toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const company = typeof brand === 'string' ? brand : brand.businessName;
  const title = `Account statement · ${account.name}`;
  const subtitle = () => [
    period.preset === 'all' ? 'All dates' : periodLabel(period),
    `Opening ${currency(statement.opening)} · Closing ${currency(statement.closing)}`,
    ...(filtered ? ['Filtered list: the balance column is the account balance after each line.'] : []),
  ];
  const sections = (): ReportSection[] => [
    {
      title: 'Transactions',
      columns: ['Date', 'Type', 'Details', 'Method', 'In', 'Out', 'Balance'],
      widths: [1.1, 1.1, 3, 1.2, 1.1, 1.1, 1.2],
      numeric: [4, 5, 6],
      rows: rows.map((r) => [
        r.paidOn,
        STATEMENT_TYPES[r.type as Kind],
        [r.label, r.entry?.reason, r.beforeOpening ? 'before the opening date' : '']
          .filter(Boolean)
          .join(' · '),
        r.method,
        r.amountIn ? currency(r.amountIn) : '',
        r.amountOut ? currency(r.amountOut) : '',
        r.beforeOpening ? '' : currency(r.balance),
      ]),
    },
  ];
  const totals = [
    period.preset === 'all'
      ? `Opening ${currency(account.openingBalance)} on ${day(account.openingDate)}`
      : `Opening ${currency(statement.opening)}`,
    `In ${currency(statement.received)}`,
    `Out ${currency(statement.paid)}`,
    `${period.preset === 'all' ? 'Expected now' : 'Closing'} ${currency(statement.closing)}`,
  ].join(' · ');
  /** "Corrected by Ada on …: was ₦… on … · reason" under an entry. */
  const correction = (c: Record<string, any>, e: Record<string, any>) => {
    const by = `${c.cancelled ? 'Cancelled' : 'Corrected'} by ${c.correctedByLabel}`;
    const when = new Date(c.correctedAt).toLocaleString('en-NG');
    const was = currency(c.before.actualBalance ?? c.before.amount);
    const moved = c.before.paidOn && c.before.paidOn !== e.paidOn ? ` on ${c.before.paidOn}` : '';
    return `${by} on ${when}: was ${was}${moved} · ${c.reason}`;
  };
  const file = `Account-statement-${account.name.replace(/[^A-Za-z0-9]+/g, '-')}`;
  async function pdf() {
    setError('');
    try {
      const { downloadReportPdf } = await import('./report-pdf');
      downloadReportPdf(file, brand, {
        title,
        subtitle: subtitle(),
        sections: sections(),
        generatedAt: new Date().toISOString(),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the PDF.');
    }
  }
  function spreadsheet() {
    setError('');
    try {
      downloadCsv(file, [company, title, ...subtitle()], sections());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the spreadsheet.');
    }
  }
  return (
    <>
      <div className="toolbar history-toolbar statement-toolbar">
        <input
          aria-label="Search transactions"
          placeholder="Search details, method or note"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className={`secondary filter-button${activeFilters ? ' filtered' : ''}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <Icon name="sort" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void pdf()}>
          <Icon name="services" /> Print (PDF)
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={spreadsheet}>
          <Icon name="export" /> Spreadsheet
        </button>
      </div>
      {filtersOpen && (
        <div className="period-panel filter-panel" role="group" aria-label="Transaction filters">
          <PeriodFilter value={period} onChange={setPeriod} allowAll />
          <label>
            Type
            <select aria-label="Transaction type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              {Object.entries(STATEMENT_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            In or out
            <select aria-label="In or out" value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">In and out</option>
              <option value="in">Money in</option>
              <option value="out">Money out</option>
            </select>
          </label>
          <label>
            Sort
            <select aria-label="Sort transactions" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="date-desc">Newest first</option>
              <option value="date">Oldest first</option>
              <option value="amount-desc">Largest first</option>
              <option value="amount">Smallest first</option>
            </select>
          </label>
        </div>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <p className="statement-totals">{totals}</p>
      <div className="table-wrap">
        <table className="statement-table">
          <thead>
            <tr>
              <th>Date / details</th>
              <th>In</th>
              <th>Out</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  {filtered ? 'No transactions match these filters.' : 'No transactions in this period.'}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const e = r.entry;
              return (
                <tr key={r.id} className={e?.cancelled ? 'cancelled-entry' : undefined}>
                  <td>
                    <span className={`badge statement-tag tag-${r.type}`}>
                      {STATEMENT_TYPES[r.type as Kind]}
                    </span>{' '}
                    {day(r.paidOn)}
                    <small>
                      {r.label}
                      {r.method ? ` · ${r.method}` : ''}
                      {e?.reason ? ` · ${e.reason}` : ''}
                      {e?.modifiedByLabel ? ` · ${e.modifiedByLabel}` : ''}
                      {e?.cancelled ? ' · Cancelled' : ''}
                    </small>
                    {r.beforeOpening && (
                      <small>Before the opening date · covered by the opening balance</small>
                    )}
                    {(e?.corrections ?? []).map((c: Record<string, any>, i: number) => (
                      <small key={i} className="entry-correction">
                        {correction(c, e)}
                      </small>
                    ))}
                    {e && !e.cancelled && !e.carryForward && e.action !== 'carried' && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => onCorrect(e)}
                      >
                        <Icon name="edit" /> Correct
                      </button>
                    )}
                  </td>
                  <td>{r.amountIn ? currency(r.amountIn) : '—'}</td>
                  <td>{r.amountOut ? currency(r.amountOut) : '—'}</td>
                  <td>{r.beforeOpening ? '—' : currency(r.balance)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
