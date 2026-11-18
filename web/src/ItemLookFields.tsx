import { useId } from 'react';
import Icon from './Icon';
import ItemIcon, { ITEM_ICONS } from './ItemIcon';
import { MAX_TAGS, cleanTags, itemCategories, itemTags, suggestCode } from './item-fields.mjs';
import type { Service } from './types';

export type ItemLook = { icon: string; category: string; code: string; tags: string[] };
export const blankLook = (): ItemLook => ({ icon: '', category: '', code: '', tags: [] });

/**
 * The icon, category, code and tags of an item (how it shows on the Quick sale screen): used by
 * Icon, category, code & tags and by Add product. tagText: a tag typed but not added yet.
 */
export default function ItemLookFields({
  look,
  onChange,
  services,
  serviceId = '',
  name,
  showCode = true,
  onError,
  tagText,
  setTagText,
}: {
  look: ItemLook;
  onChange: (next: ItemLook) => void;
  services: Service[];
  /** The item being changed ('' for a new one): its own code doesn't count as taken. */
  serviceId?: string;
  /** The item's name, for the preview. */
  name: string;
  showCode?: boolean;
  onError: (message: string) => void;
  tagText: string;
  setTagText: (text: string) => void;
}) {
  const formId = useId();
  const { icon, category, code, tags } = look;
  const setIcon = (v: string) => onChange({ ...look, icon: v });
  const setCategory = (v: string) => onChange({ ...look, category: v });
  const setCode = (v: string) => onChange({ ...look, code: v });
  const setTags = (v: string[]) => onChange({ ...look, tags: v });
  const addTag = (text: string) => {
    const tag = text.trim().replace(/\s+/g, ' ');
    if (!tag) return;
    try {
      setTags(cleanTags([...tags, tag]));
      setTagText('');
      onError('');
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const suggestions = itemCategories(services).filter((c) => c !== category.trim());
  const tagSuggestions = itemTags(services).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  const taken =
    code.trim() &&
    services.some((s) => s.id !== serviceId && (s.code ?? '').toLowerCase() === code.trim().toLowerCase());
  return (
    <>
        <div className="item-look-preview" aria-hidden="true">
          <span className="item-look-tile">
            <ItemIcon name={icon} />
          </span>
          <span>
            <small>{category.trim() || 'No category'}</small>
            <strong>{name || 'New item'}</strong>
            {showCode && code.trim() && <small>{code.trim()}</small>}
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
          {showCode && (
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
                onClick={() => setCode(suggestCode(services, category, serviceId))}
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
          )}
          <label>
            {`Tags (up to ${MAX_TAGS})`}
            <input
              value={tagText}
              list={`${formId}-tags`}
              disabled={tags.length >= MAX_TAGS}
              placeholder={
                tags.length >= MAX_TAGS ? 'Remove a tag to add another' : 'Type a tag and press Enter'
              }
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
    </>
  );
}

/** Whether a code is already used by another item. */
export const codeTaken = (services: Service[], code: string, serviceId = '') =>
  !!code.trim() &&
  services.some((s) => s.id !== serviceId && (s.code ?? '').toLowerCase() === code.trim().toLowerCase());
