import { createContext, useContext } from 'react';

/**
 * Payee payments (Business Settings → Jobs & payments → Payees): what happens to money paid beyond
 * what is owed ('advance': kept as an advance, the default; 'ask'), and whether an expense is paid
 * from a payee's advance ('ask': offered under Paid from, the default; 'auto': chosen first; 'never').
 */
export type PayeeRules = { payeeExtra: 'advance' | 'ask'; useAdvance: 'ask' | 'auto' | 'never' };
export const PayeeRulesContext = createContext<PayeeRules>({ payeeExtra: 'advance', useAdvance: 'ask' });
export const usePayeeRules = () => useContext(PayeeRulesContext);
