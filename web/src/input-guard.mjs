// Number and phone fields accept only what belongs in them, as it is typed or pasted: letters typed
// into a quantity, amount or phone number are refused on the spot with a short hint by the field.
// Pasted text keeps only the allowed characters ("Tel: 0803 123 4567" pastes as "0803 123 4567").

/** Which kind of entry a field takes, from its type and inputmode; null for ordinary text. */
export function entryKind(input) {
  if (!input || input.tagName !== 'INPUT' || input.readOnly || input.dataset?.anyText !== undefined)
    return null;
  const type = (input.getAttribute('type') ?? 'text').toLowerCase();
  const mode = (input.getAttribute('inputmode') ?? '').toLowerCase();
  if (type === 'tel' || mode === 'tel') return 'phone';
  if (type === 'number') return 'number';
  if (mode === 'decimal') return 'decimal';
  if (mode === 'numeric') return 'whole';
  return null;
}
const allowed = {
  phone: /[0-9+\-\s()]/,
  number: /[0-9.\-eE]/,
  decimal: /[0-9.,\-\s]/,
  whole: /[0-9,\s]/,
};
export const hints = {
  phone: 'Phone numbers can only have digits, spaces, + and -.',
  number: 'Numbers only.',
  decimal: 'Numbers only.',
  whole: 'Whole numbers only.',
};
/** The text with only the characters this kind of field takes. */
export function keepAllowed(kind, text) {
  const pattern = allowed[kind];
  return pattern ? [...String(text ?? '')].filter((ch) => pattern.test(ch)).join('') : String(text ?? '');
}
/** Whether the typed or pasted text belongs in this kind of field. */
export function isAllowed(kind, text) {
  return keepAllowed(kind, text) === String(text ?? '');
}
/** Digits in a phone number, and whether it looks complete (6 to 15 digits). */
export function phoneProblem(phone) {
  const text = String(phone ?? '').trim();
  if (!text) return '';
  if (!isAllowed('phone', text)) return hints.phone;
  const digits = text.replace(/\D/g, '').length;
  if (digits < 6) return 'This phone number is too short.';
  if (digits > 15) return 'This phone number is too long.';
  return '';
}

/** Watch every field on the page. Returns a function that stops watching. */
export function installInputGuard(doc = globalThis.document) {
  if (!doc) return () => {};
  let hint = null,
    timer = 0;
  const show = (input, text) => {
    if (!hint) {
      hint = doc.createElement('div');
      hint.className = 'input-hint';
      hint.setAttribute('role', 'status');
      hint.setAttribute('aria-live', 'polite');
      doc.body.append(hint);
    }
    const box = input.getBoundingClientRect();
    hint.textContent = text;
    hint.style.left = `${Math.max(8, box.left + (globalThis.scrollX ?? 0))}px`;
    hint.style.top = `${box.bottom + (globalThis.scrollY ?? 0) + 4}px`;
    hint.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (hint) hint.hidden = true;
    }, 2500);
  };
  const onBeforeInput = (event) => {
    const input = event.target;
    const kind = entryKind(input);
    if (!kind || !event.inputType?.startsWith('insert') || event.data == null) return;
    if (isAllowed(kind, event.data)) return;
    event.preventDefault();
    const kept = keepAllowed(kind, event.data).trim();
    // Pasted, dropped or autofilled text: insert just the allowed part.
    if (kept && typeof doc.execCommand === 'function') doc.execCommand('insertText', false, kept);
    show(input, hints[kind]);
  };
  doc.addEventListener('beforeinput', onBeforeInput, true);
  return () => doc.removeEventListener('beforeinput', onBeforeInput, true);
}
