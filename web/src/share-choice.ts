// Where a share goes, chosen each time (App mounts ShareChooser, which shows the choices):
// * 'whatsapp': WhatsApp opens on the customer's chat with the message; a file downloads to attach.
// * 'share': the phone's share sheet (WhatsApp, SMS, email, Telegram…), with the file attached.
// Later, when a WhatsApp API is connected, a third choice can send it automatically.
export type ShareChoice = 'whatsapp' | 'share';
/** 'ask' (the usual): show the choices; or a choice made already. */
export type ShareMode = 'ask' | ShareChoice;

type Ask = (options: { file: boolean; phone?: string }) => Promise<ShareChoice | null>;
let ask: Ask | null = null;

/** Set by ShareChooser while it is mounted. */
export function setShareChooser(next: Ask | null) {
  ask = next;
}

/** Whether this device has a share sheet (phones, some desktop browsers). */
export const canShareSheet = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/** The choice for this share: asked when the mode is 'ask'; null when the person cancels. */
export async function chooseShare(
  mode: ShareMode | undefined,
  options: { file: boolean; phone?: string },
): Promise<ShareChoice | null> {
  if (mode === 'whatsapp' || mode === 'share') return mode;
  if (ask) return ask(options);
  return canShareSheet() ? 'share' : 'whatsapp';
}
