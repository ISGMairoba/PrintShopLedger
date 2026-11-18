import { useId, useState } from 'react';
import Modal from './Modal';
import DialogActions from './DialogActions';
import ItemLookFields, { codeTaken, type ItemLook } from './ItemLookFields';
import { cleanCode, cleanTags, displayEvent } from './item-fields.mjs';
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
  const [look, setLook] = useState<ItemLook>({
    icon: service.icon ?? '',
    category: service.category ?? '',
    code: service.code ?? '',
    tags: service.tags ?? [],
    minQuantity: service.minQuantity ? String(service.minQuantity) : '',
  });
  const { icon, category, code, tags } = look;
  const [tagText, setTagText] = useState('');
  const group = service.variantGroup
    ? services.filter((s) => s.variantGroup === service.variantGroup && !s.archived)
    : [service];
  const [wholeGroup, setWholeGroup] = useState(group.length > 1);
  const [error, setError] = useState('');
  const taken = codeTaken(services, code, service.id);
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
                    {
                      icon,
                      category,
                      tags: pending,
                      minQuantity: look.minQuantity ?? '',
                      code: s.id === service.id ? cleanCode(code) : undefined,
                    },
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
        <ItemLookFields
          look={look}
          onChange={setLook}
          services={services}
          serviceId={service.id}
          name={service.description}
          onError={setError}
          tagText={tagText}
          setTagText={setTagText}
        />
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
