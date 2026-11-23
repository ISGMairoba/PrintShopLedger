import { TEAM_DEFAULTS, teamSettings } from './team.mjs';

type TeamChoices = typeof TEAM_DEFAULTS;
const RANKS: [number, string][] = [
  [1, 'Cashier and above'],
  [2, 'Admin and above'],
  [3, 'Manager and above'],
  [4, 'General Manager and above'],
];

/** Business Settings → Jobs & payments → Team work (plans/job-assignment.md). */
export default function TeamWorkSettings({
  value,
  canSwitch,
  onChange,
}: {
  value: Partial<TeamChoices> | undefined;
  /** General Manager or higher: only they switch Team work on or off. */
  canSwitch: boolean;
  onChange: (next: Partial<TeamChoices> | undefined) => void;
}) {
  const t = teamSettings({ teamWork: value }) as TeamChoices;
  const set = (key: keyof TeamChoices, v: boolean | number) => {
    const next: Record<string, boolean | number> = { ...(value ?? {}), [key]: v };
    if (v === TEAM_DEFAULTS[key]) delete next[key];
    onChange(Object.keys(next).length ? (next as Partial<TeamChoices>) : undefined);
  };
  const check = (key: keyof TeamChoices, label: string, hint: string) => (
    <label className="check-label">
      <input
        type="checkbox"
        aria-label={label}
        checked={t[key] as boolean}
        onChange={(e) => set(key, e.target.checked)}
      />
      <span>
        {label}
        <small className="muted"> {hint}</small>
      </span>
    </label>
  );
  const rank = (key: keyof TeamChoices, label: string) => (
    <label>
      {label}
      <select aria-label={label} value={t[key] as number} onChange={(e) => set(key, Number(e.target.value))}>
        {RANKS.map(([n, name]) => (
          <option key={n} value={n}>
            {name}
            {n === TEAM_DEFAULTS[key] ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
  const days = (key: keyof TeamChoices, label: string) => (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        min="0"
        max="90"
        step="1"
        value={t[key] as number}
        onChange={(e) => set(key, Math.max(0, Math.min(90, Math.round(Number(e.target.value) || 0))))}
      />
    </label>
  );
  return (
    <>
      <h3>Team work</h3>
      <label className="check-label">
        <input
          type="checkbox"
          aria-label="Track team work"
          checked={t.enabled}
          disabled={!canSwitch}
          onChange={(e) => set('enabled', e.target.checked)}
        />
        <span>
          Track team work
          <small className="muted">
            {' '}
            Assign jobs and stages to your team, record who did each stage and when, and confirm the work.
            {canSwitch ? '' : ' Only a General Manager or higher can switch this on or off.'}
          </small>
        </span>
      </label>
      {t.enabled && (
        <>
          {check(
            'askDoneBy',
            'Ask "Done by" on every stage move',
            'When off, the people assigned are credited automatically.',
          )}
          {check(
            'needsConfirming',
            'Work records need confirming',
            'Recorded work counts in reports once someone confirms it.',
          )}
          {rank('assignRank', 'Who can assign work')}
          {rank('othersRank', 'Who can record work for someone else')}
          {rank('earlierRank', 'Who can set an earlier "Done at"')}
          {rank('confirmRank', 'Who confirms work')}
          {days('doneAtDays', '"Done at" can be up to (days back)')}
        </>
      )}
    </>
  );
}
