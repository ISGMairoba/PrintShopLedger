import { allBranchesLedger } from './branches.mjs';
import { paymentName } from './business-options.mjs';
import Modal from './Modal';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import { customerBalance, jobBalance } from './domain.mjs';
import { walletBalance } from './checkout.mjs';
import { currency } from './receipts.mjs';
import type { Customer, Ledger, Job, Payment } from './types';
import { useWords } from './Words';
export default function CustomerAccount({
  customer,
  ledger,
  onClose,
  branches,
}: {
  customer: Customer;
  ledger: Ledger;
  onClose: () => void;
  /** The owner's view: each branch's records, to show the customer's account in every branch. */
  branches?: { id: string; name: string; ledger: Ledger }[];
}) {
  const { w } = useWords();
  const js = useTableSort<Job>('date', 'desc'),
    ps = useTableSort<Payment>('date', 'desc');
  const jobs = js.sortRows(
    ledger.jobs.filter((j) => j.customerId === customer.id),
    {
      description: (j) => j.description,
      amount: (j) => j.amount,
      paid: (j) => jobBalance(ledger, j).paid,
      outstanding: (j) => jobBalance(ledger, j).outstanding,
      date: (j) => Date.parse(j.createdAt),
      id: (j) => j.id,
    },
  );
  const payments = ps.sortRows(
    ledger.payments.filter((p) => p.customerId === customer.id),
    {
      date: (p) => p.paidOn,
      method: paymentName,
      amount: (p) => p.amount,
      used: (p) => p.walletUsed ?? 0,
      added: (p) => p.walletAdded ?? 0,
      jobs: (p) => p.allocations.map((a) => a.jobId).join(','),
    },
  );
  return (
    <Modal title={`Account: ${customer.name}`} wide onClose={onClose}>
      <p>
        Phone: {customer.phone} · Outstanding: {currency(customerBalance(ledger, customer.id))} · Wallet:{' '}
        {currency(walletBalance(ledger, customer.id))}
      </p>
      {branches && branches.length > 1 && (
        <>
          <h3>Across branches</h3>
          <div className="table-wrap">
            <table aria-label="Account across branches">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th className="numeric">{w('Jobs')}</th>
                  <th className="numeric">Outstanding</th>
                  <th className="numeric">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const own = allBranchesLedger(b.ledger);
                  return (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td className="numeric">
                        {own.jobs.filter((j) => j.customerId === customer.id).length}
                      </td>
                      <td className="numeric">{currency(customerBalance(own, customer.id))}</td>
                      <td className="numeric">{currency(walletBalance(own, customer.id))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>{w('Jobs')}</h3>
      <div className="table-wrap">
        <ResponsiveTable
          columns={[
            { index: 0, label: w('Job') },
            { index: 1, label: 'Amount', details: [2, 3] },
          ]}
          extraSortOptions={[
            { key: 'date', label: 'Created at' },
            { key: 'id', label: w('Job ID') },
          ]}
        >
          <table>
            <thead>
              <tr>
                <SortHeader label={w('Job')} column="description" sort={js} />
                <SortHeader label="Amount" column="amount" sort={js} />
                <SortHeader label="Paid" column="paid" sort={js} />
                <SortHeader label="Outstanding" column="outstanding" sort={js} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    {j.description}
                    <small>{j.id.slice(0, 8).toUpperCase()}</small>
                  </td>
                  <td>{currency(j.amount)}</td>
                  <td>{currency(jobBalance(ledger, j).paid)}</td>
                  <td>{currency(jobBalance(ledger, j).outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </div>
      <h3>Payments and wallet movements</h3>
      <div className="table-wrap">
        <ResponsiveTable
          columns={[
            { index: 0, label: 'Payment' },
            { index: 1, label: 'Received', details: [2, 3] },
            { index: 4, label: w('Jobs paid') },
          ]}
          extraSortOptions={[{ key: 'method', label: 'Method' }]}
        >
          <table>
            <thead>
              <tr>
                <SortHeader label="Date / method" column="date" sort={ps} />
                <SortHeader label="Money received" column="amount" sort={ps} />
                <SortHeader label="Wallet used" column="used" sort={ps} />
                <SortHeader label="Wallet added" column="added" sort={ps} />
                <SortHeader label={w('Jobs paid')} column="jobs" sort={ps} />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.paidOn} · {paymentName(p)}
                    {p.refundId && <small>Refund returned to customer</small>}
                  </td>
                  <td>{currency(p.amount)}</td>
                  <td>{currency(p.walletUsed ?? 0)}</td>
                  <td>{currency(p.walletAdded ?? 0)}</td>
                  <td>
                    {p.allocations.map((a) => (
                      <small key={a.jobId}>
                        {ledger.jobs.find((j) => j.id === a.jobId)?.description}: {currency(a.amount)}
                      </small>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      </div>
    </Modal>
  );
}
