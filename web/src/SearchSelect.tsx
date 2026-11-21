import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

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

/** The first option whose name starts with what was typed (for filling in the rest). */
export function completion(options: SearchOption[], typed: string) {
  const start = typed.toLowerCase();
  if (!start.trim()) return undefined;
  return options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(start));
}

/**
 * A drop-down you can type into: shows the chosen option; typing filters the list (every word
 * must match) and fills in the rest of the first name that starts with what was typed (selected,
 * so the next letter replaces it); arrows and Enter choose; Escape or leaving the box keeps the
 * previous choice. Options are listed alphabetically. `pinned` options (No material, All
 * materials…) stay first. Without `value` it keeps its own choice (from `defaultValue`), for forms
 * read on submit through `name`.
 */
export default function SearchSelect({
  label,
  value: controlled,
  defaultValue = '',
  options,
  onChange: report,
  pinned = [],
  placeholder,
  required = false,
  disabled = false,
  name,
  className,
}: {
  label: string;
  value?: string;
  /** The first choice when the box keeps its own (no `value`). */
  defaultValue?: string;
  options: SearchOption[];
  onChange?: (value: string) => void;
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
  const [own, setOwn] = useState(defaultValue);
  const value = controlled ?? own;
  const onChange = (next: string) => {
    if (controlled === undefined) setOwn(next);
    report?.(next);
  };
  // What was really typed (the rest of a filled-in name is not part of it), and the text to select.
  const [typedText, setTypedText] = useState('');
  const fill = useRef<[number, number] | null>(null);
  useLayoutEffect(() => {
    if (fill.current && input.current) input.current.setSelectionRange(...fill.current);
    fill.current = null;
  });
  const all = useMemo(() => [...pinned, ...sortOptions(options)], [pinned, options]);
  const chosen = all.find((o) => o.value === value);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState<string | null>(null),
    [active, setActive] = useState(0);
  const typing = query !== null && typedText !== '';
  const shown = typing ? all.filter((o) => optionMatches(o, typedText)) : all;
  useEffect(() => {
    if (!open) {
      setQuery(null);
      setTypedText('');
    }
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
          aria-autocomplete="both"
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
            const typed = e.target.value;
            setTypedText(typed);
            setOpen(true);
            // Typing (not deleting) at the end: fill in the rest of the first name that starts so.
            const adding = (e.nativeEvent as InputEvent).inputType?.startsWith('insert') ?? true;
            const caretAtEnd = e.target.selectionStart === typed.length;
            const match = adding && caretAtEnd ? completion(all, typed) : undefined;
            const matches = all.filter((o) => optionMatches(o, typed));
            if (match) {
              setQuery(typed + match.label.slice(typed.length));
              fill.current = [typed.length, match.label.length];
              setActive(Math.max(0, matches.indexOf(match)));
            } else {
              setQuery(typed);
              setActive(0);
            }
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
            } else if (e.key === 'Tab' && open && typing && (shown.length === 1 || query !== typedText))
              choose(shown[active]);
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
