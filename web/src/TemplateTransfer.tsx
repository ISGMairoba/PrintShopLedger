import { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import type { Ledger, PricingSettings, PricingTemplate } from './types';
import {
  compatibleTemplateItem,
  exportTemplateFile,
  importedTemplateNames,
  importTemplateFile,
  suggestTemplateMappings,
} from './template-transfer.mjs';

export type TemplatePackage = {
  templates: PricingTemplate[];
  items: { id: string; name: string; key: string; unit: string; uses: string[] }[];
};

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TemplateExportDialog({
  templates,
  ledger,
  share,
  onClose,
}: {
  templates: PricingTemplate[];
  ledger: Ledger;
  share: boolean;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Generate synchronously so invoking the native share sheet keeps the user's click activation.
  const prepared = useMemo(() => {
    try {
      const content = exportTemplateFile(templates, ledger);
      const name = templates.length === 1 ? templates[0].name : 'pricing-templates';
      const filename =
        (name
          .replace(/[^a-z0-9-]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || 'template') + '.json';
      return { file: new File([content], filename, { type: 'application/json' }), error: '' };
    } catch (e) {
      return { file: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [templates, ledger]);
  async function send() {
    if (!prepared.file || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (share && navigator.canShare?.({ files: [prepared.file] }) && navigator.share) {
        await navigator.share({ files: [prepared.file], title: 'Pricing templates' });
        onClose();
      } else {
        download(prepared.file);
        setMessage(
          share
            ? 'File downloaded. Attach it in WhatsApp, email, or another app to share it.'
            : 'Template file downloaded.',
        );
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setMessage('Sharing could not finish. Use Download file to save it instead.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={share ? 'Share pricing template' : 'Export pricing templates'}
      onClose={onClose}
      busy={busy}
    >
      <p>
        {templates.length} template{templates.length === 1 ? '' : 's'}:{' '}
        {templates.map((t) => t.name).join(', ')}
      </p>
      <p>
        The file includes formulas, fixed amounts entered in formulas, profit rules, and referenced item
        names. It excludes catalogue prices, stock balances, customers, and transactions.
      </p>
      <p>
        The receiving shop must import the file and match its own items. Its current costs and selling prices
        will be used.
      </p>
      {prepared.error && (
        <p role="alert" className="danger-text">
          {prepared.error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="material-actions">
        <button type="button" disabled={busy || !prepared.file} onClick={() => void send()}>
          <Icon name={share ? 'share' : 'export'} /> {share ? 'Share file' : 'Download file'}
        </button>
        {share && (
          <button
            type="button"
            className="secondary"
            disabled={busy || !prepared.file}
            onClick={() => {
              download(prepared.file!);
              setMessage('Template file downloaded.');
            }}
          >
            <Icon name="export" /> Download file
          </button>
        )}
      </div>
    </Modal>
  );
}

export function TemplateImportDialog({
  file,
  ledger,
  pricing,
  busy,
  canSave,
  onSave,
  onClose,
}: {
  file: TemplatePackage;
  ledger: Ledger;
  pricing: PricingSettings;
  busy: boolean;
  canSave: boolean;
  onSave: (templates: PricingTemplate[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => suggestTemplateMappings(file, ledger));
  const [names, setNames] = useState<string[]>(() => importedTemplateNames(file, pricing.templates));
  const [error, setError] = useState('');
  const review = useMemo(() => {
    try {
      return {
        templates: importTemplateFile(file, ledger, pricing, mapping, names) as PricingTemplate[],
        error: '',
      };
    } catch (e) {
      return { templates: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [file, ledger, pricing, mapping, names]);
  async function confirm() {
    if (!canSave || !review.templates || busy) return;
    setError('');
    try {
      await onSave(review.templates);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal title="Import pricing templates" onClose={onClose} busy={busy} wide>
      <p>
        Import creates {file.templates.length} new template{file.templates.length === 1 ? '' : 's'}. Review
        names and match every referenced item to this shop. Your current costs and selling prices apply.
      </p>
      <div className="form-grid">
        {names.map((name, index) => (
          <label key={file.templates[index].id}>
            Template name
            <input
              value={name}
              maxLength={100}
              disabled={busy}
              onChange={(e) =>
                setNames((current) => current.map((n, i) => (i === index ? e.target.value : n)))
              }
            />
          </label>
        ))}
      </div>
      {file.items.length > 0 && (
        <>
          <h3>Match catalogue items</h3>
          <p className="muted">
            Only items with the same consumption unit and the required cost or selling price are listed.
            Review suggested matches before importing.
          </p>
          <div className="form-grid">
            {file.items.map((source) => (
              <label key={source.id}>
                {source.name} · {source.unit}
                <small>
                  {source.key || 'Stock reference'} · {source.uses.join(', ')}
                </small>
                <select
                  aria-label={`Match ${source.name}`}
                  value={mapping[source.id] || ''}
                  disabled={busy}
                  onChange={(e) => setMapping((current) => ({ ...current, [source.id]: e.target.value }))}
                >
                  <option value="">Choose local item</option>
                  {ledger.services
                    .filter((s) => compatibleTemplateItem(source, s, ledger.materials))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.description}
                        {s.costing?.key ? ` (${s.costing.key})` : ''}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
      {review.error && (
        <p role="status" className="danger-text">
          {review.error}
        </p>
      )}
      {!review.error && (
        <p role="status">
          All references matched. Default inputs calculate successfully. Review the templates’ input ranges
          and sample prices after import.
        </p>
      )}
      {error && (
        <p role="alert" className="danger-text">
          {error}
        </p>
      )}
      {!canSave && (
        <p role="status">Connect and wait until the workspace finishes loading before importing.</p>
      )}
      <div className="material-actions">
        <button type="button" disabled={!canSave || busy || !review.templates} onClick={() => void confirm()}>
          <Icon name="import" /> Import {file.templates.length} template
          {file.templates.length === 1 ? '' : 's'}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
