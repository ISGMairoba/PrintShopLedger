export interface Customer { id: string; name: string; phone: string; createdAt: string }
export interface Job { id: string; customerId: string; service: string; description: string; amount: number; createdAt: string }
export interface Allocation { jobId: string; amount: number }
export interface Payment { id: string; customerId: string; amount: number; method: 'Cash' | 'POS' | 'Transfer'; paidOn: string; reference: string; allocations: Allocation[]; createdAt: string }
export interface Ledger { customers: Customer[]; jobs: Job[]; payments: Payment[] }
export type LedgerEvent = { id: string; kind: 'customer.created'; data: Customer } | { id: string; kind: 'job.created'; data: Job } | { id: string; kind: 'payment.recorded'; data: Payment };
export interface LocalState { ledger: Ledger; pending: LedgerEvent[]; lastSynced?: string }
