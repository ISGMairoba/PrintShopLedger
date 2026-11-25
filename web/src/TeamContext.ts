import { createContext, useContext } from 'react';
import type { JobMaterialCorrectionEvent, Ledger, TeamEvent } from './types';
import type { TEAM_DEFAULTS } from './team.mjs';

/** Team work (plans/job-assignment.md), for the screens that show or record it. */
export interface TeamWork {
  /** Team work is on and the server keeps it. */
  on: boolean;
  settings: typeof TEAM_DEFAULTS;
  ledger: Ledger;
  actor: { id: string; label: string; level: number };
  busy: boolean;
  /** Saves team changes on this device (they sync like every other change). */
  save: (events: TeamEvent[]) => Promise<void>;
  /** Decides a correction of confirmed materials (it lives on the job). */
  saveJob?: (event: JobMaterialCorrectionEvent) => Promise<void>;
  /** This person can record expenses (an outside vendor's cost becomes one, linked to the job). */
  canExpense?: boolean;
}
export const TeamContext = createContext<TeamWork | null>(null);
/** Team work when it is on; null otherwise (nothing about it is shown). */
export function useTeam() {
  const team = useContext(TeamContext);
  return team?.on ? team : null;
}
