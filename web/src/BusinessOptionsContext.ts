import { createContext, useContext } from 'react';
import { defaultOptions } from './business-options.mjs';
type Method={label:string;kind:string;enabled:boolean;accountId?:string;methodId?:string;displayLabel?:string};
type Options=Omit<ReturnType<typeof defaultOptions>,'paymentMethods'>&{paymentMethods:Method[]};
export const BusinessOptionsContext = createContext<Options>(defaultOptions());
export const useBusinessOptions = () => useContext(BusinessOptionsContext);
