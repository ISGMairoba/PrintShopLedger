export function materialCode(id, materials = []) {
  const compact = id.replaceAll('-', '').toUpperCase();
  for (let length = Math.min(8, compact.length); length <= compact.length; length += 2) {
    const code = compact.slice(0, length);
    if (
      !materials.some((item) => item.id !== id && item.id.replaceAll('-', '').toUpperCase().startsWith(code))
    )
      return 'MAT-' + code;
  }
  return 'MAT-' + compact;
}
export const materialActionLabels = {
  'material.wasted': 'Waste / damage / reprint',
  'material.job_corrected': 'Job entry stock correction',
  'material.sale_returned': 'Cancelled sale: stock returned',
  'material.expense_stock_changed': 'Expense stock change',
  'material.job_used': 'Job material used',
  'material.created': 'Material created',
  'material.updated': 'Material edited',
  'material.stock_added': 'Stock added',
  'material.stock_set': 'Quantity set',
  'material.archived': 'Material archived',
  'material.restored': 'Material restored',
  'material.transferred': 'Stock transferred',
};
export const stockReasonDefaults = [
  'Restocking',
  'Stock Count Correction',
  'Returned Stock',
  'Damaged Stock',
];
export function stockReasonSuggestions(history) {
  const values = [
    ...stockReasonDefaults,
    ...[...history]
      .reverse()
      .filter((item) => item.action.startsWith('material.stock_'))
      .map((item) => item.reason),
  ];
  const seen = new Set();
  return values
    .map((value) => value?.trim())
    .filter((value) => {
      if (!value || seen.has(value.toLowerCase())) return false;
      seen.add(value.toLowerCase());
      return true;
    });
}
export function materialSnapshot(material) {
  if (!material) return null;
  return {
    name: material.name,
    available: material.available,
    minimumStock: material.minimumStock ?? 0,
    measurementUnit: material.measurementUnit,
    requireSize: material.requireSize,
    archived: material.archived,
  };
}

export function stockLevel(material) {
  if (material.archived) return null;
  const minimum = material.minimumStock ?? 0;
  if (material.available <= minimum) return 'Critical';
  if (minimum > 0 && material.available <= Math.round(minimum * 1.2 * 1000) / 1000) return 'Near minimum';
  return null;
}

/** Dropdown text for a long name: very long option text makes selects overflow narrow screens (notably Safari). */
export const shortLabel = (text, max = 60) => {
  const value = String(text ?? '');
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
};
