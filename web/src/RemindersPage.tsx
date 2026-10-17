import { useEffect, useState } from 'react';
import Icon from './Icon';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import { useFeedback, useFeedbackMessage } from './Feedback';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { customerStatement, reportFileName, statementSections } from './reports.mjs';
import { owingCustomers, reminderEvent, reminderMessage } from './reminders.mjs';
import { nameSections } from './report-words';
import type { ReportSection } from './export-csv';
import type { Branding } from './useBusinessBranding';
import type { Ledger, ReminderEvent } from './types';

type Row = ReturnType<typeof owingCustomers>[number];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Customers who owe money, oldest first, with a reminder that sends their statement. */
export default function RemindersPage({
  ledger,
  ready,
  busy,
  actor,
  branding,
  onSave,
}: {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  branding: Branding;
  onSave: (event: ReminderEvent) => Promise<void>;
}) {
  const { w, terms } = useWords();
  const notify = useFeedback();
  const [error, setError] = useFeedbackMessage('error');
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState('');
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./report-pdf');
    void import('./share-pdf');
  }, []);
  const sorting = useTableSort<Row>('oldest', 'asc');
  const all = owingCustomers(ledger);
  const rows = sorting.sortRows(
    all.filter((r) => `${r.name} ${r.phone}`.toLowerCase().includes(query.trim().toLowerCase())),
    {
      name: (r) => r.name,
      owed: (r) => r.owed,
      oldest: (r) => r.oldest,
      reminded: (r) => r.lastReminder?.remindedAt ?? '',
    },
  );
  const total = all.reduce((n, r) => n + r.owed, 0);
  async function remind(row: Row) {
    if (busy || sending) return;
    setSending(row.customerId);
    setError('');
    try {
      const statement = customerStatement(ledger, row.customerId, row.oldest, today());
      const company = branding.businessName || '';
      const title = 'Customer statement';
      const subtitle = [
        `${statement.customer.name} (${statement.customer.code})${statement.customer.phone ? ' - ' + statement.customer.phone : ''}`,
        `Period: ${statement.from} to ${statement.to}`,
        'Balances are current as of the generated time, including later payments and corrections.',
      ].map(w);
      const sections = nameSections(
        statementSections(statement, { money: currency, unit: '' }) as ReportSection[],
        terms,
      );
      const [{ createReportPdf }, { sharePdf, shareResult }] = await Promise.all([
        import('./report-pdf'),
        import('./share-pdf'),
      ]);
      const doc = createReportPdf(branding.businessName ? branding : company, {
        title,
        subtitle,
        sections,
        generatedAt: new Date().toISOString(),
      });
      const result = await sharePdf(doc, reportFileName('Statement', row.name, today()), {
        title: `Statement for ${row.name}`,
        text: reminderMessage(row, company),
        phone: row.phone,
      });
      if (result === 'cancelled') return;
      await onSave(reminderEvent(row, result === 'shared' ? 'whatsapp' : 'download', actor) as ReminderEvent);
      notify(`${shareResult(result)} Reminder recorded for ${row.name}.`, 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare the reminder.');
    } finally {
      setSending('');
    }
  }
  return (
    <>
      <section className="stats">
        <article>
          <span>Customers owing</span>
          <strong>{all.length}</strong>
          <small>{w('With unpaid jobs')}</small>
        </article>
        <article>
          <span>Total owed</span>
          <strong>{currency(total)}</strong>
          <small>Across all customers</small>
        </article>
        <article>
          <span>Owed over 30 days</span>
          <strong>{currency(all.filter((r) => r.age > 30).reduce((n, r) => n + r.owed, 0))}</strong>
          <small>{all.filter((r) => r.age > 30).length} customers</small>
        </article>
      </section>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search customers owing"
            placeholder="Search name or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <p className="muted panel-note">
          Remind sends a friendly WhatsApp message with the customer's statement attached (on a computer the
          statement downloads and WhatsApp opens ready to attach it). Each reminder is recorded below.
        </p>
        {!ready ? (
          <div className="empty">Loading.</div>
        ) : !rows.length ? (
          <div className="empty">
            <h2>{query ? 'No matching customers' : 'Nobody owes money'}</h2>
            <p>{w('Customers with unpaid jobs appear here, oldest debt first.')}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: 'Customer', details: [2, 3] },
                { index: 1, label: 'Owed' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={{ 2: 'Owed since', 3: 'Last reminded' }}
            >
              <table aria-label="Customers owing">
                <thead>
                  <tr>
                    <SortHeader label="Customer" column="name" sort={sorting} />
                    <SortHeader label="Owed" column="owed" sort={sorting} />
                    <SortHeader label="Owed since" column="oldest" sort={sorting} />
                    <SortHeader label="Last reminded" column="reminded" sort={sorting} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.customerId}>
                      <td>
                        <strong>{r.name}</strong>
                        <small>
                          {r.phone || 'No phone'}
                          {r.archived ? ' · Archived' : ''}
                        </small>
                      </td>
                      <td>
                        <strong>{currency(r.owed)}</strong>
                        <small>{w(`${r.jobs} unpaid ${r.jobs === 1 ? 'job' : 'jobs'}`)}</small>
                      </td>
                      <td>
                        {r.oldest}
                        <small className={r.age > 30 ? 'danger-text' : ''}>
                          {r.age === 0 ? 'Today' : `${r.age} ${r.age === 1 ? 'day' : 'days'} ago`}
                        </small>
                      </td>
                      <td>
                        {r.lastReminder ? (
                          <>
                            {when(r.lastReminder.remindedAt)}
                            <small>
                              {r.lastReminder.remindedByLabel} · {currency(r.lastReminder.amountOwed)} owed
                              then
                            </small>
                          </>
                        ) : (
                          <small>Not yet</small>
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          disabled={busy || !!sending}
                          onClick={() => void remind(r)}
                        >
                          <Icon name="share" /> {sending === r.customerId ? 'Preparing…' : 'Remind'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
      </section>
    </>
  );
}
