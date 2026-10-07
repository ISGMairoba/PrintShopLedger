import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
import { makeExpenseEvent } from './expenses.mjs';
export function resolveExpenseState(state, input, expenseId, choice, id) {
 let ledger=normalizeLedger(input);
 const pending=[];
 for(const event of state.pending){
  if(ledger.expenseHistory.some(entry=>entry.id===event.id))continue;
  if(event.kind.startsWith('expense.')&&event.data.id===expenseId){
   if(choice==='cloud')continue;
   const current=ledger.expenses.find(item=>item.id===expenseId);
   if(event.kind==='expense.created'&&current)throw Error('This expense already exists in the business. Keep the business version and edit it again.');
   if(event.kind!=='expense.created'&&!current)throw Error('The business expense no longer exists. Keep the business version.');
   const replacement=makeExpenseEvent(event.kind,event.data,current,{id:event.data.modifiedBy,label:event.data.modifiedByLabel},id);
   ledger=applyEvent(ledger,replacement);pending.push(replacement);
  }else{
   ledger=applyEvent(ledger,event);pending.push(event);
  }
 }
 return {...state,ledger,pending};
}
