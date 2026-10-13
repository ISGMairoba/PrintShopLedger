import type { jsPDF } from 'jspdf';
import { whatsappLink } from './share.mjs';

/**
 * Share a PDF. Phones (and browsers that can share files) open the share sheet with the PDF
 * attached, so it can go straight to WhatsApp. Otherwise the PDF downloads and WhatsApp opens on
 * the customer's chat with the message, ready to attach it.
 */
export async function sharePdf(
  doc: jsPDF,
  fileName: string,
  { title, text, phone }: { title: string; text: string; phone?: string },
): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const name = fileName.endsWith('.pdf') ? fileName : fileName + '.pdf';
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
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
