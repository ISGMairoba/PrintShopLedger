export function materialCode(id, materials = []) {
  const compact = id.replaceAll('-', '').toUpperCase();
  for (let length = Math.min(8, compact.length); length <= compact.length; length += 2) {
    const code = compact.slice(0, length);
    if (!materials.some(item => item.id !== id && item.id.replaceAll('-', '').toUpperCase().startsWith(code))) return 'MAT-' + code;
  }
  return 'MAT-' + compact;
}
export const materialActionLabels = {
  'material.expense_stock_changed': 'Expense stock change', 'material.job_used': 'Job material used', 'material.created': 'Material created', 'material.updated': 'Material edited',
  'material.stock_added': 'Stock added', 'material.stock_set': 'Quantity set',
  'material.archived': 'Material archived', 'material.restored': 'Material restored'
};
export const stockReasonDefaults = ['Restocking', 'Stock Count Correction', 'Returned Stock', 'Damaged Stock'];
export function stockReasonSuggestions(history) {
  const values = [...stockReasonDefaults, ...[...history].reverse().filter(item => item.action.startsWith('material.stock_')).map(item => item.reason)];
  const seen = new Set();
  return values.map(value => value?.trim()).filter(value => {
    if (!value || seen.has(value.toLowerCase())) return false;
    seen.add(value.toLowerCase()); return true;
  });
}
export function materialSnapshot(material) {
  if (!material) return null;
  return { name: material.name, available: material.available, measurementUnit: material.measurementUnit, requireSize: material.requireSize, archived: material.archived };
}

