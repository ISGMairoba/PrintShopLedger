import { useId, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import ItemIcon, { ITEM_ICONS } from './ItemIcon';
import DialogActions from './DialogActions';
import { displayEvent, itemCategories } from './item-fields.mjs';
import type { FieldEvent, Service } from './types';

/** Products → Icon & category: how an item shows on the Quick sale screen. */
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
  const group = service.variantGroup
    ? services.filter((s) => s.variantGroup === service.variantGroup && !s.archived)
    : [service];
  const [wholeGroup, setWholeGroup] = useState(group.length > 1);
  const [error, setError] = useState('');
  const suggestions = itemCategories(services).filter((c) => c !== category.trim());
  return (
    <Modal
      title="Icon & category"
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
            const targets = wholeGroup ? group : [service];
            await onSave(targets.map((s) => displayEvent(s, { icon, category }, actor) as FieldEvent));
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
            Use for all {group.length} variants of this item
          </label>
        )}
      </form>
    </Modal>
  );
}
