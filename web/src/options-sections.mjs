// Save one options section without committing the other section's unsaved edits.
export function mergeOptionsSection(saved, draft, section) {
  return section === 'payments'
    ? { ...saved, paymentMethods: draft.paymentMethods }
    : { ...draft, paymentMethods: saved.paymentMethods };
}
