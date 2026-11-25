import { useContext } from 'react';
import { TEAM_DEFAULTS, teamPeople, teamSettings } from './team.mjs';
import { TeamContext } from './TeamContext';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useWords } from './Words';
import type { TeamPerson } from './types';

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
  showSwitch = true,
  switchOnly = false,
  onChange,
}: {
  value: Partial<TeamChoices> | undefined;
  /** General Manager or higher: only they switch Team work on or off. */
  canSwitch: boolean;
  /** The on/off switch (in Features); the Team work tab shows only the choices. */
  showSwitch?: boolean;
  /** Only the switch (the Features tab). */
  switchOnly?: boolean;
  onChange: (next: Partial<TeamChoices> | undefined) => void;
}) {
  const t = teamSettings({ teamWork: value }) as TeamChoices;
  const team = useContext(TeamContext);
  const options = useBusinessOptions();
  const { stage: stageName } = useWords();
  const people = (team ? teamPeople(team.ledger) : []) as TeamPerson[];
  // Work stages from the usual steps and every saved workflow.
  const stages = [
    ...new Set([
      ...(options.jobStages ?? []),
      ...(options.workflows ?? []).flatMap((wf: { steps: { name: string }[] }) =>
        wf.steps.map((s) => s.name),
      ),
    ]),
  ].filter((s) => !['Added', 'Completed', 'Collected', 'Cancelled'].includes(s));
  const setUsual = (stage: string, ids: string[]) => {
    const usual = { ...(t.usual ?? {}), [stage]: ids };
    if (!ids.length) delete usual[stage];
    const next: Record<string, unknown> = { ...(value ?? {}), usual };
    if (!Object.keys(usual).length) delete next.usual;
    onChange(Object.keys(next).length ? (next as Partial<TeamChoices>) : undefined);
  };
  const set = (key: keyof TeamChoices, v: boolean | number) => {
    const next: Record<string, unknown> = { ...(value ?? {}), [key]: v };
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
      {!switchOnly && <h3>Team work</h3>}
      {showSwitch && (
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
      )}
      {t.enabled && !switchOnly && (
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
          {check(
            'commission',
            'Commission',
            'Set commission terms for each person (Users → Team) and see commission due in Reports → Team.',
          )}
          {rank('assignRank', 'Who can assign work')}
          {rank('othersRank', 'Who can record work for someone else')}
          {rank('earlierRank', 'Who can set an earlier "Done at"')}
          {rank('confirmRank', 'Who confirms work')}
          {rank('correctRank', 'Who can correct work records and confirmed materials without approval')}
          {t.commission && rank('termsRank', 'Who can set commission terms')}
          {days('doneAtDays', '"Done at" can be up to (days back)')}
          {days(
            'correctionDays',
            'Work records and materials can be corrected up to (days after collection)',
          )}
          {!!people.length && !!stages.length && (
            <details>
              <summary>Usual people per stage (assigned to new jobs at checkout)</summary>
              {stages.map((s) => (
                <fieldset key={s} className="page-limit-list">
                  <legend>{stageName(s)}</legend>
                  {people.map((p) => (
                    <label key={p.id} className="check-label">
                      <input
                        type="checkbox"
                        aria-label={`Usual for ${s}: ${p.name}`}
                        checked={(t.usual?.[s] ?? []).includes(p.id)}
                        onChange={(e) => {
                          const ids = t.usual?.[s] ?? [];
                          setUsual(s, e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id));
                        }}
                      />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            </details>
          )}
        </>
      )}
    </>
  );
}
