import { useId, useState } from 'react';
export default function ListedCombobox({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [showAll, setShowAll] = useState(false),
    [active, setActive] = useState(0);
  const matches = options.filter((item) => item.toLowerCase().includes(value.toLowerCase()));
  const choices = showAll ? options : matches;
  function choose(item: string) {
    onChange(item);
    setOpen(false);
    setActive(0);
  }
  return (
    <div className="listed-combobox">
      <label htmlFor={id}>{label}</label>
      <div className="listed-combobox-input">
        <input
          id={id}
          aria-label={label}
          name={name}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && choices[active] ? `${id}-option-${active}` : undefined}
          value={value}
          autoComplete="off"
          required
          onChange={(e) => {
            onChange(e.target.value);
            setShowAll(false);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setShowAll(options.includes(value));
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(index + 1, choices.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (e.key === 'Enter' && open && choices[active]) {
              e.preventDefault();
              choose(choices[active]);
            } else if (e.key === 'Escape' && open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          aria-label={`Show ${label.toLowerCase()} options`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setShowAll(true);
            setOpen(true);
            setActive(0);
          }}
        >
          ▾
        </button>
      </div>
      {open && (
        <div
          className="listed-combobox-list"
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} options`}
        >
          {choices.map((item, index) => (
            <button
              type="button"
              id={`${id}-option-${index}`}
              key={item}
              role="option"
              aria-selected={index === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              {item}
            </button>
          ))}
          {!choices.length && <p>No matching category. Choose an option from Business Settings.</p>}
        </div>
      )}
    </div>
  );
}
