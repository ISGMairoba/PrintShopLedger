import { orderMethods } from './business-options.mjs';
import { accountPaymentOptions } from './account-methods.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import { ADVANCE_SOURCE } from './money-moves.mjs';
import type { MoneyAccount } from './types';

export type PaidFrom = { key: string; text: string; label: string; kind: string; accountId: string; source: string };

/**
 * One "Paid from" list for paying out: each account and its methods (or the business's methods before
 * accounts are set up), plus the owner's own money. The method and source follow from the choice.
 */
export function usePaidFromOptions(accounts: MoneyAccount[] = []): PaidFrom[] {
  const options = useBusinessOptions();
  return [
    ...orderMethods(
      accountPaymentOptions(
        { moneyAccounts: accounts },
        options.paymentMethods.filter((m) => m.enabled),
      ) as { label: string; kind: string; accountId?: string; displayLabel?: string }[],
      options.methodOrder,
    ).map((o: { label: string; kind: string; accountId?: string; displayLabel?: string }) => ({
      key: `${o.accountId ?? ''}|${o.label}`,
      text: o.displayLabel || o.label,
      label: o.label,
      kind: o.kind,
      accountId: o.accountId ?? '',
      source: o.kind === 'Cash' ? 'Business cash' : 'Business bank account',
    })),
    {
      key: 'personal',
      text: 'Personal funds (not from the business)',
      label: 'Personal funds',
      kind: 'Other',
      accountId: '',
      source: 'Personal funds',
    },
  ];
}

/** Paying from the advance held with the payee (no account moves). */
export const advanceOption = (held: string): PaidFrom => ({
  key: 'advance',
  text: `Advance held with this payee (${held} left)`,
  label: 'Advance',
  kind: 'Other',
  accountId: '',
  source: ADVANCE_SOURCE,
});
