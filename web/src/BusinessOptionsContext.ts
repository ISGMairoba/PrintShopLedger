import { createContext, useContext } from 'react';
import { defaultOptions } from './business-options.mjs';
export const BusinessOptionsContext = createContext(defaultOptions());
export const useBusinessOptions = () => useContext(BusinessOptionsContext);
