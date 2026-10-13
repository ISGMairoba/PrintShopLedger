import { useEffect, useState } from 'react';
import PricingTemplatesEditor from './PricingTemplatesEditor';
import type { Ledger } from './types';
import type { Branding } from './useBusinessBranding';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';

export default function PricingTemplatesPage({
  settings,
  version,
  ledger,
  ready,
  online,
  demo,
  onSave,
  onReload,
}: {
  settings: Branding;
  version: number;
  ledger: Ledger;
  ready: boolean;
  online: boolean;
  demo: boolean;
  onSave: (settings: Branding, version: number) => Promise<unknown>;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings.pricing),
    [base, setBase] = useState(version),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [message, setMessage, tone] = useFeedbackMessage('success');
  useEffect(() => {
    if (!dirty) {
      setDraft(settings.pricing);
      setBase(version);
    }
  }, [settings.pricing, version, dirty]);
  async function save() {
    if (busy || !ready || !dirty || version !== base || (!demo && !online)) return;
    setBusy(true);
    setMessage('');
    try {
      await onSave({ ...settings, pricing: draft }, base);
      setDirty(false);
      setMessage('Pricing templates saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel editor" aria-label="Pricing templates">
      <FeedbackBanner message={message} tone={tone} />
      {!demo && !online && <p className="notice">Connect to save pricing templates.</p>}
      {dirty && version !== base && (
        <p className="notice notice-warning">
          Business settings changed elsewhere. Reload the saved version before editing.
        </p>
      )}
      <fieldset disabled={busy || !ready}>
        <PricingTemplatesEditor
          value={draft}
          ledger={ledger}
          onChange={(value) => {
            setDraft(value);
            setDirty(true);
            setMessage('');
          }}
        />
        <div className="toolbar">
          <button
            type="button"
            disabled={busy || !ready || !dirty || version !== base || (!demo && !online)}
            onClick={() => void save()}
          >
            Save pricing templates
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              try {
                await onReload();
                setDirty(false);
                setMessage('');
              } catch (e) {
                setMessage(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          >
            Reload saved templates
          </button>
        </div>
      </fieldset>
    </section>
  );
}
