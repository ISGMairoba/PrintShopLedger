import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { canShareSheet, setShareChooser, type ShareChoice } from './share-choice';

/**
 * The choice every Share in the app asks (share-choice.ts): WhatsApp (the customer's chat, with the
 * file downloaded to attach) or another app (the phone's share sheet). Mounted once by the app.
 */
export default function ShareChooser() {
  const [asking, setAsking] = useState<{ file: boolean; phone?: string } | null>(null);
  const answer = useRef<((choice: ShareChoice | null) => void) | null>(null);
  useEffect(() => {
    setShareChooser(
      (options) =>
        new Promise((resolve) => {
          answer.current?.(null);
          answer.current = resolve;
          setAsking(options);
        }),
    );
    return () => setShareChooser(null);
  }, []);
  const choose = (choice: ShareChoice | null) => {
    const resolve = answer.current;
    answer.current = null;
    setAsking(null);
    // Answer inside the tap, so the phone still lets the share sheet open.
    resolve?.(choice);
  };
  if (!asking) return null;
  const sheet = canShareSheet();
  return (
    <Modal title="Share" onClose={() => choose(null)}>
      <div className="share-choices">
        <button type="button" onClick={() => choose('whatsapp')}>
          <Icon name="share" />
          <span>
            <strong>WhatsApp</strong>
            <small>
              {asking.phone ? "Opens the customer's chat" : 'Opens WhatsApp'} with the message
              {asking.file ? '; the file downloads so you can attach it.' : '.'}
            </small>
          </span>
        </button>
        {sheet && (
          <button type="button" className="secondary" onClick={() => choose('share')}>
            <Icon name="export" />
            <span>
              <strong>Other apps</strong>
              <small>
                The phone's share list: WhatsApp, SMS, email, Telegram…
                {asking.file ? ' The file goes with it.' : ''}
              </small>
            </span>
          </button>
        )}
        <button type="button" className="text-button" onClick={() => choose(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
