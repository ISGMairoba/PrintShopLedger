import { whatsappLink } from './share.mjs';
import { canShareSheet, chooseShare, type ShareMode } from './share-choice';

/**
 * Copy text for pasting into a chat. Uses the clipboard when the browser allows it, otherwise a
 * hidden text box (older phones and non-secure pages). Returns false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the fallback.
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    box.remove();
  }
}

/**
 * Send text without a file. The person chooses (share-choice.ts): WhatsApp opens on the customer's
 * chat with the message, or the phone's share sheet (WhatsApp, SMS, Telegram…).
 */
export async function shareText(
  text: string,
  { title, phone, mode = 'ask' }: { title: string; phone?: string; mode?: ShareMode },
): Promise<'shared' | 'cancelled' | 'whatsapp'> {
  const choice = await chooseShare(mode, { file: false, phone });
  if (!choice) return 'cancelled';
  if (choice === 'share' && canShareSheet()) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
    }
  }
  window.open(whatsappLink(phone, text), '_blank', 'noopener');
  return 'whatsapp';
}
