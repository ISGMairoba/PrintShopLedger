import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatAmount, amountError } from './currency-input.mjs';
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'> & { value?: string; defaultValue?: string; max?: number; onValueChange?: (value: string) => void };
export default function CurrencyInput({ value, defaultValue = '', name, max = 1000000000, onValueChange, ...props }: Props) {
  const [local, setLocal] = useState(defaultValue);
  const raw = value ?? local;
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [revision, setRevision] = useState(0);
  const display = formatAmount(raw, !focused);
  useLayoutEffect(() => {
    const element = input.current!;
    element.setCustomValidity(amountError(raw, max));
    if (caret.current !== null && document.activeElement === element) {
      let pos = 0, digits = 0;
      while (pos < display.length && digits < caret.current) { if (display[pos] !== ',') digits++; pos++; }
      element.setSelectionRange(pos, pos); caret.current = null;
    }
  }, [raw, display, max, revision]);
  return <><input {...props} ref={input} type="text" inputMode="decimal" autoComplete="off" className={`currency-input ${props.className ?? ''}`} value={display}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }}
    onBlur={event => { setFocused(false); if (raw.endsWith('.') && !amountError(raw, max)) { const next = raw.slice(0, -1); if (value === undefined) setLocal(next); onValueChange?.(next); } props.onBlur?.(event); }}
    onChange={event => {
      const text = event.target.value;
      caret.current = text.slice(0, event.target.selectionStart ?? text.length).replaceAll(',', '').length;
      let next = text.replaceAll(',', '');
      if (next.startsWith('.')) { next = '0' + next; caret.current++; }
      setRevision(current => current + 1);
      if (value === undefined) setLocal(next);
      onValueChange?.(next);
    }}/>{name && <input type="hidden" name={name} value={raw}/>}</>;
}
