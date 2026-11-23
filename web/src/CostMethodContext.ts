import { createContext, useContext } from 'react';

/**
 * The business's cost method (Business Settings → Jobs & payments → Costs and profit;
 * plans/actual-cost-v2.md): 'estimated' (the default) asks for no cost entry and works profit out
 * from each material's cost price; 'actual' uses what stock really cost.
 */
export const CostMethodContext = createContext<'estimated' | 'actual'>('estimated');
export const useCostMethod = () => useContext(CostMethodContext);
