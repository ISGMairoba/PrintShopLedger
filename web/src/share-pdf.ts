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
  return shareFile(file, { title, text, phone, mode });
}

/** Save a file (a PDF or a picture) to the device's downloads. */
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Share a file (a PDF or a receipt picture), as sharePdf does. */
export async function shareFile(
  file: File,
  {
    title,
    text,
    phone,
    mode = 'share',
  }: { title: string; text: string; phone?: string; mode?: 'whatsapp' | 'share' },
): Promise<'shared' | 'cancelled' | 'downloaded'> {
  // "WhatsApp" (Business Settings → Messages): straight to the customer's chat; the PDF downloads
  // to attach. "Share": the share sheet with the PDF, where the device can share files.
  if (mode === 'share' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      // Some browsers refuse files at the last moment; fall back to download + WhatsApp.
    }
  }
  downloadFile(file);
  window.open(whatsappLink(phone, text), '_blank', 'noopener');
  return 'downloaded';
}

export const shareResult = (result: 'shared' | 'cancelled' | 'downloaded', kind: 'PDF' | 'picture' = 'PDF') =>
  result === 'shared'
    ? 'Shared.'
    : result === 'cancelled'
      ? ''
      : `${kind === 'PDF' ? 'PDF' : 'Picture'} downloaded. WhatsApp is open with the message: attach the ${kind} and send.`;
