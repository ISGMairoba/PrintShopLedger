import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { formatAmount, amountError, normalizeAmount, pastedAmount } from './currency-input.mjs';
type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'
> & { value?: string; defaultValue?: string; max?: number; onValueChange?: (value: string) => void };
export default function CurrencyInput({
  value,
  defaultValue = '',
  name,
  max = 1000000000,
  onValueChange,
  ...props
}: Props) {
  const [local, setLocal] = useState(defaultValue);
  const raw = value ?? local;
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const validationError = amountError(raw, max);
  const [rejected, setRejected] = useState('');
  const errorText = validationError || rejected;
  const caret = useRef<number | null>(null);
  const [complete, setComplete] = useState(true);
  const [revision, setRevision] = useState(0);
  const display = formatAmount(raw, complete);
  useLayoutEffect(() => {
    const element = input.current!;
    element.setCustomValidity(amountError(raw, max));
    if (caret.current !== null && document.activeElement === element) {
      let pos = 0,
        digits = 0;
      while (pos < display.length && digits < caret.current) {
        if (display[pos] !== ',') digits++;
        pos++;
      }
      element.setSelectionRange(pos, pos);
      caret.current = null;
    }
  }, [raw, display, max, revision]);
  return (
    <>
      <input
        {...props}
        ref={input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`currency-input ${props.className ?? ''}`}
        value={display}
        aria-invalid={!!validationError}
        aria-describedby={
          [props['aria-describedby'], errorText ? errorId : ''].filter(Boolean).join(' ') || undefined
        }
        onFocus={props.onFocus}
        onPaste={(event) => {
          props.onPaste?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          const element = event.currentTarget;
          const next = pastedAmount(
            display.slice(0, element.selectionStart ?? 0) +
              event.clipboardData.getData('text') +
              display.slice(element.selectionEnd ?? display.length),
          );
          const error = amountError(next, max);
          if (error) {
            setRejected('Entry not accepted. ' + error);
            return;
          }
          setRejected('');
          setComplete(false);
          caret.current = next.replaceAll(',', '').length;
          if (value === undefined) setLocal(next);
          onValueChange?.(next);
        }}
        onBlur={(event) => {
          setComplete(true);
          setRejected('');
          const next = amountError(raw, max) ? '0' : normalizeAmount(raw);
          if (next !== raw) {
            if (value === undefined) setLocal(next);
            onValueChange?.(next);
          }
          props.onBlur?.(event);
        }}
        onChange={(event) => {
          const text = event.target.value;
          caret.current = text
            .slice(0, event.target.selectionStart ?? text.length)
            .replaceAll(',', '').length;
          let next = text.replaceAll(',', '');
          if (next.startsWith('.')) {
            next = '0' + next;
            caret.current++;
          }
          if (amountError(next, max)) {
            caret.current = null;
            setRejected('Entry not accepted. ' + amountError(next, max));
            setRevision((current) => current + 1);
            return;
          }
          setRejected('');
          setComplete(false);
          setRevision((current) => current + 1);
          if (value === undefined) setLocal(next);
          onValueChange?.(next);
        }}
      />
      {errorText && (
        <small id={errorId} className="currency-error" role="alert">
          {errorText}
        </small>
      )}
      {name && <input type="hidden" name={name} value={raw} />}
    </>
  );
}
