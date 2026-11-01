import Icon from './Icon';
import { branchesOf, MAIN, newBranchId } from './branches.mjs';

type Branch = {
  id: string;
  name: string;
  address: string;
  phone: string;
  archived: boolean;
  kind?: 'branch' | 'store';
};
export type BranchStaff = { userId: string; name: string; role: string; rank: number; archived?: boolean };

/**
 * Business Settings → Branches: the business's branches (each with its own address and phone for
 * receipts) and which branches each staff member works in. Records are shared by the business; each
 * one belongs to the branch where it was made.
 */
export default function BranchesSettings({
  branches,
  access,
  staff,
  onBranches,
  onAccess,
  pricing,
  onPricing,
}: {
  pricing: 'shared' | 'perBranch';
  onPricing: (next: 'shared' | 'perBranch') => void;
  branches: Branch[];
  access: Record<string, string[]>;
  /** null while loading or where the staff list is not available. */
  staff: BranchStaff[] | null;
  onBranches: (next: Branch[]) => void;
  onAccess: (next: Record<string, string[]>) => void;
}) {
  const list: Branch[] = branchesOf({ branches });
  const active = list.filter((b) => !b.archived);
  const change = (id: string, patch: Partial<Branch>) =>
    onBranches(list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const memberAccess = (userId: string) => access[userId] ?? [MAIN];
  const setMember = (userId: string, next: string[]) => {
    const copy = { ...access };
    if (!next.length || (next.length === 1 && next[0] === MAIN)) delete copy[userId];
    else copy[userId] = next;
    onAccess(copy);
  };
  return (
    <>
      <p>
        A store keeps stock that branches draw from; record what comes in there and transfer it to branches
        from the Materials page. Every branch shares your customers, services and settings. Sales, jobs,
        payments, expenses, the drawer and what a customer owes belong to the branch where they happen. Each
        device works in one branch.
      </p>
      <div className="branch-list">
        {list.map((b, i) => (
          <div key={b.id} className={`branch-row${b.archived ? ' archived' : ''}`}>
            <div className="form-grid">
              <label>
                {i === 0 ? 'Main branch name' : b.kind === 'store' ? 'Store name' : 'Branch name'}
                <input
                  aria-label={`Branch ${i + 1} name`}
                  maxLength={80}
                  required
                  value={b.name}
                  onChange={(e) => change(b.id, { name: e.target.value })}
                />
              </label>
              <label>
                Phone on this branch's receipts
                <input
                  type="tel"
                  aria-label={`Branch ${i + 1} phone`}
                  maxLength={80}
                  placeholder="Business phone"
                  value={b.phone}
                  onChange={(e) => change(b.id, { phone: e.target.value })}
                />
              </label>
              <label>
                Address on this branch's receipts
                <input
                  aria-label={`Branch ${i + 1} address`}
                  maxLength={300}
                  placeholder="Business address"
                  value={b.address}
                  onChange={(e) => change(b.id, { address: e.target.value })}
                />
              </label>
            </div>
            {i > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() => change(b.id, { archived: !b.archived })}
              >
                <Icon name={b.archived ? 'restore' : 'archive'} />{' '}
                {b.archived ? 'Open again' : 'Close branch'}
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          onBranches([...list, { id: newBranchId(), name: '', address: '', phone: '', archived: false }])
        }
      >
        <Icon name="add" /> Add branch
      </button>{' '}
      <button
        type="button"
        className="secondary"
        onClick={() =>
          onBranches([
            ...list,
            { id: newBranchId(), name: '', address: '', phone: '', archived: false, kind: 'store' },
          ])
        }
      >
        <Icon name="add" /> Add store
      </button>
      {active.length > 1 && (
        <>
          <h3>Prices</h3>
          <label className="check-label">
            <input
              type="radio"
              name="branchPricing"
              checked={pricing === 'shared'}
              onChange={() => onPricing('shared')}
            />
            Same prices in every branch
          </label>
          <label className="check-label">
            <input
              type="radio"
              name="branchPricing"
              checked={pricing === 'perBranch'}
              onChange={() => onPricing('perBranch')}
            />
            Each branch can set its own prices
          </label>
          <p className="muted">
            With its own prices, a branch other than the main one uses <strong>Price here</strong> on the
            Services page for any item; items without a branch price use the business price.
          </p>
          <h3>Who works where</h3>
          <p className="muted">
            Staff work in the branches ticked here; anyone not set works in the main branch.{' '}
            <strong>Every branch</strong> is for the business owner: they see and can work in all branches.
            Developer always can.
          </p>
          {staff === null ? (
            <p className="muted">The staff list loads when you are online.</p>
          ) : (
            <div className="table-wrap">
              <table aria-label="Branch access">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Every branch</th>
                    {active.map((b) => (
                      <th key={b.id}>{b.name || 'New branch'}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff
                    .filter((s) => !s.archived && s.rank < 4)
                    .map((s) => {
                      const mine = memberAccess(s.userId);
                      const all = mine.includes('*');
                      return (
                        <tr key={s.userId}>
                          <td>
                            {s.name}
                            <small>{s.role}</small>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${s.name} works in every branch`}
                              checked={all}
                              onChange={(e) => setMember(s.userId, e.target.checked ? ['*'] : [MAIN])}
                            />
                          </td>
                          {active.map((b) => (
                            <td key={b.id}>
                              <input
                                type="checkbox"
                                aria-label={`${s.name} works in ${b.name || 'the new branch'}`}
                                disabled={all}
                                checked={all || mine.includes(b.id)}
                                onChange={(e) =>
                                  setMember(
                                    s.userId,
                                    e.target.checked
                                      ? [...mine.filter((id) => id !== '*'), b.id]
                                      : mine.filter((id) => id !== b.id),
                                  )
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
