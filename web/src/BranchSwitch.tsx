import SearchSelect from './SearchSelect';
/** My Account → Branch: which branch this device works in (shown when there is a choice). */
export default function BranchSwitch({
  branches,
  activeId,
  activeName,
  pending,
  onChange,
}: {
  branches: { id: string; name: string }[];
  activeId: string;
  activeName: string;
  /** Unsent work on this device: switching waits until it has synced. */
  pending: number;
  onChange: (id: string, name: string) => void;
}) {
  return (
    <section className="panel editor branch-switch" aria-labelledby="branch-switch-title">
      <h2 id="branch-switch-title">Branch</h2>
      <p className="muted">
        This device works in <strong>{activeName}</strong>. Work recorded here belongs to that branch.
      </p>
      <label>
        Switch this device to
        <SearchSelect
          label="Switch this device to"
          value={activeId}
          disabled={pending > 0}
          onChange={(id) => onChange(id, branches.find((b) => b.id === id)?.name ?? '')}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
        />
        {pending > 0 && <small>Wait until all work on this device has synced before switching.</small>}
      </label>
    </section>
  );
}
