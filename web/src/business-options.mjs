export const defaultOptions = () => ({
  paymentMethods: [
    { label: 'Cash', kind: 'Cash', enabled: true },
    { label: 'POS', kind: 'POS', enabled: true },
    { label: 'Transfer', kind: 'Transfer', enabled: true },
  ],
  expenseCategories: [
    'Materials',
    'Electricity',
    'Fuel',
    'Rent',
    'Wages',
    'Maintenance',
    'Delivery',
    'Outsourcing',
    'Internet / phone',
    'Other',
  ],
  jobSources: ['In shop / USB', 'Shop network', 'WhatsApp', 'Email', 'Other'],
  stockReasons: ['Restocking', 'Stock Count Correction', 'Returned Stock', 'Damaged Stock'],
  materialUnits: ['sheet', 'piece', 'metre', 'square metre', 'roll', 'kilogram', 'litre'],
  jobStages: ['Added', 'In Queue', 'Printing', 'Completed', 'Collected'],
});
export function validateList(values, label, max = 80) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 30)
    throw Error(`${label}: enter 1–30 options.`);
  const list = values.map((value) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > max ||
      /[\x00-\x1f\x7f]/.test(value)
    )
      throw Error(`${label}: each option needs a name up to ${max} characters.`);
    return value.trim();
  });
  if (new Set(list.map((value) => value.toLowerCase())).size !== list.length)
    throw Error(`${label}: remove duplicate names.`);
  return list;
}
export function validateWorkflow(value) {
  const stages = validateList(value, 'Job stages');
  if (
    stages.length < 3 ||
    stages.length > 20 ||
    stages[0] !== 'Added' ||
    stages.at(-2) !== 'Completed' ||
    stages.at(-1) !== 'Collected'
  )
    throw Error('Job stages must start with Added and end with Completed, then Collected (up to 20 stages).');
  return stages;
}
export function validateOptions(input) {
  const value = { ...defaultOptions(), ...input };
  for (const [key, label, max] of [
    ['expenseCategories', 'Expense categories', 80],
    ['jobSources', 'Job sources', 80],
    ['stockReasons', 'Stock reasons', 200],
    ['materialUnits', 'Material units', 40],
  ])
    value[key] = validateList(value[key], label, max);
  value.jobStages = validateWorkflow(value.jobStages);
  if (
    !Array.isArray(value.paymentMethods) ||
    !value.paymentMethods.length ||
    value.paymentMethods.length > 30
  )
    throw Error('Enter 1–30 payment methods.');
  validateList(
    value.paymentMethods.map((item) => item?.label),
    'Payment methods',
  );
  value.paymentMethods = value.paymentMethods.map((item) => {
    if (!['Cash', 'POS', 'Transfer'].includes(item.kind) || typeof item.enabled !== 'boolean')
      throw Error('Choose an accounting type for each payment method.');
    return { label: item.label.trim(), kind: item.kind, enabled: item.enabled };
  });
  if (!value.paymentMethods.some((item) => item.enabled))
    throw Error('Keep at least one payment method enabled.');
  return value;
}
export const jobWorkflow = (job) => validateWorkflow(job.workflow ?? defaultOptions().jobStages);
/**
 * How a payment or checkout was paid. No money taken shows as "Wallet" when customer credit
 * covered it, otherwise "None" — never the method that happened to be selected.
 */
export const paymentName = (record) => {
  const money = record.cashReceived ?? record.amount;
  // Refunds carry the money paid out in walletUsed, so they keep their method.
  if (money === 0 && !record.refundId) return record.walletUsed ? 'Wallet' : 'None';
  return record.methodLabel || record.method;
};
