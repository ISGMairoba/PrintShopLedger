import { mergeOptionsSection } from './options-sections.mjs';
import BranchesSettings, { type BranchStaff } from './BranchesSettings';
import { logoPositions, resolveWatermark } from './document-logos.mjs';
import Icon from './Icon';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { TEMPLATE_LIMIT } from './pricing-templates.mjs';
import { receiptHtml } from './receipts.mjs';
import { sampleReceipt } from './receipt-sample.mjs';
import BusinessOptionsEditor from './BusinessOptionsEditor';
import ThemeBackgroundEditor from './ThemeBackgroundEditor';
import LogoVariantsEditor from './LogoVariantsEditor';
import { resolveLogo, logoLayouts } from './logo-variants.mjs';
import {
  allowedSettingsTabs,
  developerSettingsTabs,
  minimumPageAccess,
  pages,
  roleNames,
  settingsTabKeys,
  settingsTabs,
} from './page-access.mjs';
import { useEffect, useState, type ReactNode } from 'react';
import {
  defaultBranding,
  validateBranding,
  suggestedPalette,
  contrastText,
  POWERED_BY_MAX,
} from './business-branding.mjs';
import type { Branding } from './useBusinessBranding';
import { termPresets } from './terms.mjs';
import { useWords } from './Words';
export default function BusinessSettingsPage({
  settings,
  version,
  ready,
  online,
  demo,
  modifiedAt,
  accessLevel,
  onSave,
  onReload,
  loadStaff,
  accountSettings,
}: {
  accountSettings?: ReactNode;
  settings: Branding;
  version: number;
  ready: boolean;
  online: boolean;
  demo: boolean;
  modifiedAt?: string;
  /** The person's rank: Developer (4) sees every tab; others only the tabs given to their rank. */
  accessLevel: number;
  onSave: (settings: Branding, version: number) => Promise<unknown>;
  onReload: () => Promise<void>;
  /** The business's staff, for Branches → Who works where (not available everywhere). */
  loadStaff?: () => Promise<BranchStaff[]>;
}) {
  const { w } = useWords();
  const [draft, setDraft] = useState(settings),
    [base, setBase] = useState(version),
    [dirtyKeys, setDirtyKeys] = useState<(keyof Branding)[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage, messageTone] = useFeedbackMessage('success'),
    [palette, setPalette] = useState<string[]>([]);
  const tabs: string[] = allowedSettingsTabs(accessLevel, settings);
  const tabKeys = (name: string) =>
    (developerSettingsTabs[name as keyof typeof developerSettingsTabs] ??
      settingsTabKeys[name as keyof typeof settingsTabKeys]) as (keyof Branding)[];
  const [tab, setTab] = useState(tabs[0]);
  const [branchStaff, setBranchStaff] = useState<BranchStaff[] | null>(null);
  useEffect(() => {
    if (tab !== 'Branches' || !loadStaff || branchStaff) return;
    let live = true;
    loadStaff()
      .then((list) => live && setBranchStaff(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, branchStaff]);
  const [dirtyOptions, setDirtyOptions] = useState<string[]>([]);
  const optionPart = (label: string) =>
    label === 'Payment methods' ? 'payments' : label === 'Dropdown settings' ? 'workflow' : null;
  const sectionDirty = (label: string, keys: (keyof Branding)[]) =>
    optionPart(label)
      ? dirtyOptions.includes(optionPart(label)!)
      : keys.some((key) => dirtyKeys.includes(key));
  const tabDirty = (name: string) =>
    name === 'Payment methods'
      ? dirtyOptions.includes('payments')
      : name === 'Dropdowns & workflow'
        ? dirtyOptions.includes('workflow')
        : tabKeys(name).some((key) => dirtyKeys.includes(key));
  const dirty = dirtyKeys.length > 0;
  useEffect(() => {
    if (!dirty) {
      setDraft(settings);
      setBase(version);
    }
  }, [settings, version, dirty]);
  function field(key: keyof Branding, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirtyKeys((keys) => (keys.includes(key) ? keys : [...keys, key]));
    setMessage('');
  }
  async function logo(file?: File, layout?: string, mode: 'light' | 'dark' = 'light') {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024)
        throw Error('Choose a PNG or JPEG image up to 5 MB.');
      const url = URL.createObjectURL(file);
      let img: HTMLImageElement;
      try {
        img = new Image();
        img.src = url;
        await img.decode();
      } finally {
        URL.revokeObjectURL(url);
      }
      if (img.width * img.height > 25000000) throw Error('Choose an image smaller than 25 megapixels.');
      const ratio = Math.min(1, 640 / Math.max(img.width, img.height)),
        canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      const context = canvas.getContext('2d')!;
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      let result = canvas.toDataURL('image/png');
      if (result.length > 350000)
        throw Error(
          'This logo is too detailed. Choose a smaller image; the processed logo must be up to 250 KB.',
        );
      if (layout)
        field('logoVariants', {
          ...draft.logoVariants,
          [layout]: { ...draft.logoVariants[layout], [mode]: result },
        });
      else field('logo', result);
      setPalette(suggestedPalette(context.getImageData(0, 0, canvas.width, canvas.height).data));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function saveSection(label: string, keys: (keyof Branding)[]) {
    if (busy || !ready || version !== base || (!demo && !online) || !sectionDirty(label, keys)) return;
    setBusy(true);
    setMessage('');
    try {
      const part = optionPart(label);
      const payload = validateBranding({
        ...settings,
        ...Object.fromEntries(
          keys.map((key) => [
            key,
            key === 'options' && part
              ? mergeOptionsSection(settings.options, draft.options, part)
              : draft[key],
          ]),
        ),
      });
      const saved = (await onSave(payload, base)) as { settings: Branding; version: number };
      setDraft((current) => ({
        ...current,
        ...Object.fromEntries(
          keys.map((key) => [
            key,
            key === 'options' && part
              ? mergeOptionsSection(current.options, saved.settings.options, part)
              : saved.settings[key],
          ]),
        ),
      }));
      setBase(saved.version);
      setDirtyKeys((current) =>
        current.filter(
          (key) => !keys.includes(key) || (key === 'options' && part && dirtyOptions.some((p) => p !== part)),
        ),
      );
      setDirtyOptions((current) =>
        part ? current.filter((p) => p !== part) : keys.includes('options') ? [] : current,
      );
      setMessage(`${label} saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  const sectionSave = (label: string, keys: (keyof Branding)[]) => (
    <button
      type="button"
      className="section-save"
      disabled={
        busy ||
        !ready ||
        (!demo && !online) ||
        version !== base ||
        !keys.some((key) => dirtyKeys.includes(key))
      }
      onClick={() => void saveSection(label, keys)}
    >
      <Icon name="save" /> Save {w(label).toLowerCase()}
    </button>
  );
  // Receipt printers and full pages each keep their own receipt settings.
  const [previewLayout, setPreviewLayout] = useState<'narrow' | 'wide'>('narrow');
  const receiptKey = previewLayout === 'narrow' ? 'receipt' : 'receiptPage';
  const opts = draft[receiptKey];
  const receipt = (key: keyof Branding['receipt'], value: unknown) =>
    field(receiptKey, { ...opts, [key]: value });
  return (
    <section className="panel editor business-settings" aria-label="Business settings">
      <p>Shared across your business. Printer selection remains specific to each device.</p>
      {!online && !demo && (
        <p className="notice">You can view saved settings offline. Connect before saving changes.</p>
      )}
      {version !== base && dirty && (
        <p className="notice notice-warning">
          Another user changed the settings. Reload the saved version before making a new edit.
        </p>
      )}
      <FeedbackBanner message={message} tone={messageTone} />
      <div className="business-settings-layout">
        <div className="settings-section-navigation">
          <label className="settings-section-picker">
            Section
            <select
              aria-label="Business settings section"
              value={tab}
              onChange={(event) => setTab(event.target.value)}
            >
              {tabs.map((name) => (
                <option key={name} value={name}>
                  {w(name)}
                  {tabDirty(name) ? ' •' : ''}
                </option>
              ))}
            </select>
          </label>
          <div
            role="tablist"
            aria-label="Business settings sections"
            aria-orientation="vertical"
            className="settings-tabs business-section-tabs"
          >
            {tabs.map((name, index) => (
              <button
                type="button"
                role="tab"
                id={`business-tab-${index}`}
                aria-selected={tab === name}
                aria-controls={`business-panel-${index}`}
                tabIndex={tab === name ? 0 : -1}
                key={name}
                className={tab === name ? 'active' : 'secondary'}
                onClick={() => setTab(name)}
                onKeyDown={(event) => {
                  if (
                    ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : (index +
                              (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) +
                              tabs.length) %
                            tabs.length;
                    setTab(tabs[next]);
                    document.getElementById(`business-tab-${next}`)?.focus();
                  }
                }}
              >
                {w(name)}
                {tabDirty(name) ? ' •' : ''}
              </button>
            ))}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`business-panel-${tabs.indexOf(tab)}`}
          aria-labelledby={`business-tab-${tabs.indexOf(tab)}`}
        >
          {tab === 'Accounts' ? (
            accountSettings
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void saveSection('Business settings', dirtyKeys);
              }}
            >
              <fieldset hidden={tab !== 'Profile & logo'} disabled={busy || !ready}>
                <legend>Business details</legend>
                <div className="form-grid">
                  {(
                    [
                      ['businessName', 'Business name', 160],
                      ['address', 'Address', 500],
                      ['phones', 'Phone / WhatsApp numbers', 200],
                      ['email', 'Email', 200],
                      ['website', 'Website', 300],
                      ['socials', 'Social handles', 500],
                    ] as const
                  ).map(([key, label, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        aria-label={label}
                        type={key === 'email' ? 'email' : key === 'website' ? 'url' : 'text'}
                        required={key === 'businessName'}
                        maxLength={max}
                        value={draft[key]}
                        onChange={(e) => field(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                {sectionSave('Business details', [
                  'businessName',
                  'address',
                  'phones',
                  'email',
                  'website',
                  'socials',
                ])}
              </fieldset>
              <fieldset hidden={tab !== 'Profile & logo'} disabled={busy || !ready}>
                <legend>Logo</legend>
                <p>
                  PNG or JPEG, up to 5 MB. The app preserves proportions and creates a smaller, receipt-ready
                  copy.
                </p>
                {draft.logo && (
                  <img className="business-logo-preview" src={draft.logo} alt="Business logo preview" />
                )}
                <label>
                  Upload logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => void logo(e.target.files?.[0])}
                  />
                </label>
                {draft.logo && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      field('logo', '');
                      setPalette([]);
                    }}
                  >
                    <Icon name="close" /> Remove logo
                  </button>
                )}
                <LogoVariantsEditor value={draft} onChange={field} onUpload={logo} busy={busy} />
                {sectionSave('Logo', ['logo', 'logoVariants', 'logoUsage'])}
              </fieldset>
              <fieldset hidden={tab !== 'Appearance'} disabled={busy || !ready}>
                <legend>Appearance</legend>
                <div className="form-grid">
                  <label>
                    Primary color
                    <input
                      type="color"
                      aria-label="Primary color"
                      value={draft.primary}
                      onChange={(e) => field('primary', e.target.value)}
                    />
                    <small>{draft.primary} · Button text contrast adjusts automatically.</small>
                  </label>
                  <label>
                    Accent color
                    <input
                      type="color"
                      aria-label="Accent color"
                      value={draft.accent}
                      onChange={(e) => field('accent', e.target.value)}
                    />
                    <small>{draft.accent}</small>
                  </label>
                  <label>
                    Business default theme
                    <select
                      aria-label="Business default theme"
                      value={draft.theme}
                      onChange={(e) => field('theme', e.target.value)}
                    >
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                      <option value="system">System</option>
                    </select>
                    <small>Users can override this in My Account on their device.</small>
                  </label>
                </div>
                {palette.length > 0 && (
                  <div className="logo-palette">
                    <p>Colors found in the logo. Choose a suggested primary color:</p>
                    {palette.map((color) => (
                      <button
                        type="button"
                        key={color}
                        style={{ background: color, color: contrastText(color) }}
                        onClick={() => field('primary', color)}
                      >
                        {color}
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className="brand-preview"
                  style={{
                    background: draft.primary,
                    color: contrastText(draft.primary),
                    borderBottom: `6px solid ${draft.accent}`,
                  }}
                >
                  Brand preview · {draft.businessName || 'Business'}
                </div>
                <ThemeBackgroundEditor value={draft} onChange={(value) => field('backgrounds', value)} />
                <div className="action-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const defaults = defaultBranding();
                      field('primary', defaults.primary);
                      field('accent', defaults.accent);
                      field('backgrounds', defaults.backgrounds);
                    }}
                  >
                    <Icon name="restore" /> Restore default colors
                  </button>
                  {sectionSave('Appearance', ['primary', 'accent', 'theme', 'backgrounds'])}
                </div>
              </fieldset>
              <fieldset hidden={tab !== 'Receipts'} disabled={busy || !ready} className="receipt-settings">
                <legend>Receipts & PDFs</legend>
                <p>
                  Choose what your receipts show and what stands out. These settings apply to printed
                  receipts, PDFs and the screen.
                </p>
                <div className="settings-tabs receipt-size-tabs" role="group" aria-label="Receipt size">
                  {(['narrow', 'wide'] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={previewLayout === value ? 'active' : 'secondary'}
                      aria-pressed={previewLayout === value}
                      onClick={() => setPreviewLayout(value)}
                    >
                      {value === 'narrow' ? 'Receipt printer (80 mm / 58 mm)' : 'Full page (A4 / A5)'}
                    </button>
                  ))}
                </div>
                <small>
                  Each size has its own settings. You are editing the{' '}
                  {previewLayout === 'narrow' ? 'receipt printer' : 'full-page'} receipt.
                </small>
                <div className="receipt-settings-grid">
                  <div>
                    <h3>Header</h3>
                    <label>
                      Logo for this document size
                      <select
                        aria-label="Logo for this document size"
                        value={opts.logoLayout}
                        onChange={(event) => receipt('logoLayout', event.target.value)}
                      >
                        <option value="">Use previous document logo</option>
                        {Object.entries(logoLayouts).map(([key, label]) => (
                          <option value={key} key={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {previewLayout !== 'narrow' && (
                      <label>
                        Full-page logo position
                        <select
                          aria-label="Full-page logo position"
                          value={opts.logoPosition ?? 'right'}
                          onChange={(e) => receipt('logoPosition', e.target.value)}
                        >
                          {Object.entries(logoPositions).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <small>
                      {previewLayout === 'narrow'
                        ? 'Used on 80mm and 58mm receipts, including roll PDFs.'
                        : 'Used on A4/A5 receipts, quotations, comparisons and report PDFs.'}{' '}
                      Upload logo artwork under Profile & logo. Documents use the light-background version.
                    </small>
                    {(
                      [
                        ['showLogo', 'Show logo'],
                        ['showBusinessName', 'Show business name'],
                        ['showAddress', 'Show address'],
                        ['showContacts', 'Show phone, email and website'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="check-label" key={key}>
                        <input
                          type="checkbox"
                          checked={opts[key]}
                          onChange={(e) => receipt(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    {!opts.showBusinessName &&
                      !(
                        opts.showLogo && resolveLogo(draft, previewLayout === 'narrow' ? 'roll' : 'page')
                      ) && <small>The name still shows while there is no logo on the receipt.</small>}
                    <h3>{w('Each job')}</h3>
                    <label>
                      Highlighted line
                      <select value={opts.headline} onChange={(e) => receipt('headline', e.target.value)}>
                        <option value="description">{w('Job description')}</option>
                        <option value="service">{w('Service name')}</option>
                      </select>
                    </label>
                    {(
                      [
                        [
                          'showSubline',
                          w(
                            opts.headline === 'service'
                              ? 'Job description below it'
                              : 'Service name below it',
                          ),
                        ],
                        ['showJobId', w('Job ID')],
                        ['showQuantity', 'Quantity'],
                        ['showSize', 'Size'],
                        ['showSource', w('How the job was received')],
                        ['showDueDate', 'Deadline'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="check-label" key={key}>
                        <input
                          type="checkbox"
                          checked={opts[key]}
                          onChange={(e) => receipt(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    <h3>{w('Amounts for each job')}</h3>
                    <small>{w('The job amount always shows.')}</small>
                    {(
                      [
                        ['showPaidBefore', 'Paid before (part-payments)'],
                        ['showPaidNow', 'Paid now'],
                        ['showItemBalance', 'Balance left'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="check-label" key={key}>
                        <input
                          type="checkbox"
                          checked={opts[key]}
                          onChange={(e) => receipt(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    <h3>Receipt details</h3>
                    <small>Receipt number, date and customer name always show.</small>
                    {(
                      [
                        ['showCustomerPhone', 'Customer phone'],
                        ['showCashier', 'Cashier name'],
                        ['showPaymentDate', 'Payment date'],
                        ['showPaymentMethod', 'Payment method name'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="check-label" key={key}>
                        <input
                          type="checkbox"
                          checked={opts[key]}
                          onChange={(e) => receipt(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    <h3>Totals and notes</h3>
                    {(
                      [
                        ['showWalletMovements', 'Wallet used or added'],
                        ['showAccountBalances', 'Customer account balances (outstanding and wallet)'],
                        ['showNote', 'Payment note'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="check-label" key={key}>
                        <input
                          type="checkbox"
                          checked={opts[key]}
                          onChange={(e) => receipt(key, e.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    <label>
                      Receipt footer
                      <input
                        maxLength={500}
                        value={opts.footer}
                        onChange={(e) => receipt('footer', e.target.value)}
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.documents?.watermark ?? false}
                        disabled={!resolveLogo(draft)}
                        onChange={(e) =>
                          field('documents', { ...draft.documents, watermark: e.target.checked })
                        }
                      />
                      Show a faint watermark on full-page documents and report PDFs
                    </label>
                    <label>
                      Watermark logo
                      <select
                        aria-label="Watermark logo"
                        value={draft.documents?.watermarkLogoLayout ?? ''}
                        onChange={(e) =>
                          field('documents', { ...draft.documents, watermarkLogoLayout: e.target.value })
                        }
                      >
                        <option value="">Use full-page document logo</option>
                        {Object.entries(logoLayouts).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {draft.documents?.watermark && resolveWatermark(draft) && (
                      <img
                        src={resolveWatermark(draft)}
                        alt="Selected watermark logo"
                        style={{ maxWidth: 120, maxHeight: 70, objectFit: 'contain', opacity: 0.35 }}
                      />
                    )}
                    {!resolveLogo(draft) && (
                      <small>Add a logo under Profile & logo to use a watermark.</small>
                    )}
                    <small>
                      {w(
                        'Changes affect receipt and report branding, not saved job amounts or payment balances.',
                      )}
                    </small>
                    <h3>Terms &amp; conditions</h3>
                    <label>
                      Default invoice / sales document terms
                      <textarea
                        maxLength={5000}
                        aria-label="Default invoice / sales document terms"
                        value={draft.documents?.invoiceTerms ?? ''}
                        onChange={(e) =>
                          field('documents', { ...draft.documents, invoiceTerms: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Default quotation terms
                      <textarea
                        maxLength={5000}
                        aria-label="Default quotation terms"
                        value={draft.documents?.quotationTerms ?? ''}
                        onChange={(e) =>
                          field('documents', { ...draft.documents, quotationTerms: e.target.value })
                        }
                      />
                    </label>
                    <small>
                      New documents copy these defaults. Edit them before saving a document; changing defaults
                      does not change saved documents. Leave blank to omit the section.
                    </small>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={draft.documents?.showTermsOnRoll ?? false}
                        onChange={(e) =>
                          field('documents', { ...draft.documents, showTermsOnRoll: e.target.checked })
                        }
                      />
                      Show saved terms on small receipts
                    </label>
                    {sectionSave('Receipt settings', ['receipt', 'receiptPage', 'documents'])}
                  </div>
                  <div className="receipt-preview">
                    <div className="receipt-preview-head">
                      <h3>Preview</h3>
                    </div>
                    <small>Example sale. Unsaved changes are shown.</small>
                    <div
                      className={`receipt-sheet ${previewLayout}`}
                      dangerouslySetInnerHTML={{
                        __html: receiptHtml(
                          { ...sampleReceipt(), termsAndConditions: draft.documents.invoiceTerms },
                          draft,
                          false,
                          [],
                          { layout: previewLayout },
                        ),
                      }}
                    />
                  </div>
                </div>
              </fieldset>
              <div hidden={tab !== 'Payment methods'}>
                <BusinessOptionsEditor
                  section="payments"
                  value={draft.options}
                  disabled={busy || !ready}
                  onChange={(value) => {
                    field('options', value);
                    setDirtyOptions((parts) => (parts.includes('payments') ? parts : [...parts, 'payments']));
                  }}
                  saveControl={sectionSave('Payment methods', ['options'])}
                />
              </div>
              <div hidden={tab !== 'Dropdowns & workflow'}>
                <BusinessOptionsEditor
                  value={draft.options}
                  onChange={(value) => {
                    field('options', value);
                    setDirtyOptions((parts) => (parts.includes('workflow') ? parts : [...parts, 'workflow']));
                  }}
                  disabled={busy || !ready}
                  saveControl={sectionSave('Dropdown settings', ['options'])}
                />
              </div>
              <fieldset hidden={tab !== 'Pricing templates'} disabled={busy || !ready}>
                <legend>Pricing templates</legend>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={draft.pricing.enabled}
                    onChange={(e) => field('pricing', { ...draft.pricing, enabled: e.target.checked })}
                  />
                  Enable pricing templates
                </label>
                <label>
                  Most active templates
                  <input
                    aria-label="Most active templates"
                    type="number"
                    min={1}
                    max={TEMPLATE_LIMIT}
                    step={1}
                    value={draft.pricing.maxTemplates ?? 100}
                    onChange={(e) =>
                      field('pricing', {
                        ...draft.pricing,
                        maxTemplates: e.target.value === '' ? 1 : Math.round(Number(e.target.value)),
                      })
                    }
                  />
                  <small>
                    1 to {TEMPLATE_LIMIT}. Archived templates don't count. Every device downloads all
                    templates, so keep only the ones you use.
                  </small>
                </label>
                <fieldset className="template-option-set">
                  <legend>Who can see template costs and profit (Internal job & audit)</legend>
                  {(
                    [
                      [1, 'Cashier'],
                      [2, 'Admin'],
                      [3, 'Manager'],
                    ] as const
                  ).map(([rank, label]) => {
                    const ranks = draft.pricing.auditRanks ?? [2, 3];
                    return (
                      <label className="check-label" key={rank}>
                        <input
                          type="checkbox"
                          checked={ranks.includes(rank)}
                          onChange={(e) =>
                            field('pricing', {
                              ...draft.pricing,
                              auditRanks: e.target.checked
                                ? [...ranks, rank].sort()
                                : ranks.filter((r) => r !== rank),
                            })
                          }
                        />
                        {label}
                      </label>
                    );
                  })}
                  <small>
                    Developers can always see them. Everyone else sees the client and staff views only.
                  </small>
                </fieldset>
                {sectionSave('Pricing templates', ['pricing'])}
              </fieldset>
              <fieldset hidden={tab !== 'Jobs & payments'} disabled={busy || !ready}>
                <legend>{w('Jobs & payments')}</legend>
                <h3>{w('Default job deadline')}</h3>
                <p>
                  {w(
                    'New jobs are due this long after they are added. Staff can change or clear the deadline when adding a job. Use 0 for no default deadline.',
                  )}
                </p>
                <div className="form-grid">
                  <label>
                    Duration
                    <input
                      type="number"
                      min="0"
                      max={draft.jobs.defaultDuration.unit === 'hours' ? 720 : 365}
                      step="1"
                      value={draft.jobs.defaultDuration.value}
                      onChange={(event) =>
                        field('jobs', {
                          ...draft.jobs,
                          defaultDuration: {
                            ...draft.jobs.defaultDuration,
                            value: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Unit
                    <select
                      value={draft.jobs.defaultDuration.unit}
                      onChange={(event) =>
                        field('jobs', {
                          ...draft.jobs,
                          defaultDuration: { ...draft.jobs.defaultDuration, unit: event.target.value },
                        })
                      }
                    >
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </label>
                </div>
                <h3>{w('Job descriptions')}</h3>
                <label>
                  {w('Job description entry')}
                  <select
                    value={draft.jobs.descriptionMode}
                    onChange={(event) =>
                      field('jobs', { ...draft.jobs, descriptionMode: event.target.value })
                    }
                  >
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                    <option value="hidden">Hidden — use service name</option>
                  </select>
                </label>
                <p>
                  {w(
                    'Applies to new checkout and quotation entries. If no description is entered, the service name is used. Existing descriptions are kept.',
                  )}
                </p>
                <h3>Payment amount at checkout</h3>
                <label>
                  Money received starts at
                  <select
                    value={draft.jobs.paymentPrefill}
                    onChange={(event) => field('jobs', { ...draft.jobs, paymentPrefill: event.target.value })}
                  >
                    <option value="suggested">The recommended payment</option>
                    <option value="zero">Zero (staff type the amount)</option>
                  </select>
                </label>
                <p>The recommended amount is always shown beside the box, with a button to use it.</p>
                <h3>Stock below zero</h3>
                <label>
                  When a sale or job needs more than is in stock
                  <select
                    aria-label="When a sale or job needs more than is in stock"
                    value={draft.jobs.stockBelowZero}
                    onChange={(event) => field('jobs', { ...draft.jobs, stockBelowZero: event.target.value })}
                  >
                    <option value="allow">Allow it, with a warning</option>
                    <option value="block">Don't allow it until an admin updates the stock</option>
                  </select>
                </label>
                <p>
                  Applies to every stock item: sales, quick sales, materials confirmed in production and
                  waste. Work saved without a connection is checked again when it syncs; if the stock has run
                  out by then, it waits in the conflict inbox until the stock is updated.
                </p>
                {sectionSave('Job and payment settings', ['jobs'])}
                <h3>Words</h3>
                <p>
                  What the app calls jobs, services and materials, and the fixed job stages. A shop that sells
                  goods can say orders and products. Only the screens, receipts and reports change; your
                  records stay the same, so you can switch back at any time.
                </p>
                <label>
                  Words for
                  <select
                    value={draft.terms.preset}
                    onChange={(event) => {
                      const preset = event.target.value as keyof typeof termPresets | 'custom';
                      if (preset === 'custom') return field('terms', { ...draft.terms, preset });
                      const { label: _label, stages, ...words } = termPresets[preset];
                      field('terms', { preset, ...words, stages: { ...stages } });
                    }}
                  >
                    {Object.entries(termPresets).map(([key, preset]) => (
                      <option key={key} value={key}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">My own words</option>
                  </select>
                </label>
                <div className="form-grid">
                  {(
                    [
                      ['job', 'One job'],
                      ['jobs', 'Several jobs'],
                      ['service', 'One service'],
                      ['services', 'Several services'],
                      ['material', 'One material'],
                      ['materials', 'Several materials'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        maxLength={30}
                        value={draft.terms[key]}
                        onChange={(event) =>
                          field('terms', { ...draft.terms, preset: 'custom', [key]: event.target.value })
                        }
                      />
                    </label>
                  ))}
                  {(['Added', 'Completed', 'Collected'] as const).map((stage) => (
                    <label key={stage}>
                      Stage “{stage}”
                      <input
                        maxLength={40}
                        value={draft.terms.stages[stage]}
                        onChange={(event) =>
                          field('terms', {
                            ...draft.terms,
                            preset: 'custom',
                            stages: { ...draft.terms.stages, [stage]: event.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="muted">
                  {w(
                    'Shelf items (Services → Sold off the shelf, or Add product) skip the stages and are marked Collected when sold.',
                  )}
                </p>
                {sectionSave('Words', ['terms'])}
                <h3>Discounts</h3>
                <p>
                  {w(
                    'The most each rank may take off a job, as a percentage of its price. Flat naira discounts and discounts on a whole order need Admin or higher. Developers have no limit. Use 0% to stop a rank giving discounts.',
                  )}
                </p>
                <div className="form-grid">
                  {(
                    [
                      ['1', 'Cashier'],
                      ['2', 'Admin'],
                      ['3', 'Manager'],
                    ] as const
                  ).map(([rank, label]) => (
                    <label key={rank}>
                      {label} limit (%)
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={draft.discounts.maxPercent[rank]}
                        onChange={(event) =>
                          field('discounts', {
                            maxPercent: { ...draft.discounts.maxPercent, [rank]: Number(event.target.value) },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                {sectionSave('Discount limits', ['discounts'])}
                <h3>Default time frame</h3>
                <p>
                  The period each page opens with. Staff can still choose another period while working; it
                  returns to this default next time.
                </p>
                <div className="form-grid">
                  {(
                    [
                      ['dashboard', 'Dashboard'],
                      ['reports', 'Reports'],
                      ['pointOfService', 'Point of Service'],
                      ['mySales', 'My Sales'],
                      ['jobs', 'Jobs'],
                      ['payments', 'Payments'],
                      ['expenses', 'Expenses'],
                      ['stockHistory', 'Stock History'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {w(label)}
                      <select
                        value={draft.periods[key]}
                        onChange={(event) =>
                          field('periods', { ...draft.periods, [key]: event.target.value })
                        }
                      >
                        {key !== 'dashboard' && key !== 'reports' && <option value="all">All dates</option>}
                        <option value="today">Today</option>
                        <option value="week">Last 7 days</option>
                        <option value="month">This month</option>
                        <option value="30days">Last 30 days</option>
                      </select>
                    </label>
                  ))}
                </div>
                {sectionSave('Default time frames', ['periods'])}
              </fieldset>
              <fieldset hidden={tab !== 'Corrections'} disabled={busy || !ready}>
                <legend>Correction history</legend>
                <label>
                  {w('Recent jobs window (days)')}
                  <input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={draft.corrections.recentDays}
                    onChange={(event) => field('corrections', { recentDays: Number(event.target.value) })}
                  />
                </label>
                <p>
                  {w(
                    'Show jobs created within this window in the correction selector. Default: 7 days. Changing this does not delete records or adjustment history.',
                  )}
                </p>
                {sectionSave('Correction settings', ['corrections'])}
              </fieldset>
              <fieldset hidden={tab !== 'Security'} disabled={busy || !ready}>
                <legend>Auto-lock and sync</legend>
                <label>
                  Lock the app after
                  <select
                    aria-label="Lock the app after"
                    value={draft.security.autoLockMinutes}
                    onChange={(event) =>
                      field('security', { ...draft.security, autoLockMinutes: Number(event.target.value) })
                    }
                  >
                    {[
                      ...new Set([
                        0,
                        1,
                        2,
                        5,
                        10,
                        15,
                        20,
                        30,
                        45,
                        60,
                        90,
                        120,
                        draft.security.autoLockMinutes,
                      ]),
                    ]
                      .sort((x, y) => x - y)
                      .map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes === 0
                            ? 'Never (off)'
                            : `${minutes} minute${minutes === 1 ? '' : 's'} without use`}
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  When nobody taps, clicks or types for this long, the signed-in user is signed out and the
                  staff sign-in shows with empty fields. The business stays signed in, and unsaved work on the
                  device is kept. While the device is offline it locks only once it is back online, so nobody
                  is locked out of selling without a connection.
                </p>
                <label>
                  Check for other devices' changes every
                  <select
                    aria-label="Check for other devices' changes every"
                    value={draft.security.syncMinutes}
                    onChange={(event) =>
                      field('security', { ...draft.security, syncMinutes: Number(event.target.value) })
                    }
                  >
                    {[...new Set([1, 2, 5, 10, 15, 30, 60, draft.security.syncMinutes])]
                      .sort((x, y) => x - y)
                      .map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes === 1 ? '1 minute' : `${minutes} minutes`}
                          {minutes === 2 ? ' (recommended)' : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  Work done on a device is always sent straight away. This sets how often each open device
                  fetches work done on other devices; it also fetches when the app is opened or brought back
                  to the front. Checking less often uses less of your cloud data allowance.
                </p>
                {sectionSave('Security settings', ['security'])}
              </fieldset>
              <fieldset hidden={tab !== 'Branches'} disabled={busy || !ready}>
                <legend>Branches</legend>
                <BranchesSettings
                  branches={draft.branches}
                  access={draft.branchAccess}
                  staff={branchStaff}
                  onBranches={(next) => field('branches', next)}
                  onAccess={(next) => field('branchAccess', next)}
                  pricing={draft.branchPricing}
                  onPricing={(next) => field('branchPricing', next)}
                />
                {sectionSave('Branches', ['branches', 'branchAccess', 'branchPricing'])}
              </fieldset>
              <fieldset hidden={tab !== 'Page access'} disabled={busy || !ready}>
                <legend>Page access by rank</legend>
                <p>
                  Developer can open every page. Choose the pages Cashier, Admin and Manager can open; My
                  Account is always available. Seeing a page does not by itself allow approving corrections,
                  resolving conflicts or managing users. Only Developer can open this Page access tab.
                </p>
                <div className="table-wrap">
                  <table className="access-matrix" aria-label="Page access by rank">
                    <thead>
                      <tr>
                        <th>Page</th>
                        {([1, 2, 3] as const).map((rank) => (
                          <th key={rank}>{roleNames[rank]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pages.map((page) => (
                        <tr key={page}>
                          <td>
                            {w(page)}
                            {page === 'My Account' && <small>Always available</small>}
                            {minimumPageAccess(page) > 1 && <small>Admin and above</small>}
                          </td>
                          {([1, 2, 3] as const).map((rank) => {
                            const locked = page === 'My Account' || minimumPageAccess(page) > rank;
                            return (
                              <td key={rank}>
                                <input
                                  type="checkbox"
                                  aria-label={`${roleNames[rank]} access to ${page}`}
                                  title={
                                    minimumPageAccess(page) > rank
                                      ? `Requires ${roleNames[minimumPageAccess(page)]}+`
                                      : undefined
                                  }
                                  disabled={locked}
                                  checked={draft.pageAccess[String(rank)].includes(page)}
                                  onChange={(event) =>
                                    field('pageAccess', {
                                      ...draft.pageAccess,
                                      [String(rank)]: event.target.checked
                                        ? [...draft.pageAccess[String(rank)], page]
                                        : draft.pageAccess[String(rank)].filter(
                                            (item: string) => item !== page,
                                          ),
                                    })
                                  }
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>Business Settings tabs</h3>
                <p>
                  When Admin or Manager can open Business Settings, choose which tabs they can see and change.
                  They cannot change anything on tabs they do not have.
                </p>
                <div className="table-wrap">
                  <table className="access-matrix" aria-label="Business Settings tabs by rank">
                    <thead>
                      <tr>
                        <th>Tab</th>
                        {([2, 3] as const).map((rank) => (
                          <th key={rank}>
                            {roleNames[rank]}
                            {!draft.pageAccess[String(rank)].includes('Business Settings') && (
                              <small>Page is off</small>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {settingsTabs.map((name) => (
                        <tr key={name}>
                          <td>{w(name)}</td>
                          {([2, 3] as const).map((rank) => (
                            <td key={rank}>
                              <input
                                type="checkbox"
                                aria-label={`${roleNames[rank]} access to the ${name} tab`}
                                checked={draft.settingsTabs[String(rank) as '2' | '3'].includes(name)}
                                onChange={(event) => {
                                  const current = draft.settingsTabs[String(rank) as '2' | '3'];
                                  field('settingsTabs', {
                                    ...draft.settingsTabs,
                                    [String(rank)]: event.target.checked
                                      ? settingsTabs.filter((t) => t === name || current.includes(t))
                                      : current.filter((t: string) => t !== name),
                                  });
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sectionSave('Page access', ['pageAccess', 'settingsTabs', 'settingsTabsVersion'])}
              </fieldset>
              <fieldset hidden={tab !== 'Installer credit'} disabled={busy || !ready}>
                <legend>Installer credit</legend>
                <p>
                  A small line naming who installed or supports this app, for example “Installed by Mairoba
                  Studio | 08088850271”. It prints in small grey text under the business’s own footer. Only
                  Developer can see or change this tab.
                </p>
                <div className="form-grid">
                  <label>
                    Credit line
                    <input
                      aria-label="Installer credit line"
                      value={draft.poweredBy.text}
                      maxLength={POWERED_BY_MAX}
                      placeholder="Installed by Mairoba Studio | 08088850271"
                      onChange={(event) =>
                        field('poweredBy', { ...draft.poweredBy, text: event.target.value })
                      }
                    />
                    <small>
                      {draft.poweredBy.text.trim().length}/{POWERED_BY_MAX} characters · one line, so it fits
                      an 80 mm receipt
                    </small>
                  </label>
                </div>
                <fieldset className="template-option-set">
                  <legend>Show it on</legend>
                  {(
                    [
                      ['receipts', 'Receipt printer receipts (80 mm and other rolls)'],
                      ['pages', 'Full pages: A4/A5 receipts, quotations and price comparisons'],
                      ['reports', 'Report PDFs'],
                      ['shares', 'Text shares pasted in chat'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="check-label" key={key}>
                      <input
                        type="checkbox"
                        checked={draft.poweredBy[key]}
                        onChange={(event) =>
                          field('poweredBy', { ...draft.poweredBy, [key]: event.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                {draft.poweredBy.text.trim() &&
                  !(['receipts', 'pages', 'reports', 'shares'] as const).some((k) => draft.poweredBy[k]) && (
                    <p className="muted">Tick at least one place for the credit to appear.</p>
                  )}
                {sectionSave('Installer credit', ['poweredBy'])}
              </fieldset>
              <div className="settings-save-status" role="status" aria-live="polite">
                {busy ? 'Saving changes…' : dirty ? 'Unsaved changes' : 'All changes saved'}
                {dirty && (
                  <small>
                    Section buttons save that section. Save business settings saves all edited sections.
                  </small>
                )}
              </div>
              <div className="settings-actions" role="group" aria-label="All settings actions">
                <button disabled={busy || !ready || (!demo && !online) || version !== base || !dirty}>
                  <Icon name="save" /> {busy ? 'Saving…' : 'Save business settings'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || (!demo && !online)}
                  onClick={async () => {
                    if (dirty && !confirm('Discard your unsaved settings and reload?')) return;
                    await onReload();
                    setDirtyKeys([]);
                    setDirtyOptions([]);
                    setMessage('');
                  }}
                >
                  <Icon name="sync" /> Reload saved settings
                </button>
              </div>
              {modifiedAt && (
                <small>
                  Last changed: {new Date(modifiedAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}
                </small>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
