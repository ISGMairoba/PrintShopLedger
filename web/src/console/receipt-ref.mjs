/** A subscription payment's receipt number as printed: PSL-000012. */
export const receiptRef = (no) => `PSL-${String(no ?? 0).padStart(6, '0')}`;
