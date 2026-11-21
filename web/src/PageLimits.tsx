import SearchSelect from './SearchSelect';
import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { pages, rankPages, roleNames } from './page-access.mjs';
import { useWords } from './Words';

// Page access, layers 2 and 3 (layer 1 is Developer's Page access tab):
// * BranchPages: the General Manager turns pages off for Cashier, Admin or Manager at one branch.
// * PersonPages: a Manager or above turns pages off for one person of a lower rank.
// Neither can give a page the rank does not already have.

export type PageLimits = { branches: Record<string, string[]>; people: Record<string, string[]> };
type Configured = Record<string, string[]> | undefined;

export function PersonPages({
  name,
  rank,
  configured,
  current,
  busy,
  onSave,
  onClose,
}: {
  name: string;
  rank: number;
  configured: Configured;
  current: string[] | undefined;
  busy: boolean;
  onSave: (pages: string[] | null) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const choices: string[] = rankPages(configured, rank).filter((page: string) => page !== 'My Account');
  const [on, setOn] = useState<string[]>(() => choices.filter((page) => !current || current.includes(page)));
  const [error, setError] = useState('');
  const all = on.length === choices.length;
  async function save(pagesOn: string[] | null) {
    setError('');
    try {
      await onSave(pagesOn);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save pages.');
    }
  }
  return (
    <Modal title={`Pages: ${name}`} busy={busy} onClose={onClose}>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <p>
        {name} can open the pages a {roleNames[rank as 1]} can open. Turn off any they should not see. My
        Account is always available.
      </p>
      {choices.length === 0 ? (
        <p className="muted">A {roleNames[rank as 1]} can open only My Account.</p>
      ) : (
        <fieldset className="page-limit-list" disabled={busy}>
          <legend>Pages {name} can open</legend>
          {choices.map((page) => (
            <label key={page} className="check-label">
              <input
                type="checkbox"
                checked={on.includes(page)}
                onChange={(e) => setOn(e.target.checked ? [...on, page] : on.filter((p) => p !== page))}
              />
              {w(page)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="material-actions">
        <button disabled={busy} onClick={() => void save(all ? null : [...on, 'My Account'])}>
          <Icon name="save" /> {busy ? 'Saving…' : 'Save pages'}
        </button>
        {current && (
          <button className="secondary" disabled={busy} onClick={() => void save(null)}>
            <Icon name="restore" /> Use every {roleNames[rank as 1]} page
          </button>
        )}
        <button className="secondary" disabled={busy} onClick={onClose}>
          <Icon name="close" /> Cancel
        </button>
      </div>
    </Modal>
  );
}

const RANKS = [1, 2, 3] as const;
export function BranchPages({
  branches,
  configured,
  current,
  busy,
  onSave,
  onClose,
}: {
  branches: { id: string; name: string }[];
  configured: Configured;
  current: Record<string, string[]>;
  busy: boolean;
  /** Saves one rank at one branch (null: every page the rank has). */
  onSave: (branch: string, rank: number, pages: string[] | null) => Promise<void>;
  onClose: () => void;
}) {
  const { w } = useWords();
  const [branch, setBranch] = useState(branches[0]?.id ?? 'main');
  const allowed = Object.fromEntries(
    RANKS.map((rank) => [rank, rankPages(configured, rank).filter((p: string) => p !== 'My Account')]),
  ) as Record<number, string[]>;
  const start = (id: string) =>
    Object.fromEntries(
      RANKS.map((rank) => [
        rank,
        allowed[rank].filter((p) => !current[`${id}:${rank}`] || current[`${id}:${rank}`].includes(p)),
      ]),
    ) as Record<number, string[]>;
  const [on, setOn] = useState<Record<number, string[]>>(() => start(branch));
  const [error, setError] = useState('');
  const shown = pages.filter(
    (page) => page !== 'My Account' && RANKS.some((rank) => allowed[rank].includes(page)),
  );
  async function save() {
    setError('');
    try {
      for (const rank of RANKS) {
        const all = on[rank].length === allowed[rank].length;
        const before = current[`${branch}:${rank}`];
        if (all && !before) continue;
        await onSave(branch, rank, all ? null : [...on[rank], 'My Account']);
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save pages.');
    }
  }
  return (
    <Modal title="Pages at each branch" busy={busy} onClose={onClose}>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <p>
        Turn off pages Cashiers, Admins or Managers should not open at a branch. Ticked pages are the ones
        their rank can open (set by Developer in Page access); My Account is always available.
      </p>
      <label>
        Branch
        <SearchSelect
          label="Branch"
          value={branch}
          disabled={busy}
          onChange={(next) => {
            setBranch(next);
            setOn(start(next));
          }}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
        />
      </label>
      <div className="table-wrap">
        <table className="access-matrix" aria-label="Pages at this branch by rank">
          <thead>
            <tr>
              <th>Page</th>
              {RANKS.map((rank) => (
                <th key={rank}>{roleNames[rank]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((page) => (
              <tr key={page}>
                <td>{w(page)}</td>
                {RANKS.map((rank) => (
                  <td key={rank}>
                    {allowed[rank].includes(page) ? (
                      <input
                        type="checkbox"
                        aria-label={`${roleNames[rank]} at this branch: ${page}`}
                        disabled={busy}
                        checked={on[rank].includes(page)}
                        onChange={(e) =>
                          setOn({
                            ...on,
                            [rank]: e.target.checked
                              ? [...on[rank], page]
                              : on[rank].filter((p) => p !== page),
                          })
                        }
                      />
                    ) : (
                      <span className="muted" title="Their rank cannot open this page">
                        –
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="material-actions">
        <button disabled={busy} onClick={() => void save()}>
          <Icon name="save" /> {busy ? 'Saving…' : 'Save pages'}
        </button>
        <button className="secondary" disabled={busy} onClick={onClose}>
          <Icon name="close" /> Cancel
        </button>
      </div>
    </Modal>
  );
}
