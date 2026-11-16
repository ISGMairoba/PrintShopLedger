import { useId, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ItemIcon, { ITEM_ICONS } from './ItemIcon';
import DialogActions from './DialogActions';
import { MAX_TAGS, cleanCode, cleanTags, displayEvent, itemCategories, itemTags, suggestCode } from './item-fields.mjs';
import type { FieldEvent, Service } from './types';

/** Products → Icon, category, code & tags: how an item shows on the Quick sale screen. */
export default function ItemLookDialog({
  service,
  services,
  actor,
  busy,
  onSave,
  onClose,
}: {
  service: Service;
  services: Service[];
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (events: FieldEvent[]) => Promise<void>;
  onClose: () => void;
}) {
  const formId = useId();
  const [icon, setIcon] = useState(service.icon ?? '');
  const [category, setCategory] = useState(service.category ?? '');
  const [code, setCode] = useState(service.code ?? '');
  const [tags, setTags] = useState<string[]>(service.tags ?? []);
  const [tagText, setTagText] = useState('');
  const addTag = (text: string) => {
    const tag = text.trim().replace(/\s+/g, ' ');
    if (!tag) return;
    try {
      setTags(cleanTags([...tags, tag]));
      setTagText('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const group = service.variantGroup
    ? services.filter((s) => s.variantGroup === service.variantGroup && !s.archived)
    : [service];
  const [wholeGroup, setWholeGroup] = useState(group.length > 1);
  const [error, setError] = useState('');
  const suggestions = itemCategories(services).filter((c) => c !== category.trim());
  const tagSuggestions = itemTags(services).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  const taken =
    code.trim() &&
    services.some((s) => s.id !== service.id && (s.code ?? '').toLowerCase() === code.trim().toLowerCase());
  return (
    <Modal
      title="Icon, category, code & tags"
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save
        </DialogActions>
      }
    >
      <form
        id={formId}
        className="item-look"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            if (taken) throw Error(`Another item already has the code ${code.trim()}.`);
            const pending = tagText.trim() ? cleanTags([...tags, tagText]) : tags;
            const targets = wholeGroup ? group : [service];
            // The code is this item's own; icon, category and tags can go to every variant.
            await onSave(
              targets.map(
                (s) =>
                  displayEvent(
                    s,
                    { icon, category, tags: pending, code: s.id === service.id ? cleanCode(code) : undefined },
                    actor,
                  ) as FieldEvent,
              ),
            );
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="item-look-preview" aria-hidden="true">
          <span className="item-look-tile">
            <ItemIcon name={icon} />
          </span>
          <span>
            <small>{category.trim() || 'No category'}</small>
            <strong>{service.description}</strong>
            {code.trim() && <small>{code.trim()}</small>}
          </span>
        </div>
        <label>
          Category
          <input
            maxLength={60}
            value={category}
            list={`${formId}-categories`}
            placeholder="e.g. Stationery"
            onChange={(e) => setCategory(e.target.value)}
          />
          <datalist id={`${formId}-categories`}>
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <small>Quick sale shows a button for each category above the items.</small>
        </label>
        <div className="form-grid">
          <label>
            Item code (optional)
            <span className="code-row">
              <input
                maxLength={24}
                value={code}
                placeholder="e.g. STA-001"
                aria-invalid={!!taken}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => setCode(suggestCode(services, category, service.id))}
              >
                Suggest
              </button>
            </span>
            <small className={taken ? 'danger-text' : undefined}>
              {taken
                ? 'Another item already has this code.'
                : 'Letters, digits, dots, dashes or slashes. Search finds items by code.'}
            </small>
          </label>
          <label>
            {`Tags (up to ${MAX_TAGS})`}
            <input
              value={tagText}
              list={`${formId}-tags`}
              disabled={tags.length >= MAX_TAGS}
              placeholder={tags.length >= MAX_TAGS ? 'Remove a tag to add another' : 'Type a tag and press Enter'}
              onChange={(e) => {
                const text = e.target.value;
                if (text.endsWith(',')) addTag(text.slice(0, -1));
                else setTagText(text);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(tagText);
                }
              }}
              onBlur={() => addTag(tagText)}
            />
            <datalist id={`${formId}-tags`}>
              {tagSuggestions.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <small>Search finds items by tag; tiles show them under the price.</small>
          </label>
        </div>
        {tags.length > 0 && (
          <ul className="tag-chips" aria-label="Tags">
            {tags.map((t) => (
              <li key={t}>
                {t}
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => setTags(tags.filter((x) => x !== t))}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <fieldset className="icon-picker">
          <legend>Icon</legend>
          <div role="radiogroup" aria-label="Icon">
            <button
              type="button"
              role="radio"
              aria-checked={!icon}
              className={!icon ? 'chosen' : ''}
              title="No icon (a box)"
              onClick={() => setIcon('')}
            >
              <Icon name="close" />
            </button>
            {Object.keys(ITEM_ICONS).map((name) => (
              <button
                type="button"
                role="radio"
                key={name}
                aria-checked={icon === name}
                aria-label={name}
                title={name}
                className={icon === name ? 'chosen' : ''}
                onClick={() => setIcon(name)}
              >
                <ItemIcon name={name} />
              </button>
            ))}
          </div>
        </fieldset>
        {group.length > 1 && (
          <label className="check-label">
            <input type="checkbox" checked={wholeGroup} onChange={(e) => setWholeGroup(e.target.checked)} />
            Use the icon, category and tags for all {group.length} variants of this item
          </label>
        )}
      </form>
    </Modal>
  );
}
