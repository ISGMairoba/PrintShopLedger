import type { CSSProperties } from 'react';
import { contrastText, themeColors, themeVariables } from './business-branding.mjs';
import type { Branding } from './useBusinessBranding';

export default function ThemeBackgroundEditor({
  value,
  onChange,
}: {
  value: Branding;
  onChange: (backgrounds: Branding['backgrounds']) => void;
}) {
  const fields = [
    ['canvas', 'Page background'],
    ['surface', 'Panels & sidebar'],
    ['surfaceAlt', 'Inputs & table headers'],
  ] as const;
  function change(mode: 'light' | 'dark', key: (typeof fields)[number][0], color: string) {
    onChange({ ...value.backgrounds, [mode]: { ...value.backgrounds[mode], [key]: color } });
  }
  return (
    <div className="theme-background-editor">
      <h3>Background colors</h3>
      <p>
        Automatic colors follow your primary color, including in dark mode. Pick a color to override it, or
        select Automatic to follow the palette again. Text contrast adjusts automatically.
      </p>
      <div className="theme-background-modes">
        {(['light', 'dark'] as const).map((mode) => {
          const title = mode === 'light' ? 'Light' : 'Dark',
            colors = themeColors(value, mode);
          return (
            <section className="theme-background-mode" key={mode} aria-label={`${title} background colors`}>
              <h3>{title} mode</h3>
              {fields.map(([key, label]) => (
                <div className="theme-background-control" key={key}>
                  <label>
                    {label}
                    <input
                      type="color"
                      aria-label={`${title} ${label.toLowerCase()}`}
                      value={value.backgrounds[mode][key] || colors[key]}
                      onChange={(e) => change(mode, key, e.target.value)}
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      aria-label={`${title} ${label.toLowerCase()} automatic`}
                      checked={!value.backgrounds[mode][key]}
                      onChange={(e) => change(mode, key, e.target.checked ? '' : colors[key])}
                    />
                    Automatic
                  </label>
                  <small>
                    {value.backgrounds[mode][key] || colors[key]}
                    {!value.backgrounds[mode][key] ? ' · From palette' : ''}
                  </small>
                </div>
              ))}
              <div
                className="theme-background-preview"
                aria-label={`${title} theme preview`}
                style={themeVariables(value, mode) as CSSProperties}
              >
                <strong>{title} preview</strong>
                <div className="theme-preview-panel">
                  <strong>{value.businessName || 'Your business'}</strong>
                  <p>Panels and sidebar</p>
                  <div className="theme-preview-input">Inputs and table headers</div>
                  <span
                    className="theme-preview-button"
                    style={{ background: value.primary, color: contrastText(value.primary) }}
                  >
                    Primary button
                  </span>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
