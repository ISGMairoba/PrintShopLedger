export interface Customer { id: string; name: string; phone: string; createdAt: string }
export interface Job { id: string; customerId: string; service: string; description: string; amount: number; createdAt: string }
export interface Allocation { jobId: string; amount: number }
export interface Payment { id: string; customerId: string; amount: number; method: 'Cash' | 'POS' | 'Transfer'; paidOn: string; reference: string; allocations: Allocation[]; createdAt: string }
export interface Material { id: string; name: string; available: number; measurementUnit: string; requireSize: boolean; archived: boolean; version: number; createdBy: string; createdByLabel: string; createdAt: string; modifiedBy: string; modifiedByLabel: string; modifiedAt: string; lastEventId: string }
export interface MaterialCommand { id: string; name?: string; available?: number; measurementUnit?: string; requireSize?: boolean; baseVersion?: number; quantity?: number; reason?: string; modifiedBy: string; modifiedByLabel: string; modifiedAt: string }
export type MaterialEvent = { id: string; kind: 'material.created' | 'material.updated' | 'material.archived' | 'material.restored' | 'material.stock_added' | 'material.stock_set'; data: MaterialCommand };
export interface Ledger { materials: Material[]; customers: Customer[]; jobs: Job[]; payments: Payment[] }
export type LedgerEvent = { id: string; kind: 'customer.created'; data: Customer } | { id: string; kind: 'job.created'; data: Job } | { id: string; kind: 'payment.recorded'; data: Payment } | MaterialEvent;
export interface LocalState { ledger: Ledger; pending: LedgerEvent[]; lastSynced?: string }
