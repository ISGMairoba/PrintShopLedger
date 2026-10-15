import { useState } from 'react';
import type { Branding } from './useBusinessBranding';
import { logoLayouts } from './logo-variants.mjs';
import './logo-variants.css';

export default function LogoVariantsEditor({
  value,
  onChange,
  onUpload,
  busy,
}: {
  value: Branding;
  onChange: (key: keyof Branding, value: unknown) => void;
  onUpload: (file: File, layout: string, mode: 'light' | 'dark') => Promise<void>;
  busy: boolean;
}) {
  const [layout, setLayout] = useState<keyof typeof logoLayouts>('complete');
  return (
    <>
      <h3>Logo variants</h3>
      <p>
        Upload your existing artwork for each layout. Light and dark refer to the background the logo will
        appear on.
      </p>
      <label>
        Layout to edit
        <select
          aria-label="Layout to edit"
          value={layout}
          onChange={(event) => setLayout(event.target.value as keyof typeof logoLayouts)}
        >
          {Object.entries(logoLayouts).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="logo-variant-grid">
        {(['light', 'dark'] as const).map((mode) => {
          const image = value.logoVariants[layout][mode];
          return (
            <section key={`${layout}-${mode}`} className="logo-variant-card">
              <h4>For {mode} backgrounds</h4>
              <div className={`logo-variant-preview logo-variant-preview-${mode}`}>
                {image ? (
                  <img src={image} alt={`${logoLayouts[layout]} for ${mode} backgrounds`} />
                ) : (
                  <span>No image uploaded</span>
                )}
              </div>
              <label>
                Upload {mode} background version
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void onUpload(file, layout, mode);
                  }}
                />
              </label>
              {image && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    onChange('logoVariants', {
                      ...value.logoVariants,
                      [layout]: { ...value.logoVariants[layout], [mode]: '' },
                    })
                  }
                >
                  Remove {mode} version
                </button>
              )}
            </section>
          );
        })}
      </div>
      <h3>Where to use each layout</h3>
      <div className="form-grid">
        {(
          [
            ['sidebar', 'Sidebar'],
            ['favicon', 'Browser tab icon'],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <select
              aria-label={label}
              value={value.logoUsage[key]}
              onChange={(event) => onChange('logoUsage', { ...value.logoUsage, [key]: event.target.value })}
            >
              {Object.entries(logoLayouts).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <small>
        Missing versions fall back to another uploaded logo or your original logo. Choose document logos
        separately under Receipts for each paper size. The browser icon changes for this business on this
        device; installed app icons keep the app icon.
      </small>
    </>
  );
}
