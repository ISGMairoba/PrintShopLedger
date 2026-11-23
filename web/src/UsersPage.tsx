import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import ResponsiveTable from './ResponsiveTable';
import { auditCells, auditHeaders } from './AuditColumns';
import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './cloud';
import Modal from './Modal';
import Icon from './Icon';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { SortHeader, useTableSort } from './TableSort';
import { accessLevels, GENERAL_MANAGER, rankValues, canManage, userCode, validateUser } from './users.mjs';
import { useWords } from './Words';
import { BranchPages, PersonPages, type PageLimits } from './PageLimits';

type Staff = {
  id: string;
  userId: string;
  name: string;
  username: string;
  rank: number;
  role: 'admin' | 'manager' | 'cashier' | 'general_manager' | 'developer';
  accessLevel: number;
  archived: boolean;
  version: number;
  lastLogin: string | null;
  /** Branches they work in: ids, or '*' for every branch. */
  branches?: string[];
  createdAt: string;
  createdByLabel: string;
  modifiedAt: string;
  modifiedByLabel: string;
};
type Props = {
  shopId: string;
  actorId: string;
  businessUserId: string;
  role: string;
  online: boolean;
  demo: boolean;
  onChanged: () => void;
  /** With branches: each branch's name (the Branches column), and this device's branch. */
  branchNames?: Record<string, string>;
  branchName?: string;
  /** Developer's pages for each rank (Page access), for the page limits. */
  pageAccess?: Record<string, string[]>;
  /** Every branch (General Manager and above set pages at each one). */
  branches?: { id: string; name: string }[];
  /** After page limits change (this device asks again for its own). */
  onPagesChanged?: () => void;
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Never';
export default function UsersPage({
  shopId,
  actorId,
  businessUserId,
  role,
  online,
  demo,
  onChanged,
  branchNames,
  branchName,
  pageAccess,
  branches,
  onPagesChanged,
}: Props) {
  const worksIn = (user: { branches?: string[] }) =>
    !user.branches?.length
      ? (branchNames?.main ?? 'Main branch')
      : user.branches.includes('*')
        ? 'Every branch'
        : user.branches.map((id) => branchNames?.[id] ?? 'Closed branch').join(', ');
  const { w } = useWords();
  const [users, setUsers] = useState<Staff[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [audit, setAudit] = useState(false);
  const [editor, setEditor] = useState<Staff | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Staff | null>(null);
  const [accessChange, setAccessChange] = useState<Staff | null>(null);
  const [passwordReset, setPasswordReset] = useState<Staff | null>(null);
  const [pinClear, setPinClear] = useState<Staff | null>(null);
  const [pagesFor, setPagesFor] = useState<Staff | null>(null);
  const [branchPages, setBranchPages] = useState(false);
  const [limits, setLimits] = useState<PageLimits>({ branches: {}, people: {} });
  const [error, setError, errorTone] = useFeedbackMessage('error');
  const [formError, setFormError] = useFeedbackMessage('error');
  const sorting = useTableSort<Staff>('name');
  const allowed = !demo && ['admin', 'manager', 'general_manager', 'developer'].includes(role);
  const actor = users.find((user) => user.userId === actorId);
  const editable = (user: Staff) => !!actor && canManage(actor, user);
  // Only Developer can archive or revoke the General Manager.
  const canTurnOff = (user: Staff) => editable(user) && (user.role !== GENERAL_MANAGER || actor?.rank === 5);
  // Page limits: Managers and above for people of a lower rank; General Managers for each branch.
  const canSetPages = (user: Staff) => !!actor && actor.rank >= 3 && user.rank < actor.rank;
  // Clear someone's PIN (they set a new one at their next sign-in): Admins and above, for someone of
  // lower rank; a Developer for anyone. The server checks the same.
  const canClearPin = (user: Staff) =>
    !!actor &&
    actor.accessLevel >= 2 &&
    user.userId !== actorId &&
    (actor.rank === 5 || user.rank < actor.rank);
  const canSetBranchPages = !!actor && actor.rank >= 4 && !!branches && branches.length > 1;
  async function loadLimits() {
    if (!supabase || !online || !actor || actor.rank < 3) return;
    const { data, error: failure } = await supabase.rpc('list_page_limits', { p_shop: shopId });
    if (failure) throw new Error(failure.message);
    setLimits({ branches: data?.branches ?? {}, people: data?.people ?? {} });
  }
  useEffect(() => {
    void loadLimits().catch(() => {});
  }, [shopId, online, actor?.rank]);
  async function savePersonPages(user: Staff, pages: string[] | null) {
    if (!supabase) throw new Error('Connect to the internet to set pages.');
    setBusy(true);
    try {
      const { error: failure } = await supabase.rpc('set_person_page_limit', {
        p_shop: shopId,
        p_user: user.userId,
        p_pages: pages,
      });
      if (failure) throw new Error(failure.message);
      await loadLimits();
      onPagesChanged?.();
    } finally {
      setBusy(false);
    }
  }
  async function saveBranchPages(branch: string, rank: number, pages: string[] | null) {
    if (!supabase) throw new Error('Connect to the internet to set pages.');
    setBusy(true);
    try {
      const { error: failure } = await supabase.rpc('set_branch_page_limit', {
        p_shop: shopId,
        p_branch: branch,
        p_rank: rank,
        p_pages: pages,
      });
      if (failure) throw new Error(failure.message);
      await loadLimits();
      onPagesChanged?.();
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (!supabase || !allowed || !online) return;
    const { data, error: failure } = await supabase.rpc('list_shop_users', { p_shop: shopId });
    if (failure) throw new Error(failure.message);
    setUsers(data ?? []);
    setReady(true);
  }
  useEffect(() => {
    let active = true;
    setReady(false);
    setUsers([]);
    if (supabase && allowed && online) {
      Promise.resolve(supabase.rpc('list_shop_users', { p_shop: shopId }))
        .then(({ data, error: failure }) => {
          if (!active) return;
          if (failure) setError(failure.message);
          else {
            setUsers(data ?? []);
            setReady(true);
          }
        })
        .catch((cause) => {
          if (active) setError(String(cause));
        });
    }
    return () => {
      active = false;
    };
  }, [shopId, allowed, online]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !supabase || !online || !allowed) return;
    setFormError('');
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const profile = validateUser(Object.fromEntries(form.entries()));
      if (editor === 'new') {
        const password = String(form.get('password') ?? '');
        if (password.length < 12 || password.length > 128)
          throw new Error('Use a password with 12–128 characters.');
        const { data, error: failure } = await supabase.functions.invoke('manage-users', {
          body: { shopId, ...profile, password },
        });
        if (failure) {
          const response = (failure as { context?: Response }).context;
          let message = failure.message;
          if (response)
            try {
              message = (await response.json()).error || message;
            } catch {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
      } else if (editor) {
        const { error: failure } = await supabase.rpc('save_shop_user', {
          p_shop: shopId,
          p_action: 'edit',
          p_data: { ...profile, id: editor.id, version: editor.version },
        });
        if (failure) throw new Error(failure.message);
      }
      setEditor(null);
      setError('User saved.', 'success');
      if (editor !== 'new' && editor?.userId === actorId) onChanged();
      try {
        await load();
      } catch {
        setError('User saved. Refresh to load the latest list.', 'warning');
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }
  async function changeStatus() {
    if (!confirmation || busy || !supabase || !online || !allowed) return;
    setBusy(true);
    setFormError('');
    try {
      const { error: failure } = await supabase.rpc('save_shop_user', {
        p_shop: shopId,
        p_action: confirmation.archived ? 'restore' : 'archive',
        p_data: { id: confirmation.id, version: confirmation.version },
      });
      if (failure) throw new Error(failure.message);
      setConfirmation(null);
      setError('User status saved.', 'success');
      if (confirmation.userId === actorId) onChanged();
      try {
        await load();
      } catch {
        setError('Status saved. Refresh to load the latest list.', 'warning');
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save user.');
    } finally {
      setBusy(false);
    }
  }
  async function changeAccess() {
    if (!accessChange || busy || !supabase || !online) return;
    setBusy(true);
    setFormError('');
    try {
      const { error: failure } = await supabase.rpc('save_shop_user', {
        p_shop: shopId,
        p_action: accessChange.accessLevel === 0 ? 'grant' : 'revoke',
        p_data: { id: accessChange.id, version: accessChange.version },
      });
      if (failure) throw new Error(failure.message);
      setAccessChange(null);
      setError('User access saved.', 'success');
      if (accessChange.userId === actorId) onChanged();
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not change access.');
    } finally {
      setBusy(false);
    }
  }
  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordReset || busy || !supabase || !online) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password !== data.get('confirmation')) {
      setFormError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      const { data: result, error: failure } = await supabase.functions.invoke('manage-users', {
        body: {
          action: 'reset-password',
          shopId,
          id: passwordReset.id,
          version: passwordReset.version,
          password,
        },
      });
      if (failure) {
        let message = failure.message;
        const response = (failure as { context?: Response }).context;
        if (response)
          try {
            message = (await response.json()).error || message;
          } catch {}
        throw new Error(message);
      }
      if (result?.error) throw new Error(result.error);
      setPasswordReset(null);
      setError(result?.warning ?? 'Password reset successfully.', result?.warning ? 'warning' : 'success');
      await load();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  }
  const visible = sorting.sortRows(
    users.filter(
      (user) =>
        (filter === 'all' || user.archived === (filter === 'archived')) &&
        [
          userCode(user.id),
          user.name,
          user.username,
          user.rank,
          accessLevels[user.role],
          String(user.accessLevel),
          date(user.lastLogin),
          user.createdByLabel,
          date(user.createdAt),
          user.modifiedByLabel,
          date(user.modifiedAt),
          user.archived ? 'Archived' : 'Active',
          branchNames ? worksIn(user) : '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ),
    {
      id: (u) => userCode(u.id),
      name: (u) => u.name,
      username: (u) => u.username,
      rank: (u) => u.rank,
      role: (u) => u.accessLevel,
      lastLogin: (u) => (u.lastLogin ? Date.parse(u.lastLogin) : 0),
      status: (u) => u.archived,
      branches: (u) => worksIn(u),
      createdBy: (u) => u.createdByLabel,
      createdAt: (u) => Date.parse(u.createdAt),
      modifiedBy: (u) => u.modifiedByLabel,
      modifiedAt: (u) => Date.parse(u.modifiedAt),
    },
  );
  const heading = (column: string, label: string) => (
    <SortHeader column={column} label={label} sort={sorting} />
  );
  if (!allowed)
    return (
      <section className="panel">
        <div className="empty">
          <h2>{demo ? 'Sign in to manage users' : 'User management access required'}</h2>
          <p>
            {demo
              ? 'Users belong to a signed-in business workspace.'
              : 'Cashiers cannot access the Users page. Admins, Managers and Developers manage permitted users.'}
          </p>
        </div>
      </section>
    );
  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search users"
            placeholder="Search any user field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="User status" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All users</option>
          </select>
          <ToolbarActions
            more={
              <MenuToggle pressed={audit} icon="audit" onClick={() => setAudit(!audit)}>
                Audit view
              </MenuToggle>
            }
          >
            <button
              className="secondary"
              disabled={busy || !online}
              onClick={() => {
                setError('');
                void load().catch((cause) => setError(cause.message));
              }}
            >
              <Icon name="sync" /> Refresh
            </button>
            <button
              disabled={busy || !ready || !online}
              onClick={() => {
                setEditor('new');
                setFormError('');
              }}
            >
              <Icon name="add" /> Add user
            </button>
            {canSetBranchPages && (
              <button className="secondary" disabled={busy || !online} onClick={() => setBranchPages(true)}>
                <Icon name="settings" /> Pages at each branch
              </button>
            )}
          </ToolbarActions>
        </div>
        {!online && <div className="notice">Connect to the internet to manage user accounts.</div>}
        {branchNames && branchName && (
          <p className="muted">
            Showing the staff who work in {branchName}. Someone you add here works in {branchName}; the
            General Manager sets who works where in Business Settings → Branches.
          </p>
        )}
        <FeedbackBanner message={error} tone={errorTone} />
        {!ready ? (
          <div className="empty">{online ? 'Loading users…' : 'User management is available online.'}</div>
        ) : !visible.length ? (
          <div className="empty">No matching users.</div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: 'User', details: branchNames ? [1, 3, 4] : [1, 3] },
                { index: 2, label: 'Rank' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              labels={branchNames ? { 3: 'Status', 4: 'Branches' } : { 3: 'Status' }}
              extraSortOptions={[
                { key: 'id', label: 'User ID' },
                { key: 'lastLogin', label: 'Last login' },
              ]}
            >
              <table className="users-table">
                <thead>
                  <tr>
                    {heading('name', 'User')}
                    {heading('username', 'Username')}
                    {heading('rank', 'Rank')}
                    {heading('status', 'Status · last login')}
                    {branchNames && heading('branches', 'Branches')}
                    {audit && auditHeaders(sorting)}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        {user.userId === actorId ? ' (you)' : ''}
                        <small className="record-id">{userCode(user.id)}</small>
                      </td>
                      <td>{user.username}</td>
                      <td className="cell-fit">
                        {accessLevels[user.role]} ({user.rank})
                        {user.accessLevel === 0 && <small className="danger-text">Access revoked</small>}
                      </td>
                      <td className="cell-fit">
                        <span className={`badge ${user.archived ? 'unpaid' : 'paid'}`}>
                          {user.archived ? 'Archived' : 'Active'}
                        </span>
                        <small>Last login: {date(user.lastLogin)}</small>
                      </td>
                      {branchNames && <td>{worksIn(user)}</td>}
                      {audit && auditCells(user, date)}
                      <td>
                        <div className="material-actions">
                          {!user.archived && (
                            <button
                              className="text-button"
                              disabled={busy || !online || !editable(user)}
                              onClick={() => {
                                setEditor(user);
                                setFormError('');
                              }}
                            >
                              <Icon name="edit" /> Edit
                            </button>
                          )}
                          <button
                            className={`text-button ${user.archived ? '' : 'danger-text'}`}
                            disabled={busy || !online || !canTurnOff(user)}
                            onClick={() => {
                              setConfirmation(user);
                              setFormError('');
                            }}
                          >
                            <Icon name={user.archived ? 'restore' : 'archive'} />{' '}
                            {user.archived ? 'Restore' : 'Archive'}
                          </button>
                          {!user.archived && (
                            <>
                              <button
                                className="text-button"
                                disabled={busy || !online || !canTurnOff(user)}
                                onClick={() => {
                                  setAccessChange(user);
                                  setFormError('');
                                }}
                              >
                                <Icon name="account" />{' '}
                                {user.accessLevel === 0 ? 'Grant access' : 'Revoke access'}
                              </button>
                              <button
                                className="text-button"
                                disabled={busy || !online || !editable(user)}
                                onClick={() => {
                                  setPasswordReset(user);
                                  setFormError('');
                                }}
                              >
                                <Icon name="sync" /> Reset password
                              </button>
                              {canClearPin(user) && (
                                <button
                                  className="text-button"
                                  disabled={busy || !online}
                                  onClick={() => {
                                    setPinClear(user);
                                    setFormError('');
                                  }}
                                >
                                  <Icon name="lock" /> Clear PIN
                                </button>
                              )}
                              {canSetPages(user) && (
                                <button
                                  className="text-button"
                                  disabled={busy || !online}
                                  onClick={() => setPagesFor(user)}
                                >
                                  <Icon name="details" /> Pages
                                  {limits.people[user.userId] ? ' (limited)' : ''}
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
        <p className="muted">
          Rank: Cashier 1, Admin 2, Manager 3, General Manager 4, Developer 5. Revoking access sets it to 0
          and retains the rank. Managers cannot modify other Managers; the General Manager can. The General
          Manager is the business account and cannot be added here; only Developer can archive it or revoke
          its access. Only Developers can modify Developer profiles.
        </p>
      </section>
      {editor && (
        <Modal
          title={editor === 'new' ? 'Add user' : 'Edit user'}
          busy={busy}
          onClose={() => setEditor(null)}
        >
          {formError && (
            <div className="notice" role="alert">
              {formError}
            </div>
          )}
          <form className="form-grid" onSubmit={save}>
            <label>
              Name
              <input
                name="name"
                defaultValue={editor === 'new' ? '' : editor.name}
                maxLength={160}
                required
              />
            </label>
            <label>
              Username
              <input
                name="username"
                defaultValue={editor === 'new' ? '' : editor.username}
                minLength={3}
                maxLength={40}
                pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}"
                autoComplete="off"
                required
              />
            </label>
            <label>
              Rank
              <select aria-label="Rank" name="role" defaultValue={editor === 'new' ? 'cashier' : editor.role}>
                {Object.entries(accessLevels)
                  .filter(([value]) =>
                    // The General Manager rank stays with the business account: never given here.
                    editor !== 'new' && editor.role === GENERAL_MANAGER
                      ? value === GENERAL_MANAGER
                      : value !== GENERAL_MANAGER &&
                        rankValues[value as keyof typeof rankValues] <= (actor?.rank ?? 0),
                  )
                  .map(([value, label]) => (
                    <option value={value} key={value}>
                      {label} ({rankValues[value as keyof typeof rankValues]})
                    </option>
                  ))}
              </select>
            </label>
            {editor === 'new' && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}
            <p className="muted">
              Staff sign in with their username and password after the business is signed in. Passwords are
              stored as hashes by the authentication service.
            </p>
            <div className="material-actions">
              <button disabled={busy || !online}>
                <Icon name="save" /> {busy ? 'Saving…' : 'Save user'}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setEditor(null)}>
                <Icon name="close" /> Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={`${confirmation.archived ? 'Restore' : 'Archive'} ${confirmation.name}?`}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          {formError && (
            <div className="notice" role="alert">
              {formError}
            </div>
          )}
          <p>
            {confirmation.archived
              ? 'Restore this user profile? Any revoked access remains revoked.'
              : w(
                  'This user will lose access to this business. Existing jobs, payments and audit records will remain.',
                )}
          </p>
          <div className="material-actions">
            <button
              className={confirmation.archived ? '' : 'danger-button'}
              disabled={busy || !online}
              onClick={() => void changeStatus()}
            >
              <Icon name="archive" />{' '}
              {busy ? 'Saving…' : confirmation.archived ? 'Restore user' : 'Archive user'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              <Icon name="close" /> Cancel
            </button>
          </div>
        </Modal>
      )}
      {accessChange && (
        <Modal
          title={`${accessChange.accessLevel === 0 ? 'Grant' : 'Revoke'} access: ${accessChange.name}`}
          busy={busy}
          onClose={() => setAccessChange(null)}
        >
          {formError && (
            <div className="notice" role="alert">
              {formError}
            </div>
          )}
          <p>
            {accessChange.accessLevel === 0
              ? `Restore access to ${accessChange.rank}?`
              : 'Set access to 0? The user will retain their rank, but cannot sign in or access this business.'}
          </p>
          <div className="material-actions">
            <button
              disabled={busy || !online}
              className={accessChange.accessLevel === 0 ? '' : 'danger-button'}
              onClick={() => void changeAccess()}
            >
              <Icon name="account" />{' '}
              {busy ? 'Saving…' : accessChange.accessLevel === 0 ? 'Grant access' : 'Revoke access'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setAccessChange(null)}>
              <Icon name="close" /> Cancel
            </button>
          </div>
        </Modal>
      )}
      {pagesFor && (
        <PersonPages
          name={pagesFor.name}
          rank={pagesFor.rank}
          configured={pageAccess}
          current={limits.people[pagesFor.userId]}
          busy={busy}
          onSave={(pages) => savePersonPages(pagesFor, pages)}
          onClose={() => setPagesFor(null)}
        />
      )}
      {branchPages && branches && (
        <BranchPages
          branches={branches}
          configured={pageAccess}
          current={limits.branches}
          busy={busy}
          onSave={saveBranchPages}
          onClose={() => setBranchPages(false)}
        />
      )}
      {passwordReset && (
        <Modal
          title={`Reset password: ${passwordReset.name}`}
          busy={busy}
          onClose={() => setPasswordReset(null)}
        >
          {formError && (
            <div className="notice" role="alert">
              {formError}
            </div>
          )}
          <form onSubmit={resetPassword}>
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm password
              <input
                name="confirmation"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            {passwordReset.userId === businessUserId && (
              <p className="notice">
                This is the default business Manager. Resetting this password also changes the business email
                login password.
              </p>
            )}
            <p className="muted">
              The new password replaces the previous password. The password is hashed before storage.
            </p>
            <div className="material-actions">
              <button disabled={busy || !online}>
                <Icon name="sync" /> {busy ? 'Resetting…' : 'Reset password'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setPasswordReset(null)}
              >
                <Icon name="close" /> Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {pinClear && (
        <Modal
          title={`Clear PIN: ${pinClear.name}`}
          busy={busy}
          onClose={() => setPinClear(null)}
          footer={
            <>
              <button type="button" className="secondary" disabled={busy} onClick={() => setPinClear(null)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !online}
                onClick={async () => {
                  setBusy(true);
                  setFormError('');
                  try {
                    const { error: failure } = await supabase!.rpc('clear_member_pin', {
                      p_shop: shopId,
                      p_user: pinClear.userId,
                    });
                    if (failure) throw Error(failure.message);
                    setError(`${pinClear.name}'s PIN was cleared.`, 'success');
                    setPinClear(null);
                  } catch (failure) {
                    setFormError(failure instanceof Error ? failure.message : String(failure));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="lock" /> Clear PIN
              </button>
            </>
          }
        >
          {formError && (
            <div className="notice" role="alert">
              {formError}
            </div>
          )}
          <p>
            {`${pinClear.name} will set a new PIN the next time they sign in with their password. Their face/fingerprint unlock stops working on every device until they turn it on again. Use this when they forgot their PIN or someone else may know it.`}
          </p>
        </Modal>
      )}
    </>
  );
}
