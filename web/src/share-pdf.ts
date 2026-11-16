import type { jsPDF } from 'jspdf';
import { whatsappLink } from './share.mjs';

/**
 * Share a PDF. In "share" mode, phones (and browsers that can share files) open the share sheet
 * with the PDF attached. Otherwise (and always in "whatsapp" mode) the PDF downloads and WhatsApp
 * opens on the customer's chat with the message, ready to attach it.
 */
export async function sharePdf(
  doc: jsPDF,
  fileName: string,
  {
    title,
    text,
    phone,
    mode = 'share',
  }: { title: string; text: string; phone?: string; mode?: 'whatsapp' | 'share' },
): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const name = fileName.endsWith('.pdf') ? fileName : fileName + '.pdf';
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  // "WhatsApp" (Business Settings → Messages): straight to the customer's chat; the PDF downloads
  // to attach. "Share": the share sheet with the PDF, where the device can share files.
  if (
    mode === 'share' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      // Some browsers refuse files at the last moment; fall back to download + WhatsApp.
    }
  }
  doc.save(name);
  window.open(whatsappLink(phone, text), '_blank', 'noopener');
  return 'downloaded';
}

export const shareResult = (result: 'shared' | 'cancelled' | 'downloaded') =>
  result === 'shared'
    ? 'Shared.'
    : result === 'cancelled'
      ? ''
      : 'PDF downloaded. WhatsApp is open with the message: attach the PDF and send.';
