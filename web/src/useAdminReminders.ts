import { useMemo, useState } from 'react';
import { lowAtOtherLocations, lowStockReminderDue } from './low-stock-locations.mjs';
import { businessDay } from './dashboard.mjs';
import { lateReminderDue, stageOverdue } from './stage-time.mjs';
import { dueRepeats } from './repeating-expenses.mjs';
import { repaymentsDue } from './lenders.mjs';
import type { Ledger } from './types';

type Branch = { id: string; name: string; kind?: string; archived?: boolean };

/**
 * The reminders Admins and higher see at the top of the app: items running low at other
 * locations and jobs too long at a stage (once a day each), repeating expenses due to record, and
 * loan repayments due within three days. Each can be dismissed for this session.
 */
export default function useAdminReminders({
  demo,
  scope,
  level,
  ledger,
  multiBranch,
  activeBranch,
  openBranches,
  stageHours,
}: {
  demo: boolean;
  scope: string;
  /** The signed-in person's rank (Admin is 2). */
  level: number;
  /** The whole business copy on this device (every branch). */
  ledger: Ledger;
  multiBranch: boolean;
  activeBranch: Branch | null | undefined;
  openBranches: Branch[];
  stageHours?: Record<string, number>;
}) {
  const today = () => businessDay(new Date().toISOString());
  // Items running low at other locations (a business with locations), once a day.
  const [lowStockSeen, setLowStockSeen] = useState(false);
  const lowElsewhereCount = useMemo(() => {
    if (demo || !multiBranch || !activeBranch || !scope || lowStockSeen || level < 2) return 0;
    if (!lowStockReminderDue(scope, today())) return 0;
    return lowAtOtherLocations(ledger.materials, ledger.locationStock ?? [], activeBranch.id, openBranches)
      .length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, multiBranch, activeBranch, scope, lowStockSeen, level, ledger, openBranches]);
  // Repeating expenses due to record.
  const [repeatsSeen, setRepeatsSeen] = useState(false);
  const dueRepeatCount = useMemo(
    () => (repeatsSeen || (!demo && level < 2) ? 0 : dueRepeats(ledger, today()).length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repeatsSeen, demo, level, ledger],
  );
  // Loan repayments due within three days (or overdue).
  const [loansSeen, setLoansSeen] = useState(false);
  const loansDue = useMemo(
    () => (loansSeen || (!demo && level < 2) ? [] : repaymentsDue(ledger, today())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loansSeen, demo, level, ledger],
  );
  // Jobs that have been at a stage too long, once a day.
  const [lateSeen, setLateSeen] = useState(false);
  const lateJobs = useMemo(() => {
    if (demo || !scope || lateSeen || level < 2) return 0;
    if (!lateReminderDue(scope, today())) return 0;
    return ledger.jobs.filter((job) => stageOverdue(job, stageHours ?? {})).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, scope, lateSeen, level, stageHours, ledger.jobs]);
  return {
    lowElsewhereCount,
    setLowStockSeen,
    dueRepeatCount,
    setRepeatsSeen,
    loansDue,
    setLoansSeen,
    lateJobs,
    setLateSeen,
  };
}
