import { useEffect, useId, useMemo, useRef, useState } from 'react';

export type SearchOption = {
  value: string;
  label: string;
  /** Options with the same group are listed under that heading (e.g. "Pricing templates"). */
  group?: string;
  /** Extra words that also match a search (an ID, a code). */
  keywords?: string;
  disabled?: boolean;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Options in alphabetical order, kept together by group (groups in the order first seen). */
export function sortOptions(options: SearchOption[]) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return groups.flatMap((g) =>
    options.filter((o) => (o.group ?? '') === g).sort((a, b) => collator.compare(a.label, b.label)),
  );
}
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
/** Whether every typed word appears in the option ("a4 card" finds "Art Card (A4)"). */
export function optionMatches(option: SearchOption, query: string) {
  const haystack = `${option.label} ${option.keywords ?? ''}`.toLowerCase();
  return words(query).every((word) => haystack.includes(word));
}

/**
 * A drop-down you can type into: shows the chosen option; typing filters the list (every word
 * must match); arrows and Enter choose; Escape or leaving the box keeps the previous choice.
 * Options are listed alphabetically. `pinned` options (No material, All materials…) stay first.
 */
export default function SearchSelect({
  label,
  value,
  options,
  onChange,
  pinned = [],
  placeholder,
  required = false,
  disabled = false,
  name,
  className,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  pinned?: SearchOption[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Form field name: the chosen value is also sent with the form. */
  name?: string;
  className?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo(() => [...pinned, ...sortOptions(options)], [pinned, options]);
  const chosen = all.find((o) => o.value === value);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState<string | null>(null),
    [active, setActive] = useState(0);
  const typing = query !== null && query !== (chosen?.label ?? '');
  const shown = typing ? all.filter((o) => optionMatches(o, query!)) : all;
  useEffect(() => {
    if (!open) setQuery(null);
  }, [open]);
  // A required choice must come from the list, not from loose typing.
  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? 'Choose an option from the list.' : '');
  }, [required, value]);
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);
  function choose(option: SearchOption | undefined) {
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setOpen(false);
  }
  function show() {
    if (disabled) return;
    setOpen(true);
    setActive(
      Math.max(
        0,
        all.findIndex((o) => o.value === value),
      ),
    );
  }
  let lastGroup: string | undefined;
  return (
    <div className={`listed-combobox search-select${className ? ` ${className}` : ''}`}>
      <div className="listed-combobox-input">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-option-${active}` : undefined}
          data-value={value}
          value={query ?? chosen?.label ?? ''}
          placeholder={chosen?.label || placeholder}
          autoComplete="off"
          spellCheck={false}
          required={required}
          disabled={disabled}
          // Focus (including a dialog opening) only selects the text; a click, typing or the
          // down arrow opens the list.
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => !open && show()}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!open) show();
              else setActive((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              choose(shown[active]);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            } else if (e.key === 'Tab' && open && typing && shown.length === 1) choose(shown[0]);
          }}
        />
        <button
          type="button"
          className="secondary"
          tabIndex={-1}
          aria-label={`Show ${label.toLowerCase()} options`}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (open) setOpen(false);
            else {
              input.current?.focus();
              show();
            }
          }}
        >
          ▾
        </button>
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {open && (
        <div
          className="listed-combobox-list"
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} options`}
          // Scrolling the list (or its scroll bar) keeps the box focused and the list open.
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? option.group : null;
            lastGroup = option.group;
            return (
              <div key={`${option.group ?? ''}:${option.value}`} role="presentation">
                {heading && (
                  <p className="search-select-group" role="presentation">
                    {heading}
                  </p>
                )}
                <button
                  type="button"
                  id={`${id}-option-${index}`}
                  role="option"
                  data-value={option.value}
                  aria-selected={index === active}
                  aria-disabled={option.disabled || undefined}
                  className={option.value === value ? 'chosen' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              </div>
            );
          })}
          {!shown.length && <p>No match. Try fewer letters.</p>}
        </div>
      )}
    </div>
  );
}
