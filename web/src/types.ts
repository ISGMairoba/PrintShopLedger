export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  creditLimit: number;
  archived: boolean;
  version: number;
  createdAt: string;
  createdBy: string | null;
  createdByLabel: string;
  modifiedBy: string | null;
  modifiedByLabel: string;
  modifiedAt: string;
  lastEventId: string | null;
}
export type FormulaTree = { op: string; args: (string | FormulaTree)[] };
export type TemplateVariable = {
  key: string;
  label: string;
  /** number, named options, a choice of costed items (material selection) or yes/no. */
  kind: 'number' | 'options' | 'material' | 'yesno';
  unit: string;
  default: number;
  min: number;
  max: number;
  integer: boolean;
  clientVisible: boolean;
  options?: { value: number; label: string; serviceId?: string }[];
};
export type TemplateComputed = {
  key: string;
  label: string;
  unit: string;
  formula: string;
  expression?: FormulaTree;
  /**
   * Take this quantity out of stock: from the selected item of a material variable, one item, or a
   * product with variants (the variant picked at checkout, or confirmed in production).
   */
  stock: { variable: string } | { serviceId: string } | { variantGroup: string } | null;
  /** Show this value on client quotes and documents (off unless chosen). */
  clientVisible?: boolean;
};
export type ExpenseCalculation = { method: string; rate: string; input: string; capacity: string };
export type TemplateExpense = {
  key: string;
  label: string;
  formula: string;
  expression?: FormulaTree;
  calculation?: ExpenseCalculation;
};
export type TemplatePricing = {
  method: 'markup' | 'margin';
  rate: number;
  floor: number;
  maxDiscount: number;
  rounding: number;
};
export type PricingTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  version: number;
  archived: boolean;
  variables: TemplateVariable[];
  computed: TemplateComputed[];
  expenses: TemplateExpense[];
  pricing: TemplatePricing;
};
export type PricingSettings = {
  enabled: boolean;
  maxTemplates?: number;
  /** Ranks that may see costs and profit (Developers always can). */
  auditRanks?: number[];
  templates: PricingTemplate[];
};
export type TemplateReference = {
  serviceId: string;
  key: string;
  name: string;
  version: number;
  amount: number;
  per: number;
  purchaseUnit?: string;
  unit: string;
  /** Naira per unit, exact decimal text. */
  rate: string;
  /** 'price' when the formula used the selling price (name_price) rather than the cost. */
  kind?: 'price';
};
export type TemplateSnapshot = {
  template: PricingTemplate;
  inputs: Record<string, number>;
  references: TemplateReference[];
  outputs: { key: string; label: string; unit: string; value: string }[];
  expenses: { key: string; label: string; amount: string }[];
  /** cost and raw are naira (exact text); amount and minimum are kobo. */
  price: { cost: string; raw: string; amount: number; minimum: number };
  stock: {
    materialId: string;
    serviceId: string;
    name: string;
    unit: string;
    quantity: number;
    stockEventId: string;
    stockCountEventId: string | null;
  }[];
  /** Items with a choice of materials: confirmed in production, not taken at the sale. */
  /** Variants picked at checkout, by computed key (the variant's item id). */
  variantPicks?: Record<string, string>;
  choices?: {
    serviceId: string;
    name: string;
    options: string[];
    confirmStage: string;
    unit: string;
    work: number;
  }[];
};
export interface CustomerCommand {
  id: string;
  name?: string;
  phone?: string;
  address?: string;
  creditLimit?: number;
  createdAt?: string;
  baseVersion?: number;
  modifiedBy?: string;
  modifiedByLabel?: string;
  modifiedAt?: string;
}
export type CustomerEvent = {
  id: string;
  kind: 'customer.created' | 'customer.updated' | 'customer.archived' | 'customer.restored';
  data: CustomerCommand;
};
export type MaterialChoice = {
  options: string[];
  confirmStage: string;
  work: number;
  plannedMaterialId?: string;
  /** A template job using several items with a choice of materials: each item is confirmed. */
  groups?: { name: string; options: string[]; unit: string; work: number }[];
};
export type JobMaterialEvent = {
  id: string;
  kind: 'job.material_used';
  data: {
    id: string;
    baseVersion: number;
    usages: { id: string; materialId: string; quantity: number; group?: number }[];
    modifiedBy: string;
    modifiedByLabel: string;
    modifiedAt: string;
  };
};
export interface Job {
  templateInputs?: Record<string, number | string>;
  templateSnapshot?: TemplateSnapshot;
  workflow?: string[];
  /** Sold off the shelf (from the service at checkout). */
  shelfItem?: boolean;
  id: string;
  customerId: string;
  service: string;
  description: string;
  amount: number;
  createdAt: string;
  checkoutId?: string;
  checkoutPosition?: number;
  serviceId?: string;
  materialId?: string | null;
  quantity?: number;
  width?: number | null;
  height?: number | null;
  source?: string;
  sourceNote?: string;
  /** Deadline (ISO time); absent when the job has none. */
  dueAt?: string;
  /** Discounts: price before discount, the job's own discount, its share of an order discount. */
  discount?: { kind: 'percent' | 'amount'; value: number; reason?: string };
  grossAmount?: number;
  lineDiscount?: number;
  orderDiscountShare?: number;
  discountAmount?: number;
  createdBy?: string | null;
  createdByLabel?: string | null;
  unitPrice?: number;
  /** A choice-of-materials job: its linked materials, confirmation stage and size in material units. */
  materialChoice?: MaterialChoice;
  /** The material(s) confirmed as used in production. */
  materialUsed?: {
    usages: { id?: string; materialId: string; quantity: number; group?: number }[];
    confirmedBy: string;
    confirmedByLabel: string;
    confirmedAt: string;
  };
  /** Packs this job was sold as (pack-priced products): [{ quantity, price, count }]. */
  packBreakdown?: { quantity: number; price: number; count: number }[];
  /** Charged by quantity range: the range the quantity fell in, e.g. "26–100". */
  priceRange?: string;
  materialNeeded?: number;
  measurementUnit?: string;
  requireSize?: boolean;
  serviceVersion?: number;
  productionStatus?: string;
  version?: number;
  modifiedBy?: string | null;
  modifiedByLabel?: string | null;
  modifiedAt?: string | null;
  lastEventId?: string | null;
}
export interface Allocation {
  jobId: string;
  amount: number;
}
export interface Payment {
  refundId?: string;
  methodLabel?: string;
  id: string;
  customerId: string;
  amount: number;
  method: 'Cash' | 'POS' | 'Transfer';
  paidOn: string;
  reference: string;
  allocations: Allocation[];
  createdAt: string;
  walletUsed?: number;
  walletAdded?: number;
  checkoutId?: string;
}
export interface Material {
  minimumStock?: number;
  id: string;
  name: string;
  available: number;
  measurementUnit: string;
  requireSize: boolean;
  archived: boolean;
  version: number;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
  lastEventId: string;
}
export interface MaterialCommand {
  minimumStock?: number;
  id: string;
  name?: string;
  available?: number;
  measurementUnit?: string;
  requireSize?: boolean;
  baseVersion?: number;
  quantity?: number;
  reason?: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
}
export type MaterialEvent = {
  id: string;
  kind:
    | 'material.created'
    | 'material.updated'
    | 'material.archived'
    | 'material.restored'
    | 'material.stock_added'
    | 'material.stock_set';
  data: MaterialCommand;
};
export interface MaterialSnapshot {
  minimumStock?: number;
  name?: string;
  available?: number;
  measurementUnit?: string;
  requireSize?: boolean;
  archived?: boolean;
}
export interface MaterialHistoryEntry {
  id: string;
  materialId: string;
  materialName: string;
  measurementUnit: string;
  action:
    | MaterialEvent['kind']
    | 'material.job_used'
    | 'material.expense_stock_changed'
    | 'material.wasted'
    | 'material.sale_returned'
    | 'material.job_corrected';
  expenseId?: string;
  jobId?: string;
  checkoutId?: string;
  beforeAvailable: number | null;
  afterAvailable: number;
  reason: string;
  changedBy: string;
  changedByLabel: string;
  changedAt: string;
  before: MaterialSnapshot | null;
  after: MaterialSnapshot;
  detailsComplete: boolean;
}
export interface Service {
  id: string;
  description: string;
  materialId: string | null;
  price: number;
  /** Sold off the shelf: no production stages, Collected as soon as it is sold. */
  shelfItem?: boolean;
  /** Used only inside pricing templates; never offered for sale. */
  private?: boolean;
  /** Template cost: amount (kobo) for `per` consumption units, bought as `unit`; `key` names it in formulas. */
  costing?: ServiceCosting | null;
  /** Prices for packs of this product (kobo for `quantity` pieces); sold as packs plus loose pieces. */
  packPrices?: PackPrice[];
  /** Price by quantity range: from this quantity up, `price` (kobo) per item; below the first, `price`. */
  priceTiers?: PriceTier[];
  /** The price is entered at each sale (e.g. consultation); `price` is only the suggested amount. */
  customPrice?: boolean;
  /** Variants of one product (colours, sizes…) share this id; each has its own stock item. */
  variantGroup?: string | null;
  /** This variant's name, e.g. "Blue". */
  variantName?: string | null;
  /** A choice of materials (2–10 linked); the material used is confirmed in production. */
  materialOptions?: string[];
  /** The stage after which the material used is confirmed (the business's stage name). */
  confirmStage?: string;
  archived: boolean;
  version: number;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
  lastEventId: string;
}
/** Template use: a formula name, and optionally a cost (amount in kobo for `per` units). */
export type ServiceCosting = { key: string; amount?: number; per?: number; unit?: string };
export interface PriceTier {
  from: number;
  price: number;
}
export interface PackPrice {
  quantity: number;
  price: number;
}
export interface ServiceCommand {
  materialOptions?: string[];
  confirmStage?: string;
  packPrices?: PackPrice[];
  priceTiers?: PriceTier[];
  customPrice?: boolean;
  variantGroup?: string | null;
  variantName?: string | null;
  shelfItem?: boolean;
  private?: boolean;
  costing?: ServiceCosting | null;
  id: string;
  description?: string;
  materialId?: string | null;
  price?: number;
  baseVersion?: number;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
}
export type ServiceEvent = {
  id: string;
  kind: 'service.created' | 'service.updated' | 'service.archived' | 'service.restored';
  data: ServiceCommand;
};
export interface CheckoutJob extends Job {
  stockCountEventId?: string | null;
  materialId: string | null;
  materialNeeded: number;
  serviceId: string;
  unitPrice: number;
  measurementUnit: string;
  requireSize: boolean;
  serviceVersion: number;
}
export interface CheckoutRecord {
  /** Whole-order discount as entered, and all discounts on this checkout in kobo. */
  orderDiscount?: { kind: 'percent' | 'amount'; value: number; reason?: string } | null;
  discountTotal?: number;
  corrected?: boolean;
  countedMaterialJobs?: string[];
  methodLabel?: string;
  drawerClosingId?: string | null;
  id: string;
  customerId: string;
  newCustomer: CustomerEvent | null;
  customerSnapshot: { id: string; name: string; phone: string; address: string };
  jobBalances: {
    id: string;
    description: string;
    service: string;
    amount: number;
    paidBefore: number;
    paidThisCheckout: number;
    outstandingAfter: number;
  }[];
  jobs: CheckoutJob[];
  expectedAccount: string;
  cashReceived: number;
  useWallet: boolean;
  override: Allocation[] | null;
  method: string;
  paidOn: string;
  reference: string;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  total: number;
  allocations: Allocation[];
  allocated: number;
  walletUsed: number;
  walletAdded: number;
  walletAfter: number;
  outstandingBefore: number;
  outstandingAfter: number;
}
export type CheckoutEvent = { id: string; kind: 'checkout.completed'; data: CheckoutRecord };
export type JobStatusEvent = {
  id: string;
  kind: 'job.status_changed';
  data: {
    id: string;
    baseVersion: number;
    status: string;
    modifiedBy: string;
    modifiedByLabel: string;
    modifiedAt: string;
  };
};
export interface DrawerClosing {
  cashCorrection?: number;
  refundIds?: string[];
  cashRefunded?: number;
  totalRefunded?: number;
  id: string;
  fromUserId: string;
  fromUserLabel: string;
  toUserId: string;
  toUserLabel: string;
  closedAt: string;
  checkoutIds: string[];
  openingId: string | null;
  openingCash: number;
  cashCollected: number;
  totalCollected: number;
  posCollected: number;
  transferCollected: number;
  walletUsed: number;
  jobSales: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
}
export interface DrawerCommand {
  id: string;
  currentPassword: string;
  nextUsername: string;
  nextPassword: string;
  countedCash: number;
  checkoutIds: string[];
  refundIds?: string[];
  openingId: string | null;
  note: string;
}
export interface QuotationLine {
  templateInputs?: Record<string, number | string>;
  templateSnapshot?: TemplateSnapshot;
  id: string;
  serviceId: string;
  service: string;
  description: string;
  quantity: number;
  width: number | null;
  height: number | null;
  measurementUnit: string;
  requireSize: boolean;
  discount?: { kind: 'percent' | 'amount'; value: number; reason?: string };
  unitPrice: number;
  grossAmount: number;
  lineDiscount: number;
  orderDiscountShare: number;
  discountAmount: number;
  amount: number;
}
export interface Quotation {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  lines: QuotationLine[];
  orderDiscount: { kind: 'percent' | 'amount'; value: number; reason?: string } | null;
  subtotal: number;
  discountTotal: number;
  total: number;
  validUntil: string;
  note: string;
  status: 'open' | 'converted' | 'archived';
  checkoutId?: string;
  convertedAt?: string;
  convertedByLabel?: string;
  version: number;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
  lastEventId: string;
}
export type QuotationEvent = {
  id: string;
  kind: 'quotation.saved' | 'quotation.archived' | 'quotation.restored' | 'quotation.converted';
  data: Partial<Quotation> & {
    id: string;
    baseVersion?: number;
    modifiedBy: string;
    modifiedByLabel: string;
    modifiedAt: string;
  };
};
export interface CustomerReminder {
  id: string;
  customerId: string;
  amountOwed: number;
  channel: 'whatsapp' | 'download';
  remindedBy: string;
  remindedByLabel: string;
  remindedAt: string;
  lastEventId: string;
}
export type ReminderEvent = {
  id: string;
  kind: 'customer.reminded';
  data: {
    id: string;
    customerId: string;
    amountOwed: number;
    channel: 'whatsapp' | 'download';
    modifiedBy: string;
    modifiedByLabel: string;
    modifiedAt: string;
  };
};
export interface Ledger {
  pricing?: PricingSettings;
  /** A device keeping recent history only: counts and daily totals of the records it dropped. */
  historySummary?: {
    cutoff: string;
    stages: Record<string, number>;
    customerJobs: Record<string, number>;
    daily: Record<string, { sales: number; collected: number; refunded: number }>;
  };
  saleAdjustments: SaleAdjustment[];
  materialWaste: MaterialWaste[];
  expenses: Expense[];
  expenseHistory: ExpenseHistoryEntry[];
  drawerClosings: DrawerClosing[];
  checkouts: CheckoutRecord[];
  quotations: Quotation[];
  reminders: CustomerReminder[];
  services: Service[];
  materialHistory: MaterialHistoryEntry[];
  materials: Material[];
  customers: Customer[];
  jobs: Job[];
  payments: Payment[];
}
export type LedgerEvent =
  | SupervisedEvent
  | ExpenseEvent
  | CheckoutEvent
  | JobStatusEvent
  | JobMaterialEvent
  | CustomerEvent
  | { id: string; kind: 'job.created'; data: Job }
  | { id: string; kind: 'payment.recorded'; data: Payment }
  | MaterialEvent
  | ServiceEvent
  | QuotationEvent
  | ReminderEvent;
export interface LocalState {
  syncConflicts?: Record<string, string>;
  ledger: Ledger;
  pending: LedgerEvent[];
  lastSynced?: string;
  /** Delta sync: the server cursor of the last download, and when the last full download was. */
  syncCursor?: string;
  fullSyncAt?: string;
  /** Set when this device's damaged offline copy was replaced; cleared after the next download. */
  storageRecovered?: string;
}

export interface ExpenseMaterial {
  materialId: string;
  name: string;
  measurementUnit: string;
  quantity: number;
}
export interface ExpensePayment {
  methodLabel?: string;
  id: string;
  amount: number;
  paidOn: string;
  method: string;
  source: string;
  reference: string;
  createdBy?: string;
  createdByLabel?: string;
  createdAt?: string;
}
export interface Expense {
  id: string;
  description: string;
  category: string;
  incurredOn: string;
  amount: number;
  payee: string;
  note: string;
  receiptReference: string;
  materials: ExpenseMaterial[];
  payments: ExpensePayment[];
  voided: boolean;
  voidReason: string;
  version: number;
  createdBy: string;
  createdByLabel: string;
  createdAt: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
  lastEventId: string;
}
export interface ExpenseCommand {
  id: string;
  baseVersion?: number;
  description?: string;
  category?: string;
  incurredOn?: string;
  amount?: number;
  payee?: string;
  note?: string;
  receiptReference?: string;
  materials?: ExpenseMaterial[];
  payment?: ExpensePayment;
  reason?: string;
  stockIds: Record<string, string>;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
}
export type ExpenseEvent = {
  id: string;
  kind: 'expense.created' | 'expense.updated' | 'expense.payment_recorded' | 'expense.voided';
  data: ExpenseCommand;
};
export interface ExpenseHistoryEntry {
  id: string;
  expenseId: string;
  action: ExpenseEvent['kind'];
  before: Expense | null;
  after: Expense;
  changedBy: string;
  changedByLabel: string;
  changedAt: string;
  event: ExpenseEvent;
}

export interface SupervisedCommand {
  detailsId?: string;
  paymentEdits?: {
    eventId: string;
    paymentId: string;
    expectedPayment: unknown;
    paymentAmount: number;
    method: string;
    methodLabel: string;
    reference: string;
  }[];
  serviceId?: string;
  serviceVersion?: number;
  unitPrice?: number;
  width?: number | null;
  height?: number | null;
  stockMode?: string;
  stockIds?: Record<string, string>;
  materialVersions?: Record<string, number>;
  paymentId?: string;
  expectedPayment?: unknown;
  paymentAmount?: number;
  reference?: string;
  id?: string;
  jobId?: string;
  materialId?: string;
  baseVersion: number;
  expectedAccount?: string;
  description?: string;
  amount?: number;
  refundAmount?: number;
  method?: string;
  methodLabel?: string;
  paidOn?: string;
  returnQuantity?: number;
  materialVersion?: number;
  stockEventId?: string;
  quantity?: number;
  category?: string;
  /** Choice-of-materials job, after confirmation: the new amount of each material really used. */
  choiceUsages?: { materialId: string; quantity: number }[];
  /** Set when approving a cashier's correction request. */
  requestId?: string;
  requestedBy?: string;
  requestedByLabel?: string;
  reason: string;
  modifiedBy: string;
  modifiedByLabel: string;
  modifiedAt: string;
}
export type SupervisedEvent = {
  id: string;
  kind:
    | 'sale.combined_corrected'
    | 'sale.details_corrected'
    | 'payment.corrected'
    | 'sale.corrected'
    | 'sale.cancelled'
    | 'sale.refunded'
    | 'material.wasted';
  data: SupervisedCommand;
};
/** A cashier's correction waiting for (or decided by) an Admin, Manager or Developer. */
export interface CorrectionRequest {
  id: string;
  jobId: string;
  kind: SupervisedEvent['kind'];
  event: SupervisedEvent;
  reason: string;
  requestedBy: string;
  requestedByLabel: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decidedBy?: string | null;
  decidedByLabel?: string | null;
  decidedAt?: string | null;
  note?: string | null;
}
export interface SaleAdjustment {
  groupId?: string;
  childIds?: string[];
  affectedJobIds?: string[];
  stockChanges?: { materialId: string; delta: number }[];
  stockMode?: string;
  cashDelta?: number;
  methodDeltas?: Record<string, number>;
  drawerActor?: string | null;
  historicalClosingId?: string | null;
  paymentId?: string | null;
  id: string;
  jobId: string;
  customerId: string;
  action: string;
  reason: string;
  changedBy: string;
  changedByLabel: string;
  changedAt: string;
  before: Job;
  after: Job;
  creditReleased: number;
  refundAmount: number;
  method?: string;
  methodLabel?: string;
  paidOn?: string;
  returnQuantity: number;
  paymentChanges: { before: Payment; after: Payment }[];
  event: SupervisedEvent;
  drawerClosingId?: string | null;
}
export interface MaterialWaste {
  id: string;
  materialId: string;
  materialName: string;
  measurementUnit: string;
  quantity: number;
  category: string;
  jobId: string | null;
  reason: string;
  changedBy: string;
  changedByLabel: string;
  changedAt: string;
  beforeAvailable: number;
  afterAvailable: number;
  event: SupervisedEvent;
}
