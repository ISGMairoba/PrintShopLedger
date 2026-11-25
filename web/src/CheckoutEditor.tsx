import { belowMinimum, minOrderRule } from './min-order.mjs';
import DefaultTermsButton from './DefaultTermsButton';
import TemplateDiscountWarning from './TemplateDiscountWarning';
import { defaultMethod, defaultSource } from './business-options.mjs';
import { defaultMoneyAccount } from './operations.mjs';
import SplitPayment, { SPLIT, splitParts, splitTotal, startSplit, type SplitRow } from './SplitPayment';
import { notEnoughStock } from './stock-rule.mjs';
import DialogActions from './DialogActions';
import { TemplateInputs, TemplateEstimate, tryTemplate } from './TemplateFields';
import { serviceMaterial } from './material-choice.mjs';
import { editableInputs, templateDefaults } from './pricing-templates.mjs';
import type { TemplateSnapshot } from './types';
import { lineWithDescription, nextDescription } from './job-batches.mjs';
import SearchSelect from './SearchSelect';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { StepBuilder } from './StepBuilder';
import { itemSteps, stagesToSteps, stepsWorkflow, validSteps } from './workflow-steps.mjs';
import { spanLabel, stagePlan } from './stage-time.mjs';
import CurrencyInput from './CurrencyInput';
import { useEffect, useId, useState } from 'react';
import Modal from './Modal';
import { rebalanceManualAllocations } from './manual-allocation.mjs';
import Icon from './Icon';
import CustomerEditor from './CustomerEditor';
import {
  prepareCheckout,
  quoteLine,
  paymentPlan,
  walletBalance,
  unpaidJobs,
  stockCountEvent,
  offlineCustomerClash,
} from './checkout.mjs';
import { applyCustomerEvent } from './customers.mjs';
import { money, jobBalance, customerBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import type { Ledger, CustomerEvent, CheckoutEvent, CheckoutRecord, Step } from './types';
import { defaultDueAt, durationLabel, fromLocalInput, toLocalInput } from './job-deadlines.mjs';
import { jobSettingsDefaults } from './business-branding.mjs';
import { applyOrderDiscount } from './discounts.mjs';
import { packList, packSummary } from './pack-prices.mjs';
import { tierList } from './price-tiers.mjs';
import { useWords } from './Words';
import { alphabetical } from './alphabetical.mjs';
type JobSettings = ReturnType<typeof jobSettingsDefaults>;
type Props = {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  paymentOnly?: boolean;
  initialCustomer?: string;
  initialCheckout?: CheckoutRecord;
  onSave: (event: CheckoutEvent) => Promise<CheckoutRecord>;
  onClose: () => void;
  onReceipt: (record: CheckoutRecord) => void;
  /** Business defaults: new-job deadline and how the payment amount starts. */
  jobSettings?: JobSettings;
  defaultTerms?: string;
  /** What this user may discount: the cap per job (%) and whether flat/whole-order is allowed. */
  discountPolicy?: { maxPercent: number; canFlat: boolean };
  /** Admins and above may give a job another workflow than its item's. */
  canChooseWorkflow?: boolean;
  /** Start from an accepted quotation: its lines, customer and discounts. */
  fromQuotation?: QuotationStart;
  /** Start with one template line, priced on the Pricing Templates page. */
  startTemplate?: { templateId: string; inputs: Record<string, number | string>; quantity: string };
  /** Resume a held sale (Hold sale). */
  held?: HeldSale;
  /** Put this cart aside on this device to serve someone else (Hold sale). */
  onHold?: (sale: HeldSale) => void;
};
/** A sale put aside on this device (held-sales.mjs). */
export type HeldSale = {
  id: string;
  kind: 'checkout' | 'quick';
  heldAt: string;
  heldBy: string;
  customerName: string;
  items: string[];
  total: number | null;
  data: Record<string, unknown>;
  /** The branch it was held in (left out = main): it is resumed only there. */
  branchId?: string;
};
type HeldCheckout = {
  lines: CartLine[];
  customerId: string;
  query: string;
  newCustomer: CustomerEvent | null;
  orderDiscount: DiscountDraft;
  termsAndConditions: string;
  /** An order from a quotation keeps its quotation while held. */
  fromQuotation?: QuotationStart;
};
/** The quotation a held sale was started from, if any. */
export const heldQuotation = (sale: HeldSale | undefined | null) =>
  sale?.kind === 'checkout' ? (sale.data as HeldCheckout).fromQuotation : undefined;
export type QuotationStart = {
  /** The quotation's ID: the sale carries it and marks it converted in the same save. */
  quotationId: string;
  reference: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  lines: {
    serviceId: string;
    templateInputs?: Record<string, number | string>;
    templateSnapshot?: TemplateSnapshot;
    description: string;
    quantity: number;
    width: number | null;
    height: number | null;
    discount?: { kind: string; value: number; reason?: string };
    /** The price entered on the quotation, for a custom-price service. */
    unitPrice?: number;
  }[];
  orderDiscount: { kind: string; value: number; reason?: string } | null;
  changes: string[];
};
export type DiscountDraft = { kind: '' | 'percent' | 'amount'; value: string; reason: string };
export const noDiscount = (): DiscountDraft => ({ kind: '', value: '', reason: '' });
/** The discount as typed → the stored form (percent, or kobo for an amount). */
export const discountSpec = (d: DiscountDraft) =>
  d.kind
    ? {
        kind: d.kind,
        value: d.kind === 'percent' ? Number(d.value || 0) : money(d.value || '0'),
        reason: d.reason,
      }
    : null;
export const discountDraft = (
  spec?: { kind: string; value: number; reason?: string } | null,
): DiscountDraft =>
  spec
    ? {
        kind: spec.kind as DiscountDraft['kind'],
        value: spec.kind === 'percent' ? String(spec.value) : (spec.value / 100).toFixed(2),
        reason: spec.reason ?? '',
      }
    : noDiscount();
/** Discount type, value and optional reason, for one job or the whole order. */
export function DiscountFields({
  label,
  value,
  allowFlat,
  maxPercent,
  onChange,
}: {
  label: string;
  value: DiscountDraft;
  allowFlat: boolean;
  maxPercent: number;
  onChange: (value: DiscountDraft) => void;
}) {
  return (
    <div className="discount-fields">
      <label>
        {label}
        <select
          aria-label={label}
          value={value.kind}
          onChange={(e) => onChange({ ...value, kind: e.target.value as DiscountDraft['kind'] })}
        >
          <option value="">No discount</option>
          <option value="percent">Percentage (%)</option>
          {(allowFlat || value.kind === 'amount') && <option value="amount">Amount (₦)</option>}
        </select>
      </label>
      {value.kind && (
        <>
          <label>
            {value.kind === 'percent' ? `Percentage (up to ${maxPercent}%)` : 'Amount (₦)'}
            {value.kind === 'percent' ? (
              <input
                aria-label={`${label} percentage`}
                type="number"
                min="0"
                max={maxPercent}
                step="0.5"
                value={value.value}
                onChange={(e) => onChange({ ...value, value: e.target.value })}
              />
            ) : (
              <CurrencyInput
                aria-label={`${label} amount`}
                value={value.value}
                onValueChange={(amount) => onChange({ ...value, value: amount })}
              />
            )}
          </label>
          <label>
            Reason (optional)
            <input
              aria-label={`${label} reason`}
              maxLength={200}
              value={value.reason}
              onChange={(e) => onChange({ ...value, reason: e.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
type ManualAllocationState = { amounts: Record<string, string>; editedOrder: string[] };
function balanceDraft(
  state: ManualAllocationState,
  limits: Record<string, number>,
  budget: number,
  editedId: string | null = null,
  value?: string,
): ManualAllocationState {
  const draft = editedId ? { ...state.amounts, [editedId]: value ?? '' } : state.amounts;
  const numbers = Object.fromEntries(Object.keys(limits).map((id) => [id, money(draft[id] || '0')]));
  const balanced = rebalanceManualAllocations(numbers, limits, budget, state.editedOrder, editedId);
  const amounts: Record<string, string> = Object.fromEntries(
    Object.entries(balanced.amounts).map(([id, n]) => [
      id,
      n === numbers[id] ? (draft[id] ?? '') : (Number(n) / 100).toFixed(2),
    ]),
  );
  const next = { amounts, editedOrder: balanced.editedOrder };
  return JSON.stringify(next) === JSON.stringify(state) ? state : next;
}
type CartLine = {
  templateInputs?: Record<string, number | string>;
  templateSnapshot?: TemplateSnapshot;
  templateStockIds?: Record<string, string>;
  id: string;
  serviceId: string;
  description: string;
  quantity: string;
  width: string;
  height: string;
  source: string;
  sourceNote: string;
  /** Deadline as an ISO time, or '' for none. */
  dueAt?: string;
  workflow?: string[];
  /** Older: the saved workflow it followed. */
  workflowId?: string;
  workflowName?: string;
  stageHours?: Record<string, number>;
  /** Steps an Admin is changing for this job (sent as workflow and stageHours). */
  steps?: Step[];
  /** This job's own discount, as typed. */
  discountDraft?: DiscountDraft;
  /** A custom-price service: the price per item as typed (₦). */
  priceText?: string;
};
/** A cart line as checkout expects it: the typed discount becomes the stored discount. */
const typedPrice = (text: string) => {
  try {
    return text.trim() ? money(text) : Number.NaN;
  } catch {
    return Number.NaN;
  }
};
/**
 * Under a deadline: a warning when the job's step times don't fit before it (each step's time is
 * then shrunk to fit; stage-time.mjs).
 */
function TightDeadline({
  line,
  jobStages,
  stageHours,
}: {
  line: Record<string, any>;
  jobStages: string[];
  stageHours?: Record<string, number>;
}) {
  if (!line.dueAt) return null;
  const plan = stagePlan(
    {
      createdAt: new Date().toISOString(),
      productionStatus: 'Added',
      workflow: line.workflow ?? jobStages,
      stageHours: line.stageHours,
      dueAt: line.dueAt,
    },
    stageHours,
    { fromSale: true },
  );
  if (!plan?.tight) return null;
  return (
    <small className="notice" role="status">
      Tight deadline: the steps take {spanLabel(plan.needed)}, but only {spanLabel(plan.available)} is left.
      Each step's time is shrunk to fit.
    </small>
  );
}
const stepsOrTyped = (steps: Step[]) => {
  try {
    return validSteps(steps, 'Job steps');
  } catch {
    return steps.map((s) => ({ ...s, name: s.name.trim() }));
  }
};
const toLine = ({ discountDraft: draft, priceText, steps, ...line }: CartLine) => {
  // Steps an Admin changed: the job's stages and their hours (while being typed, the sale's own
  // check reports a step left without a name).
  const flow = steps ? stepsWorkflow(stepsOrTyped(steps)) : null;
  const item = flow
    ? { ...line, workflow: flow.stages, stageHours: Object.keys(flow.hours).length ? flow.hours : undefined }
    : line;
  const discount = draft ? discountSpec(draft) : null;
  const priced = priceText === undefined ? item : { ...item, unitPrice: typedPrice(priceText) };
  return discount ? { ...priced, discount } : priced;
};
/** The typed price for a custom-price service's line, from its saved price per item. */
const priceTextFor = (ledger: Ledger, serviceId: string, unitPrice?: number) =>
  ledger.services.find((s) => s.id === serviceId)?.customPrice
    ? { priceText: ((unitPrice ?? 0) / 100).toFixed(2) }
    : {};
const line = (): CartLine => ({
  id: crypto.randomUUID(),
  serviceId: '',
  description: '',
  quantity: '1',
  width: '',
  height: '',
  source: 'In shop / USB',
  sourceNote: '',
});
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
export default function CheckoutEditor({
  ledger,
  actor,
  busy,
  paymentOnly = false,
  initialCustomer = '',
  initialCheckout,
  onSave,
  onClose,
  onReceipt,
  jobSettings = jobSettingsDefaults(),
  defaultTerms = '',
  discountPolicy = { maxPercent: 0, canFlat: false },
  canChooseWorkflow = false,
  fromQuotation,
  startTemplate,
  held,
  onHold,
}: Props) {
  const resumed = held?.kind === 'checkout' ? (held.data as HeldCheckout) : null;
  const [termsAndConditions, setTermsAndConditions] = useState(
    resumed
      ? resumed.termsAndConditions
      : initialCheckout
        ? (initialCheckout.termsAndConditions ?? '')
        : defaultTerms,
  );
  const formId = useId();
  const options = useBusinessOptions(),
    jobSources = options.jobSources;
  const { w, stage } = useWords();
  // A job's stages and hours: its item's own steps, else the business's usual ones.
  const workflowLine = (id: string): Partial<CartLine> => {
    const production =
      working.pricing?.templates.find((t) => t.id === id)?.production ??
      working.services.find((s) => s.id === id)?.production;
    const service = working.services.find((s) => s.id === id);
    const flow = stepsWorkflow(itemSteps(options, production, service?.shelfItem ? 'shelf' : 'service'));
    return {
      workflow: flow.stages,
      workflowId: undefined,
      workflowName: undefined,
      stageHours: Object.keys(flow.hours).length ? flow.hours : undefined,
      steps: undefined,
    };
  };
  const [stepsFor, setStepsFor] = useState<string | null>(null);
  const newLine = () => ({
    ...line(),
    source: defaultSource(options),
    workflow: [...options.jobStages],
    dueAt: defaultDueAt(jobSettings.defaultDuration),
  });
  const [lines, setLines] = useState<CartLine[]>(() =>
    resumed
      ? resumed.lines.map((l) => ({ ...l }))
      : initialCheckout
        ? initialCheckout.jobs.map((j) => ({
            ...line(),
            ...j,
            ...(j.templateSnapshot ? { templateInputs: editableInputs(j.templateSnapshot) } : {}),
            ...priceTextFor(ledger, j.serviceId, j.unitPrice),
            quantity: String(j.quantity),
            width: j.width == null ? '' : String(j.width),
            height: j.height == null ? '' : String(j.height),
            source: j.source ?? 'In shop / USB',
            sourceNote: j.sourceNote ?? '',
            dueAt: j.dueAt ?? '',
            discountDraft: discountDraft(j.discount),
          }))
        : fromQuotation
          ? fromQuotation.lines.map((q) => ({
              ...newLine(),
              serviceId: q.serviceId,
              templateInputs: q.templateSnapshot ? editableInputs(q.templateSnapshot) : q.templateInputs,
              ...priceTextFor(ledger, q.serviceId, q.unitPrice),
              templateSnapshot: q.templateSnapshot,
              templateStockIds: q.templateSnapshot
                ? Object.fromEntries(q.templateSnapshot.stock.map((s) => [s.materialId, crypto.randomUUID()]))
                : undefined,
              description: q.description,
              quantity: String(q.quantity),
              width: q.width == null ? '' : String(q.width),
              height: q.height == null ? '' : String(q.height),
              discountDraft: discountDraft(q.discount),
            }))
          : paymentOnly
            ? []
            : startTemplate
              ? [
                  {
                    ...newLine(),
                    serviceId: startTemplate.templateId,
                    templateInputs: startTemplate.inputs,
                    templateStockIds: {},
                    description:
                      ledger.pricing?.templates.find((t) => t.id === startTemplate.templateId)?.name ?? '',
                    quantity: startTemplate.quantity,
                  },
                ]
              : [newLine()],
  );
  // A customer added offline can clash with one created elsewhere in the meantime (for
  // example the same phone number). Detect it once so the reviewer picks a customer instead
  // of the editor failing while it tries to apply the offline customer.
  const [offlineCustomer] = useState(() => {
    const event = initialCheckout?.newCustomer ?? null;
    return { event, clash: offlineCustomerClash(ledger, event) };
  });
  const clash = offlineCustomer.clash;
  const [customerId, setCustomerId] = useState(
    resumed
      ? resumed.customerId
      : clash
        ? ''
        : (initialCheckout?.customerId ?? (initialCustomer || fromQuotation?.customerId || '')),
  );
  const [query, setQuery] = useState(
    resumed
      ? resumed.query
      : clash
        ? ''
        : (ledger.customers.find(
            (c) => c.id === (initialCheckout?.customerId ?? (initialCustomer || fromQuotation?.customerId)),
          )?.name ??
          offlineCustomer.event?.data.name ??
          fromQuotation?.customerName ??
          ''),
  );
  const [suggest, setSuggest] = useState(false),
    [active, setActive] = useState(0),
    [addingCustomer, setAddingCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<CustomerEvent | null>(
    resumed ? resumed.newCustomer : clash ? null : offlineCustomer.event,
  );
  const [cashOverride, setCashOverride] = useState<string | null>(
    initialCheckout ? (initialCheckout.cashReceived / 100).toFixed(2) : null,
  );
  const [useWallet, setUseWallet] = useState(initialCheckout?.useWallet ?? true),
    [manual, setManual] = useState(!!initialCheckout?.override);
  const [manualAllocations, setManualAllocations] = useState<ManualAllocationState>(() => ({
    amounts: Object.fromEntries(
      (initialCheckout?.override ?? []).map((a) => [a.jobId, (a.amount / 100).toFixed(2)]),
    ),
    editedOrder: [],
  }));
  const allocations = manualAllocations.amounts;
  const availableMethods = options.paymentMethods.filter((item) => item.enabled);
  const [methodLabel, setMethodLabel] = useState(
    initialCheckout?.methodLabel ??
      initialCheckout?.method ??
      defaultMethod(availableMethods, options.defaultIncomeMethod)?.label ??
      '',
  );
  const originalMethodLabel = initialCheckout?.methodLabel ?? initialCheckout?.method;
  // Reviewing a pending sale: the methods it was paid by stay choosable, even if switched off since
  // (AUD-37: each part of a split too).
  const originalMethods = initialCheckout
    ? [
        { label: originalMethodLabel!, kind: initialCheckout.method },
        ...(initialCheckout.splits ?? []).map((p) => ({ label: p.methodLabel ?? p.method, kind: p.method })),
      ]
    : [];
  const missing = originalMethods.filter(
    (m, i) =>
      originalMethods.findIndex((x) => x.label === m.label) === i &&
      !availableMethods.some((item) => item.label === m.label && item.kind === m.kind),
  );
  const paymentMethods: { label: string; kind: string; enabled: boolean; displayLabel?: string }[] =
    missing.length
      ? [
          ...missing.map((m) => ({ ...m, enabled: true })),
          ...availableMethods.filter((item) => !missing.some((m) => m.label === item.label)),
        ]
      : availableMethods;
  const method = paymentMethods.find((item) => item.label === methodLabel)?.kind ?? '';
  const [accountChoice, setAccountChoice] = useState<string | null>(
    initialCheckout ? (initialCheckout.accountId ?? '') : null,
  );
  const selectedAccount = defaultMoneyAccount(ledger, methodLabel);
  const [paidOn, setPaidOn] = useState(initialCheckout?.paidOn ?? today()),
    [reference, setReference] = useState(initialCheckout?.reference ?? ''),
    [error, setError] = useFeedbackMessage('error');
  const [stockReviewConfirmed, setStockReviewConfirmed] = useState(false),
    [countedMaterialJobs, setCountedMaterialJobs] = useState<string[]>(
      initialCheckout?.countedMaterialJobs ?? [],
    );
  const countedReviewJobs =
    initialCheckout?.jobs.filter(
      (job) =>
        job.materialId &&
        ((job.stockCountEventId ?? null) !== stockCountEvent(ledger, job.materialId) ||
          (initialCheckout.countedMaterialJobs ?? []).includes(job.id)),
    ) ?? [];
  const stockCountChanged = countedReviewJobs.length > 0;
  const working: Ledger =
    newCustomer && !ledger.customers.some((c) => c.id === newCustomer.data.id)
      ? applyCustomerEvent(ledger, newCustomer)
      : ledger;
  const customer = working.customers.find((c) => c.id === customerId && !c.archived);
  const matches = alphabetical(
    working.customers.filter(
      (c) => !c.archived && `${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase()),
    ),
    (c) => c.name,
  ).slice(0, 8);
  const choose = (id: string, name: string) => {
    if (!initialCheckout && id !== customerId) setCashOverride(null);
    setCustomerId(id);
    setNewCustomer((current) => (current && current.data.id !== id ? null : current));
    setQuery(name);
    setSuggest(false);
    setManual(false);
    setManualAllocations({ amounts: {}, editedOrder: [] });
  };
  const editLine = (id: string, key: string, value: string) =>
    setLines((items) => items.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
  const [orderDiscount, setOrderDiscount] = useState<DiscountDraft>(() =>
    resumed
      ? resumed.orderDiscount
      : discountDraft(initialCheckout?.orderDiscount ?? fromQuotation?.orderDiscount),
  );
  const cartLines = lines.map((line) =>
    lineWithDescription(
      toLine(line),
      [
        ...working.services,
        ...(working.pricing?.templates ?? []).map((t) => ({ id: t.id, description: t.name })),
      ],
      jobSettings.descriptionMode,
    ),
  );
  const quotedLines = cartLines.map((item) => {
    try {
      return quoteLine(working, item);
    } catch {
      return null;
    }
  });
  // Prices after each job's discount and the order discount shared by price.
  const price = () =>
    applyOrderDiscount(
      quotedLines as NonNullable<(typeof quotedLines)[number]>[],
      discountSpec(orderDiscount),
    );
  let priced: ReturnType<typeof price> | null = null;
  try {
    if (quotedLines.every((item) => item !== null)) priced = price();
  } catch {
    priced = null;
  }
  const cartReady = priced !== null;
  const cartTotal = priced ? priced.jobs.reduce((sum, item) => sum + item.amount, 0) : null;
  const cartGross = priced
    ? priced.jobs.reduce((sum, item) => sum + (item.grossAmount ?? item.amount), 0)
    : 0;
  const jobs = priced
    ? [
        ...working.jobs,
        ...priced.jobs
          .filter((item) => item && !working.jobs.some((job) => job.id === item.id))
          .map((item, index) => ({
            ...item!,
            customerId,
            createdAt: initialCheckout?.createdAt ?? new Date().toISOString(),
            checkoutPosition: index,
          })),
      ]
    : working.jobs;
  const paymentLedger = { ...working, jobs };
  const previousBalance = customer ? customerBalance(working, customer.id) : 0;
  const availableWallet = customer && useWallet ? walletBalance(working, customer.id) : 0;
  const recommended = cartTotal === null ? null : Math.max(0, cartTotal + previousBalance - availableWallet);
  // The business chooses whether the amount starts at the recommended payment or at zero.
  const prefill = jobSettings.paymentPrefill === 'zero' ? 0 : (recommended ?? 0);
  // Split payment: the money received is the total of the parts.
  // AUD-37: a pending split sale under review opens with its parts, as they were sold.
  const originalSplit: SplitRow[] | null = initialCheckout?.splits?.length
    ? initialCheckout.splits.map((p) => ({
        methodLabel: p.methodLabel ?? p.method,
        amount: (p.amount / 100).toFixed(2),
      }))
    : null;
  const [splitRows, setSplitRows] = useState<SplitRow[] | null>(originalSplit);
  const splitChanged = !!originalSplit && JSON.stringify(splitRows) !== JSON.stringify(originalSplit);
  const cash = splitRows
    ? (splitTotal(splitRows) / 100).toFixed(2)
    : (cashOverride ?? (prefill / 100).toFixed(2));
  const parts = (() => {
    if (!splitRows) return null;
    try {
      return splitParts(ledger, splitRows, paymentMethods);
    } catch {
      return [];
    }
  })();
  const payMethod = parts?.length ? parts[0].method : method;
  const payLabel = parts?.length ? parts[0].methodLabel : methodLabel;
  let preview: CheckoutEvent | null = null,
    previewError = '';
  try {
    if (customer)
      preview = prepareCheckout(
        ledger,
        {
          customerId,
          termsAndConditions,
          newCustomer,
          lines: cartLines,
          countedMaterialJobs,
          orderDiscount: discountSpec(orderDiscount),
          discountPolicy,
          cashReceived: money(cash || '0'),
          useWallet,
          override: manual
            ? Object.entries(allocations)
                .filter(([, n]) => money(n || '0') > 0)
                .map(([jobId, n]) => ({ jobId, amount: money(n) }))
            : null,
          method: payMethod,
          methodLabel: payLabel,
          accountId: parts?.length ? (defaultMoneyAccount(ledger, payLabel) ?? undefined) : selectedAccount,
          ...(splitRows ? { splits: splitParts(ledger, splitRows, paymentMethods) } : {}),
          paidOn,
          reference,
        },
        actor,
        'preview',
        initialCheckout?.createdAt ?? new Date().toISOString(),
      ) as CheckoutEvent;
  } catch (cause) {
    previewError = cause instanceof Error ? cause.message : String(cause);
  }
  const outstanding = customer ? unpaidJobs(paymentLedger, customer.id) : [];
  function override() {
    try {
      const plan = paymentPlan(paymentLedger, customerId, money(cash || '0'), useWallet);
      setManualAllocations({
        amounts: Object.fromEntries(
          plan.allocations.map((a: { jobId: string; amount: number }) => [
            a.jobId,
            (a.amount / 100).toFixed(2),
          ]),
        ),
        editedOrder: [],
      });
      setManual(true);
    } catch (cause) {
      setError(String(cause));
    }
  }
  const limits: Record<string, number> = Object.fromEntries(
    outstanding.map((job: { id: string }) => [job.id, jobBalance(paymentLedger, job).outstanding]),
  );
  const limitsKey = JSON.stringify(limits);
  let allocationBudget: number | null = null;
  try {
    const funds = money(cash || '0') + (useWallet && customer ? walletBalance(working, customer.id) : 0);
    if (customer && cartReady && Number.isSafeInteger(funds) && funds >= 0) allocationBudget = funds;
  } catch {}
  useEffect(() => {
    if (busy || !manual || allocationBudget === null) return;
    const currentLimits = JSON.parse(limitsKey) as Record<string, number>;
    setManualAllocations((state) => {
      try {
        return balanceDraft(state, currentLimits, allocationBudget);
      } catch {
        return state;
      }
    });
  }, [busy, manual, allocationBudget, limitsKey]);
  function editAllocation(jobId: string, value: string) {
    setManualAllocations((state) => {
      try {
        if (allocationBudget !== null) return balanceDraft(state, limits, allocationBudget, jobId, value);
      } catch {}
      return {
        amounts: { ...state.amounts, [jobId]: value },
        editedOrder: [...state.editedOrder.filter((id) => id !== jobId), jobId],
      };
    });
  }
  // Stock each line takes now: its material, and the stock items of a template line.
  const shortage = preview?.data.jobs.reduce((s: Record<string, number>, j) => {
    const next = { ...s };
    if (j.materialId !== null) next[j.materialId] = (next[j.materialId] ?? 0) + j.materialNeeded;
    for (const x of j.templateSnapshot?.stock ?? [])
      next[x.materialId] = Math.round(((next[x.materialId] ?? 0) + x.quantity) * 1000) / 1000;
    return next;
  }, {});
  const blockShort = jobSettings.stockBelowZero === 'block';
  const short = shortage
    ? working.materials.filter((m) => (shortage[m.id] ?? 0) > 0 && m.available - shortage[m.id] < 0)
    : [];
  return (
    <>
      <Modal
        title={initialCheckout ? 'Review pending checkout' : paymentOnly ? 'Receive payment' : 'New checkout'}
        wide
        busy={busy}
        onClose={onClose}
        footer={
          <DialogActions
            form={formId}
            busy={busy}
            disabled={blockShort && short.length > 0}
            onCancel={onClose}
            extra={
              onHold &&
              !initialCheckout &&
              !paymentOnly &&
              lines.some((l) => l.serviceId) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    const data: HeldCheckout = {
                      lines,
                      customerId,
                      query,
                      newCustomer,
                      orderDiscount,
                      termsAndConditions,
                      ...(fromQuotation ? { fromQuotation } : {}),
                    };
                    onHold({
                      id: held?.id ?? String(crypto.randomUUID()),
                      kind: 'checkout',
                      heldAt: new Date().toISOString(),
                      heldBy: actor.label,
                      customerName: query.trim(),
                      items: lines.filter((l) => l.serviceId).map((l) => l.description || 'Item'),
                      total: cartTotal,
                      data,
                    });
                  }}
                >
                  <Icon name="pause" /> Hold sale
                </button>
              )
            }
            summary={
              !paymentOnly && (
                <>
                  <small>Total</small>
                  <strong>{cartTotal === null ? '—' : currency(cartTotal)}</strong>
                </>
              )
            }
          >
            Complete checkout
          </DialogActions>
        }
      >
        {initialCheckout && (
          <p className="notice">
            This checkout is already saved on this device. Keep the money received as originally collected; do
            not collect it again. Review updated prices, wallet credit and allocations before confirming. An
            earlier pending receipt will be replaced.
          </p>
        )}
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        {stockCountChanged && (
          <div className="notice notice-warning">
            <strong>A newer stock count affects this checkout.</strong>
            <p>
              {w(
                'Confirm whether these jobs were included in the physical count. Select the jobs whose material usage was already included in the physical count. Their sales and payments will be saved without deducting stock twice. Unselected jobs deduct stock normally.',
              )}
            </p>
            {countedReviewJobs.map((job) => (
              <label className="check-label" key={job.id}>
                <input
                  type="checkbox"
                  checked={countedMaterialJobs.includes(job.id)}
                  onChange={(e) =>
                    setCountedMaterialJobs((current) =>
                      e.target.checked ? [...current, job.id] : current.filter((id) => id !== job.id),
                    )
                  }
                />
                Already included in physical count: {job.description}
              </label>
            ))}
            <label className="check-label">
              <input
                type="checkbox"
                checked={stockReviewConfirmed}
                onChange={(e) => setStockReviewConfirmed(e.target.checked)}
              />
              {w('I have reviewed the stock count and the material deduction.')}
            </label>
          </div>
        )}
        <form
          id={formId}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setError('');
            try {
              if (stockCountChanged && !stockReviewConfirmed)
                throw Error('Confirm the stock-count review before saving.');
              if (!preview) {
                if (!customer) document.getElementById('checkout-customer-input')?.focus();
                throw Error(previewError || 'Select a customer.');
              }
              const event = prepareCheckout(
                ledger,
                {
                  customerId,
                  termsAndConditions,
                  newCustomer,
                  lines: cartLines,
                  countedMaterialJobs,
                  orderDiscount: discountSpec(orderDiscount),
                  discountPolicy,
                  cashReceived: money(cash || '0'),
                  useWallet,
                  override: manual
                    ? Object.entries(allocations)
                        .filter(([, n]) => money(n || '0') > 0)
                        .map(([jobId, n]) => ({ jobId, amount: money(n) }))
                    : null,
                  method: payMethod,
                  methodLabel: payLabel,
                  accountId: parts?.length
                    ? (defaultMoneyAccount(ledger, payLabel) ?? undefined)
                    : selectedAccount,
                  ...(splitRows ? { splits: splitParts(ledger, splitRows, paymentMethods) } : {}),
                  paidOn,
                  reference,
                  ...(fromQuotation ? { quotationId: fromQuotation.quotationId } : {}),
                },
                actor,
                String(crypto.randomUUID()),
                initialCheckout?.createdAt ?? new Date().toISOString(),
              ) as CheckoutEvent;
              const record = await onSave(event);
              onClose();
              onReceipt(record);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <fieldset disabled={busy}>
            {fromQuotation && (
              <div className="notice" role="status">
                <strong>From quotation {fromQuotation.reference}.</strong>{' '}
                {fromQuotation.customerId
                  ? 'Check the details, take any payment and complete checkout.'
                  : `${fromQuotation.customerName}${fromQuotation.customerPhone ? ` (${fromQuotation.customerPhone})` : ''} is not a saved customer yet: choose them or use Add new customer.`}
                {fromQuotation.changes.length > 0 && (
                  <>
                    {' '}
                    Prices are charged at today's rates. Changed since the quote:
                    <ul>
                      {fromQuotation.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {!paymentOnly && (
              <>
                <h3>{w('Jobs in this checkout')}</h3>
                {lines.map((item, index) => {
                  const template = working.pricing?.templates.find((t) => t.id === item.serviceId);
                  const service = working.services.find((s) => s.id === item.serviceId),
                    material = serviceMaterial(working, service);
                  const quote = quotedLines[index];
                  const templateCheck = template
                    ? tryTemplate(working, template, item.templateInputs ?? {}, item.quantity)
                    : null;
                  const quantityVariable = template?.variables.find((v) => v.key === 'quantity');
                  return (
                    <section className="cart-line" key={item.id}>
                      <div className="cart-line-title">
                        <strong>
                          {w('Job')} {index + 1}
                          {service?.shelfItem && <span className="badge paid">Shelf</span>}
                        </strong>
                        {lines.length > 1 && (
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => setLines((v) => v.filter((j) => j.id !== item.id))}
                          >
                            <Icon name="close" /> {w('Remove job')}
                          </button>
                        )}
                      </div>
                      <div className="form-grid">
                        <label>
                          {w('Service')}
                          <SearchSelect
                            label={w('Service')}
                            required
                            value={item.serviceId}
                            placeholder={w('Select service')}
                            options={[
                              ...(working.pricing?.enabled
                                ? working.pricing.templates
                                    .filter((t) => !t.archived)
                                    .map((t) => ({
                                      value: t.id,
                                      label: `${t.name} — Template`,
                                      group: 'Pricing templates',
                                    }))
                                : []),
                              ...working.services
                                .filter(
                                  (s) =>
                                    !s.archived &&
                                    !s.private &&
                                    (s.materialId === null ||
                                      working.materials.some((m) => m.id === s.materialId && !m.archived)),
                                )
                                .map((s) => ({
                                  value: s.id,
                                  label: s.customPrice
                                    ? `${s.description} — price entered at sale`
                                    : `${s.description} — ${currency(s.price)}${s.packPrices?.length ? ` · ${packList(s.packPrices)}` : ''}${s.priceTiers?.length ? ` · ${tierList(s.price, s.priceTiers)}` : ''}`,
                                  group: working.pricing?.enabled ? w('Services') : undefined,
                                })),
                            ]}
                            onChange={(next) => {
                              const chosenTemplate = working.pricing?.templates.find((t) => t.id === next);
                              // Templates and shelf items fill in their name as the description; staff can
                              // change it. A filled-in name follows the item when another is chosen.
                              const autoOf = (id: string) => {
                                const t = working.pricing?.templates.find((x) => x.id === id);
                                if (t) return t.name;
                                const s = working.services.find((x) => x.id === id);
                                return s?.shelfItem ? s.description.slice(0, 500) : '';
                              };
                              setLines((items) =>
                                items.map((line) =>
                                  line.id === item.id
                                    ? {
                                        ...line,
                                        serviceId: next,
                                        ...workflowLine(next),
                                        templateSnapshot: undefined,
                                        templateInputs: chosenTemplate
                                          ? templateDefaults(chosenTemplate)
                                          : undefined,
                                        templateStockIds: chosenTemplate ? {} : undefined,
                                        // A custom-price service starts at its suggested price.
                                        priceText: working.services.find((x) => x.id === next)?.customPrice
                                          ? (
                                              (working.services.find((x) => x.id === next)?.price ?? 0) / 100
                                            ).toFixed(2)
                                          : undefined,
                                        description: nextDescription(
                                          line.description,
                                          autoOf(line.serviceId),
                                          autoOf(next),
                                        ),
                                        ...(chosenTemplate
                                          ? {
                                              quantity: String(
                                                chosenTemplate.variables.find((v) => v.key === 'quantity')
                                                  ?.default ?? 1,
                                              ),
                                            }
                                          : {}),
                                      }
                                    : line,
                                ),
                              );
                            }}
                          />
                        </label>
                        {jobSettings.descriptionMode !== 'hidden' && (
                          <label>
                            {w('Job description')}
                            {jobSettings.descriptionMode === 'optional' ? ' (optional)' : ''}
                            <input
                              required={jobSettings.descriptionMode === 'required'}
                              maxLength={500}
                              value={item.description}
                              onChange={(e) => editLine(item.id, 'description', e.target.value)}
                            />
                          </label>
                        )}
                        <label>
                          {quantityVariable?.label ?? 'Quantity'}
                          <input
                            type="number"
                            min={quantityVariable?.min ?? 0.001}
                            max={quantityVariable?.max ?? 1000000}
                            step={quantityVariable?.integer ? 1 : 0.001}
                            required
                            value={item.quantity}
                            onChange={(e) => editLine(item.id, 'quantity', e.target.value)}
                          />
                          {templateCheck?.field === 'quantity' && (
                            <small className="danger-text" role="alert">
                              {templateCheck.error}
                            </small>
                          )}
                          {!template && belowMinimum(service, item.quantity) && (
                            <small className={minOrderRule() === 'block' ? 'danger-text' : 'stock-near-text'}>
                              {belowMinimum(service, item.quantity)}
                            </small>
                          )}
                        </label>
                        {service?.customPrice && (
                          <label>
                            Price per item (₦)
                            <CurrencyInput
                              aria-label="Price per item (₦)"
                              value={item.priceText ?? ''}
                              required
                              onValueChange={(value) =>
                                setLines((items) =>
                                  items.map((l) => (l.id === item.id ? { ...l, priceText: value } : l)),
                                )
                              }
                            />
                          </label>
                        )}
                        {template && (
                          <TemplateInputs
                            template={template}
                            ledger={working}
                            errorField={templateCheck?.field}
                            error={templateCheck?.error}
                            value={item.templateInputs ?? {}}
                            onChange={(value) =>
                              setLines((items) =>
                                items.map((l) => (l.id === item.id ? { ...l, templateInputs: value } : l)),
                              )
                            }
                          />
                        )}
                        {material?.requireSize && (
                          <>
                            <label>
                              Width
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                max="1000000"
                                required
                                value={item.width}
                                onChange={(e) => editLine(item.id, 'width', e.target.value)}
                              />
                            </label>
                            <label>
                              Height
                              <input
                                type="number"
                                min="0.001"
                                step="0.001"
                                max="1000000"
                                required
                                value={item.height}
                                onChange={(e) => editLine(item.id, 'height', e.target.value)}
                              />
                            </label>
                          </>
                        )}
                        <label>
                          {w('Job received through')}
                          <SearchSelect
                            label={w('Job received through')}
                            value={item.source}
                            onChange={(next) => editLine(item.id, 'source', next)}
                            options={[...new Set([...jobSources, item.source])].map((s) => ({
                              value: s,
                              label: s,
                            }))}
                          />
                        </label>
                        <label>
                          Source details
                          <input
                            maxLength={200}
                            placeholder="Optional sender, device or reference"
                            value={item.sourceNote}
                            onChange={(e) => editLine(item.id, 'sourceNote', e.target.value)}
                          />
                        </label>
                        {!service?.shelfItem && (
                          <label>
                            Deadline
                            <input
                              type="datetime-local"
                              aria-label="Deadline"
                              value={toLocalInput(item.dueAt ?? '')}
                              onChange={(e) => editLine(item.id, 'dueAt', fromLocalInput(e.target.value))}
                            />
                            <small>
                              {item.dueAt ? 'Clear it for no deadline. ' : 'No deadline. '}
                              Business default: {durationLabel(jobSettings.defaultDuration).toLowerCase()}.
                            </small>
                            <TightDeadline
                              line={toLine(item)}
                              jobStages={options.jobStages}
                              stageHours={options.stageHours}
                            />
                          </label>
                        )}
                      </div>
                      {!service?.shelfItem && (
                        <div className="job-steps">
                          <span>
                            {w('Steps')}:{' '}
                            {(item.steps
                              ? stepsWorkflow(item.steps).stages
                              : (item.workflow ?? options.jobStages)
                            )
                              .map((s) => stage(s))
                              .join(' → ')}
                          </span>
                          {canChooseWorkflow && (
                            <button
                              type="button"
                              className="text-button"
                              aria-expanded={stepsFor === item.id}
                              onClick={() => {
                                setStepsFor(stepsFor === item.id ? null : item.id);
                                if (!item.steps)
                                  setLines((items) =>
                                    items.map((l) =>
                                      l.id === item.id
                                        ? {
                                            ...l,
                                            steps: stagesToSteps(
                                              l.workflow ?? options.jobStages,
                                              l.stageHours,
                                            ),
                                          }
                                        : l,
                                    ),
                                  );
                              }}
                            >
                              {stepsFor === item.id ? 'Done' : 'Edit steps'}
                            </button>
                          )}
                          {canChooseWorkflow &&
                            stepsFor === item.id &&
                            item.steps &&
                            (options.workflows ?? []).length > 0 && (
                              <label className="job-steps-copy">
                                {w('Copy a saved workflow')}
                                <SearchSelect
                                  label={`${w('Job')} ${index + 1}: copy a saved workflow`}
                                  value=""
                                  placeholder={w('Choose…')}
                                  onChange={(id) => {
                                    const wf = (options.workflows ?? []).find((x) => x.id === id);
                                    if (!wf) return;
                                    setLines((items) =>
                                      items.map((l) =>
                                        l.id === item.id
                                          ? {
                                              ...l,
                                              steps: wf.steps.map((st) => ({ ...st })),
                                              workflowName: wf.name,
                                            }
                                          : l,
                                      ),
                                    );
                                  }}
                                  options={(options.workflows ?? []).map((wf) => ({
                                    value: wf.id,
                                    label: wf.name,
                                  }))}
                                />
                              </label>
                            )}
                          {canChooseWorkflow && stepsFor === item.id && item.steps && (
                            <StepBuilder
                              steps={item.steps}
                              label={`${w('Job')} ${index + 1} steps`}
                              onChange={(steps) =>
                                setLines((items) =>
                                  items.map((l) => (l.id === item.id ? { ...l, steps } : l)),
                                )
                              }
                            />
                          )}
                        </div>
                      )}
                      {(discountPolicy.maxPercent > 0 || item.discountDraft?.kind) && (
                        <DiscountFields
                          label={w('Job discount')}
                          value={item.discountDraft ?? noDiscount()}
                          allowFlat={discountPolicy.canFlat}
                          maxPercent={discountPolicy.maxPercent}
                          onChange={(value) =>
                            setLines((items) =>
                              items.map((line) =>
                                line.id === item.id ? { ...line, discountDraft: value } : line,
                              ),
                            )
                          }
                        />
                      )}
                      {!orderDiscount.kind && (
                        <TemplateDiscountWarning
                          jobs={priced?.jobs.filter((j) => j.id === item.id) ?? []}
                          allowed={discountPolicy.canFlat}
                        />
                      )}
                      {quote && (
                        <p>
                          {quote.templateSnapshot
                            ? [
                                w('Template'),
                                ...(quote.templateSnapshot.stock.length
                                  ? [
                                      `Stock: ${quote.templateSnapshot.stock.map((s: { quantity: number; unit: string; name: string }) => `${s.quantity} ${s.unit} ${s.name}`).join(', ')}`,
                                    ]
                                  : quote.templateSnapshot.choices
                                    ? []
                                    : [w('No stock deduction')]),
                                ...(quote.templateSnapshot.choices ?? []).map(
                                  (c: { name: string; work: number; unit: string }) =>
                                    `${c.name}: ${c.work} ${c.unit}, ${w('material confirmed in production')}`,
                                ),
                              ].join(' · ')
                            : quote.materialChoice
                              ? `${w('Material')}: ${quote.materialChoice.options
                                  .map(
                                    (id: string) => working.materials.find((m) => m.id === id)?.name ?? '?',
                                  )
                                  .join(
                                    ' / ',
                                  )} · ${quote.materialChoice.work} ${quote.measurementUnit} · ${w('confirmed when the job leaves')} ${stage(quote.materialChoice.confirmStage)}`
                              : quote.materialId === null
                                ? w('No material · No stock deduction')
                                : `${w('Material')}: ${material?.name} · Usage: ${quote.materialNeeded} ${quote.measurementUnit}`}
                          {service?.shelfItem ? ' · Collected when sold' : ''} ·{' '}
                          <strong>{currency(quote.amount)}</strong>
                          {quote.lineDiscount > 0 && (
                            <small>
                              {' '}
                              (price {currency(quote.grossAmount)}, discount −{currency(quote.lineDiscount)})
                            </small>
                          )}
                          {service?.priceTiers?.length ? (
                            <small>
                              {' '}
                              {quote.quantity} × {currency(quote.unitPrice)} (range price:{' '}
                              {tierList(service.price, service.priceTiers)})
                            </small>
                          ) : null}
                          {service?.packPrices?.length && !quote.requireSize ? (
                            <small>
                              {packSummary(service.price, service.packPrices, quote.quantity) ||
                                `Pack prices: ${packList(service.packPrices)}`}
                            </small>
                          ) : null}
                        </p>
                      )}
                      {template && (
                        <TemplateEstimate
                          ledger={working}
                          template={template}
                          inputs={item.templateInputs ?? {}}
                          quantity={item.quantity}
                          amount={priced?.jobs[index]?.amount ?? quote?.amount}
                          error=""
                        />
                      )}
                    </section>
                  );
                })}
                <button
                  type="button"
                  className="secondary"
                  disabled={lines.length >= 50}
                  onClick={() => setLines((v) => [...v, newLine()])}
                >
                  <Icon name="add" /> {w('Add another service')}
                </button>
                {(discountPolicy.canFlat || orderDiscount.kind) && lines.length > 0 && (
                  <DiscountFields
                    label="Order discount"
                    value={orderDiscount}
                    allowFlat={discountPolicy.canFlat}
                    maxPercent={discountPolicy.maxPercent}
                    onChange={setOrderDiscount}
                  />
                )}
                {!!orderDiscount.kind && (
                  <TemplateDiscountWarning jobs={priced?.jobs ?? []} allowed={discountPolicy.canFlat} />
                )}
                <p className="cart-total" aria-live="polite">
                  {cartTotal !== null && cartGross > cartTotal && (
                    <small>
                      Before discounts {currency(cartGross)} · Discounts −{currency(cartGross - cartTotal)}
                    </small>
                  )}
                  <strong>Total: {cartTotal === null ? '—' : currency(cartTotal)}</strong>
                  {cartTotal === null && (
                    <small>{w('Complete all job details to calculate the total.')}</small>
                  )}
                </p>
              </>
            )}
            <h3>Payment</h3>
            {clash && !customer && offlineCustomer.event && (
              <div className="notice notice-warning" role="alert">
                <strong>
                  The customer added offline ({offlineCustomer.event.data.name}
                  {offlineCustomer.event.data.phone ? `, ${offlineCustomer.event.data.phone}` : ''}) cannot be
                  created.
                </strong>
                <p>{clash.message}</p>
                <p>
                  Choose the existing customer if it is the same person, or add the customer again with a
                  different phone number.
                </p>
                {clash.owner && !clash.owner.archived && (
                  <button type="button" onClick={() => choose(clash.owner!.id, clash.owner!.name)}>
                    <Icon name="customers" /> Use {clash.owner.name}
                  </button>
                )}
              </div>
            )}
            <section className="checkout-customer" data-selected={!!customer} aria-label="Customer">
              <div id="checkout-customer-fields">
                {' '}
                <div
                  className="customer-picker"
                  onBlur={(event) => {
                    // iOS Safari blurs the field before the tapped suggestion's click arrives, and
                    // reports no relatedTarget; close a moment later unless focus stayed inside.
                    const picker = event.currentTarget;
                    if (picker.contains(event.relatedTarget as Node | null)) return;
                    setTimeout(() => {
                      if (!picker.contains(document.activeElement)) setSuggest(false);
                    }, 200);
                  }}
                >
                  <label>
                    Customer name or phone
                    <input
                      id="checkout-customer-input"
                      role="combobox"
                      aria-expanded={suggest}
                      aria-controls="customer-matches"
                      aria-autocomplete="list"
                      aria-activedescendant={
                        suggest && matches[active] ? `customer-option-${active}` : undefined
                      }
                      value={query}
                      autoComplete="off"
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCustomerId('');
                        setSuggest(!!e.target.value.trim());
                        setActive(0);
                        setManual(false);
                        setManualAllocations({ amounts: {}, editedOrder: [] });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' && suggest) {
                          e.preventDefault();
                          setActive((n) => Math.min(n + 1, matches.length - 1));
                        } else if (e.key === 'ArrowUp' && suggest) {
                          e.preventDefault();
                          setActive((n) => Math.max(0, n - 1));
                        } else if (e.key === 'Enter' && suggest && matches[active]) {
                          e.preventDefault();
                          choose(matches[active].id, matches[active].name);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setSuggest(false);
                        }
                      }}
                    />
                  </label>
                  {suggest && (
                    <div id="customer-matches" role="listbox" aria-label="Customer suggestions">
                      {matches.map((c, index) => (
                        <button
                          key={c.id}
                          id={`customer-option-${index}`}
                          type="button"
                          role="option"
                          aria-selected={index === active}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(c.id, c.name)}
                        >
                          <strong>{c.name}</strong> <span>{c.phone || 'No phone recorded'}</span>
                        </button>
                      ))}
                      {!matches.length && <p>No matching customer.</p>}
                    </div>
                  )}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setSuggest(false);
                      setAddingCustomer(true);
                    }}
                  >
                    <Icon name="add" /> Add new customer
                  </button>
                </div>
                {customer && (
                  <p className="muted">
                    {customer.phone} · Wallet: {currency(walletBalance(working, customer.id))}
                  </p>
                )}
              </div>
            </section>
            <div className="form-grid">
              <label>
                Money received (₦)
                <CurrencyInput required value={cash} disabled={!!splitRows} onValueChange={setCashOverride} />
                {splitRows && <small>The total of the split.</small>}
              </label>
              <label>
                Payment method
                {money(cash || '0') === 0 && !splitRows ? (
                  // No money taken: wallet credit (if it covers anything) or nothing.
                  <select aria-label="Payment method" disabled value="none">
                    <option value="none">{preview?.data.walletUsed ? 'Wallet' : 'None'}</option>
                  </select>
                ) : (
                  <SearchSelect
                    label="Payment method"
                    value={splitRows ? SPLIT : methodLabel}
                    onChange={(next) => {
                      if (next !== SPLIT) {
                        setSplitRows(null);
                        return setMethodLabel(next);
                      }
                      setSplitRows(startSplit(paymentMethods, methodLabel, cash));
                    }}
                    options={paymentMethods.map((item) => ({
                      value: item.label,
                      label: ('displayLabel' in item && item.displayLabel) || item.label,
                    }))}
                    pinned={
                      !initialCheckout && paymentMethods.length > 1
                        ? [{ value: SPLIT, label: 'Split between methods…' }]
                        : []
                    }
                  />
                )}
              </label>
              <label>
                Payment date
                <input type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
              <label>
                Reference / note
                <input maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            {originalSplit && (
              <p className={splitChanged ? 'notice' : 'muted'} role={splitChanged ? 'status' : undefined}>
                Sold as a split:{' '}
                {originalSplit.map((r) => `${r.methodLabel} ${currency(money(r.amount))}`).join(' · ')}.
                {splitChanged
                  ? ' You are changing how it was paid: check with the cashier before saving.'
                  : ''}
              </p>
            )}
            {splitRows && (
              <SplitPayment
                rows={splitRows}
                methods={paymentMethods}
                onChange={setSplitRows}
                onCancel={() => {
                  setCashOverride(cash);
                  setSplitRows(null);
                }}
              />
            )}
            <details>
              <summary>Terms &amp; conditions</summary>
              <label>
                Terms for this sales document
                <textarea
                  maxLength={5000}
                  aria-label="Terms for this sales document"
                  value={termsAndConditions}
                  onChange={(e) => setTermsAndConditions(e.target.value)}
                />
              </label>
              <DefaultTermsButton
                value={termsAndConditions}
                defaults={defaultTerms}
                kind="invoice / sales document"
                onUse={setTermsAndConditions}
              />
            </details>
            {!initialCheckout && recommended !== null && (
              <div className="payment-recommendation">
                <p>
                  Recommended payment: <strong>{currency(recommended)}</strong>
                  <small>
                    {w('New jobs')} {currency(cartTotal ?? 0)} + previous unpaid balance{' '}
                    {currency(previousBalance)} − wallet credit{' '}
                    {currency(Math.min(Math.max(0, availableWallet), (cartTotal ?? 0) + previousBalance))}
                  </small>
                </p>
                {!splitRows && (cashOverride !== null || jobSettings.paymentPrefill === 'zero') && (
                  <button
                    type="button"
                    className="secondary"
                    // Following the recommendation keeps it in step with cart changes.
                    onClick={() =>
                      setCashOverride(
                        jobSettings.paymentPrefill === 'zero' ? (recommended / 100).toFixed(2) : null,
                      )
                    }
                  >
                    <Icon name="calculator" /> Use recommended amount
                  </button>
                )}
              </div>
            )}
            <label className="check-label">
              <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />{' '}
              Use available wallet credit when needed
            </label>
            <div className="allocation-heading">
              <h3>{w('Job allocations')}</h3>
              <button
                type="button"
                className="secondary"
                onClick={() => (manual ? setManual(false) : override())}
              >
                <Icon name="edit" /> {manual ? 'Use automatic allocation' : 'Override allocation'}
              </button>
            </div>
            <p className="muted">
              {manual
                ? w(
                    'Your latest edit takes priority. When allocations exceed the available money, earlier-edited allocations reduce first. Each allocation stays within the job’s outstanding balance.',
                  )
                : w('Automatic allocation pays the oldest unpaid jobs first, including earlier orders.')}
            </p>
            {manual && allocationBudget !== null && (
              <p className="muted">
                Available to allocate:{' '}
                {currency(
                  Math.min(
                    allocationBudget,
                    Object.values(limits).reduce((sum, n) => sum + n, 0),
                  ),
                )}
              </p>
            )}
            {outstanding.map((job: { id: string; description: string; service: string }) => (
              <div className="allocation" key={job.id}>
                <span className="allocation-job">
                  <strong className="allocation-service">{job.service}</strong>
                  <small>Outstanding: {currency(jobBalance(paymentLedger, job).outstanding)}</small>
                  <small className="allocation-description" title={job.description}>
                    {job.description}
                  </small>
                  <small>
                    {w('Job')} #{job.id.slice(0, 8).toUpperCase()}
                  </small>
                </span>
                {manual ? (
                  <CurrencyInput
                    aria-label={`Allocate to ${job.service}: ${job.description} (${w('Job')} ${job.id.slice(0, 8).toUpperCase()})`}
                    max={jobBalance(paymentLedger, job).outstanding / 100}
                    value={allocations[job.id] ?? ''}
                    onValueChange={(value) => editAllocation(job.id, value)}
                  />
                ) : (
                  <strong>
                    {currency(preview?.data.allocations.find((a) => a.jobId === job.id)?.amount ?? 0)}
                  </strong>
                )}
              </div>
            ))}
            {preview && (
              <div className="checkout-summary">
                <p>
                  {w('New jobs')} <strong>{currency(preview.data.total)}</strong>
                </p>
                <p>
                  Wallet used <strong>{currency(preview.data.walletUsed)}</strong>
                </p>
                <p>
                  Added to wallet <strong>{currency(preview.data.walletAdded)}</strong>
                </p>
                <p>
                  Wallet after checkout <strong>{currency(preview.data.walletAfter)}</strong>
                </p>
                <p>
                  Customer outstanding <strong>{currency(preview.data.outstandingAfter)}</strong>
                </p>
              </div>
            )}
            {preview && customer && preview.data.outstandingAfter > customer.creditLimit && (
              <p className="notice notice-warning" role="status">
                Credit limit exceeded by {currency(preview.data.outstandingAfter - customer.creditLimit)}. You
                can still save this order.
              </p>
            )}
            {short.map((m) =>
              blockShort ? (
                <p className="notice notice-error" role="alert" key={m.id}>
                  {notEnoughStock(m, m.available, shortage![m.id])}
                </p>
              ) : (
                <p className="notice notice-warning" role="status" key={m.id}>
                  Stock warning: {m.name} will have{' '}
                  {Math.round((m.available - shortage![m.id]) * 1000) / 1000} {m.measurementUnit}. Saving is
                  allowed; later restocking adds to this balance.
                </p>
              ),
            )}
            {previewError && customer && <p className="muted">{previewError}</p>}
          </fieldset>
        </form>
      </Modal>
      {addingCustomer && (
        <CustomerEditor
          // From a quotation for someone not saved yet: their name and phone are filled in (the name
          // as typed in the customer box, when it was changed).
          prefill={
            customerId
              ? undefined
              : {
                  name: query.trim() || fromQuotation?.customerName,
                  phone:
                    fromQuotation && (!query.trim() || query.trim() === fromQuotation.customerName.trim())
                      ? fromQuotation.customerPhone
                      : undefined,
                }
          }
          customers={working.customers}
          actor={actor}
          busy={busy}
          onClose={() => setAddingCustomer(false)}
          onSave={async (event) => {
            if (event.kind !== 'customer.created') throw Error('Add a new customer.');
            setNewCustomer(event);
            choose(event.data.id, event.data.name!);
          }}
        />
      )}
    </>
  );
}
