import type { jsPDF } from 'jspdf';
import { whatsappLink } from './share.mjs';
import { chooseShare, type ShareMode } from './share-choice';

/**
 * Share a PDF. The person chooses (share-choice.ts): the share sheet with the PDF attached (where the
 * device can share files), or WhatsApp on the customer's chat with the message while the PDF
 * downloads to attach.
 */
export async function sharePdf(
  doc: jsPDF,
  fileName: string,
  {
    title,
    text,
    phone,
    mode = 'ask',
  }: { title: string; text: string; phone?: string; mode?: ShareMode },
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
    mode = 'ask',
  }: { title: string; text: string; phone?: string; mode?: ShareMode },
): Promise<'shared' | 'cancelled' | 'downloaded'> {
  // WhatsApp: straight to the customer's chat; the file downloads to attach. Other apps: the share
  // sheet with the file, where the device can share files.
  const choice = await chooseShare(mode, { file: true, phone });
  if (!choice) return 'cancelled';
  if (choice === 'share' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
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

export const shareResult = (
  result: 'shared' | 'cancelled' | 'downloaded',
  kind: 'PDF' | 'picture' = 'PDF',
) =>
  result === 'shared'
    ? 'Shared.'
    : result === 'cancelled'
      ? ''
      : `${kind === 'PDF' ? 'PDF' : 'Picture'} downloaded. WhatsApp is open with the message: attach the ${kind} and send.`;
