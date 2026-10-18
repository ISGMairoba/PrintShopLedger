import { whatsappLink } from './share.mjs';

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
 * Send text without a file. Phones open the share sheet (WhatsApp, SMS, Telegram…); elsewhere
 * WhatsApp opens with the message filled in, on the customer's chat when the number is known.
 */
export async function shareText(
  text: string,
  { title, phone }: { title: string; phone?: string },
): Promise<'shared' | 'cancelled' | 'whatsapp'> {
  if (typeof navigator.share === 'function') {
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
