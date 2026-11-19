import { useRef, useState } from 'react';
import Icon from './Icon';
import { MESSAGE_KINDS, messageKind, messagesDefaults, sampleMessage } from './messages.mjs';

type Settings = ReturnType<typeof messagesDefaults>;
type Item = { text?: string; send?: string };

/**
 * Business Settings → Messages: the business default for sending, then each message the app sends,
 * with its wording (placeholders inserted by tapping them), a preview and how it goes out.
 */
export default function MessagesSettings({
  value,
  business,
  legacyReady,
  onChange,
}: {
  value: Settings;
  business: string;
  legacyReady: string;
  onChange: (next: Settings) => void;
}) {
  const [open, setOpen] = useState<string>('ready');
  const boxes = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const items = value.items as Record<string, Item>;
  const setItem = (key: string, patch: Item) => {
    const next: Item = { ...items[key], ...patch };
    const clean: Item = {
      ...(next.text?.trim() ? { text: next.text } : {}),
    };
    const all = { ...items };
    if (clean.text) all[key] = clean;
    else delete all[key];
    onChange({ ...value, items: all });
  };
  const wording = (key: string) =>
    items[key]?.text ??
    (key === 'ready' && legacyReady.trim() ? legacyReady : (messageKind(key)?.text ?? ''));
  const insert = (key: string, holder: string) => {
    const box = boxes.current[key];
    const text = wording(key);
    const at = box ? box.selectionStart : text.length;
    const end = box ? box.selectionEnd : text.length;
    const next = `${text.slice(0, at)}{${holder}}${text.slice(end)}`;
    setItem(key, { text: next });
    requestAnimationFrame(() => {
      if (!box) return;
      box.focus();
      const caret = at + holder.length + 2;
      box.setSelectionRange(caret, caret);
    });
  };
  return (
    <div className="messages-settings">
      <p>
        The wording of every message the app sends for you. Tap a placeholder to put it where the cursor is; it
        is filled in for each customer when the message is sent. Each Share asks where to send it: WhatsApp
        (the customer's chat) or another app.
      </p>
      <div className="message-list">
        {MESSAGE_KINDS.map((kind) => {
          const own = items[kind.key];
          const isOpen = open === kind.key;
          return (
            <section key={kind.key} className={`message-item${isOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="message-head"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? '' : kind.key)}
              >
                <span>
                  <strong>{kind.name}</strong>
                  <small>
                    {own?.text || (kind.key === 'ready' && legacyReady.trim())
                      ? 'Your wording'
                      : 'App wording'}
                  </small>
                </span>
                <Icon name={isOpen ? 'up' : 'down'} />
              </button>
              {isOpen && (
                <div className="message-body">
                  <p className="muted">{kind.hint}</p>
                  <label>
                    Message
                    <textarea
                      ref={(el) => {
                        boxes.current[kind.key] = el;
                      }}
                      aria-label={`${kind.name} message`}
                      rows={4}
                      maxLength={1000}
                      value={wording(kind.key)}
                      onChange={(e) => setItem(kind.key, { text: e.target.value })}
                    />
                  </label>
                  <div className="placeholder-chips" role="group" aria-label="Placeholders">
                    {kind.holders.map(([holder, meaning]: string[]) => (
                      <button
                        type="button"
                        key={holder}
                        className="chip"
                        title={meaning}
                        onClick={() => insert(kind.key, holder)}
                      >
                        {`{${holder}}`}
                        <small>{meaning}</small>
                      </button>
                    ))}
                  </div>
                  <div className="message-preview" aria-label="Preview">
                    <small>Preview for Sara Aminu Bello</small>
                    <p>
                      {sampleMessage(
                        { ...value, items: { ...items, [kind.key]: { ...own, text: wording(kind.key) } } },
                        kind.key,
                        business,
                        legacyReady,
                      )}
                    </p>
                  </div>
                  <div className="message-controls">
                    <button
                      type="button"
                      className="secondary"
                      disabled={!own?.text && !(kind.key === 'ready' && legacyReady.trim())}
                      onClick={() => setItem(kind.key, { text: kind.text })}
                    >
                      <Icon name="undo" /> Use the app's wording
                    </button>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
