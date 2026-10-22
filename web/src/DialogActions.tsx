import type { ReactNode } from 'react';
import Icon from './Icon';

/** Shared footer; native form association retains Enter, validation and FormData behaviour. */
export default function DialogActions({
  form,
  busy,
  onCancel,
  children,
  summary,
  disabled = false,
}: {
  form: string;
  busy: boolean;
  /** The main action cannot be used yet (the dialog says why). */
  disabled?: boolean;
  onCancel: () => void;
  children: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <>
      {summary && <div className="dialog-action-summary">{summary}</div>}
      <div className="dialog-action-buttons">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          <Icon name="close" /> Cancel
        </button>
        <button type="submit" form={form} disabled={busy || disabled} aria-busy={busy}>
          <Icon name="save" /> {busy ? 'Saving…' : children}
        </button>
      </div>
    </>
  );
}
