import { useState } from 'react';

/**
 * "Use current default terms" for a quotation or sales document. Says why nothing changes when
 * the business has no default terms yet, or the document already uses them.
 */
export default function DefaultTermsButton({
  value,
  defaults,
  kind,
  onUse,
}: {
  value: string;
  defaults: string;
  kind: 'quotation' | 'invoice / sales document';
  onUse: (terms: string) => void;
}) {
  const [said, setSaid] = useState('');
  const none = !defaults.trim();
  const same = !none && value.trim() === defaults.trim();
  return (
    <p className="default-terms">
      <button
        type="button"
        className="text-button"
        disabled={none}
        onClick={() => {
          if (same) return setSaid('These are already the default terms.');
          onUse(defaults);
          setSaid('Default terms added. You can still edit them for this one.');
        }}
      >
        Use current default terms
      </button>
      {none ? (
        <small>
          No default {kind} terms yet. Add them in Business Settings → Receipts → Terms &amp; conditions.
        </small>
      ) : (
        said && <small role="status">{said}</small>
      )}
    </p>
  );
}
