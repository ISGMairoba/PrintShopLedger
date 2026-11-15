import Icon from './Icon';
import { useEffect, useRef, useState } from 'react';
import { appIconSource, drawAppIcon } from './app-icon.mjs';
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
                  <Icon name="close" /> Remove {mode} version
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
        device.
      </small>
      <AppIconEditor value={value} onChange={onChange} busy={busy} />
    </>
  );
}

/** The installed app's icon: a logo layout drawn on a square background. */
function AppIconEditor({
  value,
  onChange,
  busy,
}: {
  value: Branding;
  onChange: (key: keyof Branding, value: unknown) => void;
  busy: boolean;
}) {
  const icon = value.appIcon;
  const [error, setError] = useState('');
  const source = appIconSource(value, icon.layout, icon.background);
  const first = useRef(true);
  // Redraw whenever the layout, background or the logo artwork changes (not just for opening the
  // page: a saved icon stays as it is, so the settings are not marked as changed).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (icon.png || icon.layout === 'none') return;
    }
    let live = true;
    drawAppIcon(source, icon.background)
      .then((png) => {
        if (live && png !== icon.png) onChange('appIcon', { ...icon, png });
        if (live) setError('');
      })
      .catch(() => live && setError('Could not draw the app icon from this logo.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, icon.background, icon.layout]);
  return (
    <>
      <h3>Installed app icon</h3>
      <p>
        The icon staff see on their phone or computer after installing the app. Choose a logo layout and the
        color behind it.
      </p>
      <div className="app-icon-editor">
        <div className="form-grid">
          <label>
            Logo for the icon
            <select
              aria-label="App icon logo"
              disabled={busy}
              value={icon.layout}
              onChange={(event) => onChange('appIcon', { ...icon, layout: event.target.value })}
            >
              <option value="none">PrintShopLedger icon</option>
              {Object.entries(logoLayouts).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Background
            <input
              type="color"
              aria-label="App icon background"
              disabled={busy || icon.layout === 'none'}
              value={icon.background}
              onChange={(event) => onChange('appIcon', { ...icon, background: event.target.value })}
            />
          </label>
        </div>
        <div className="app-icon-previews" aria-label="App icon preview">
          {icon.png ? (
            <>
              <img className="app-icon-preview app-icon-square" src={icon.png} alt="App icon" />
              <img className="app-icon-preview app-icon-round" src={icon.png} alt="App icon, round" />
            </>
          ) : (
            <img className="app-icon-preview app-icon-square" src="/icon.svg" alt="PrintShopLedger icon" />
          )}
        </div>
      </div>
      {error && <p className="danger-text">{error}</p>}
      <small>
        After saving, install the app again on each phone or computer (remove the old copy first) to see the
        new icon. Copies installed before keep the icon they were installed with.
      </small>
    </>
  );
}
