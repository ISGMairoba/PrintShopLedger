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
      ...(next.send && next.send !== 'default' ? { send: next.send } : {}),
    };
    const all = { ...items };
    if (clean.text || clean.send) all[key] = clean;
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
        The wording of every message the app sends for you, and how it goes out. Tap a placeholder to put it
        where the cursor is; it is filled in for each customer when the message is sent.
      </p>
      <label>
        Send messages by
        <select
          aria-label="Send messages by"
          value={value.send}
          onChange={(e) => onChange({ ...value, send: e.target.value === 'share' ? 'share' : 'whatsapp' })}
        >
          <option value="whatsapp">WhatsApp, straight to the customer's number</option>
          <option value="share">Share: choose WhatsApp, SMS, email… each time</option>
        </select>
        <small>
          With a document (receipt, quotation…), WhatsApp opens on the customer's chat and the PDF downloads
          to attach; Share sends the PDF itself where the phone allows it.
        </small>
      </label>
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
                    {' · '}
                    {own?.send === 'share'
                      ? 'Share'
                      : own?.send === 'whatsapp'
                        ? 'WhatsApp'
                        : `Business default (${value.send === 'share' ? 'Share' : 'WhatsApp'})`}
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
                    <label>
                      Send by
                      <select
                        aria-label={`${kind.name}: send by`}
                        value={own?.send ?? 'default'}
                        onChange={(e) => setItem(kind.key, { send: e.target.value })}
                      >
                        <option value="default">
                          Business default ({value.send === 'share' ? 'Share' : 'WhatsApp'})
                        </option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="share">Share</option>
                      </select>
                    </label>
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
