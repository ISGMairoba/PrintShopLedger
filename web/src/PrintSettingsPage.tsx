import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { sampleReceipt } from './receipt-sample.mjs';
import type { CheckoutRecord } from './types';
import type { Branding } from './useBusinessBranding';
import {
  defaultPrintSettings,
  loadPrintSettings,
  savePrintSettings,
  validatePrintSettings,
  paperSizes,
} from './print-settings.mjs';
import {
  discoverPrinters,
  printCertificate,
  printHtml,
  printReceipt,
  type PrinterMedia,
  type PrintSettings,
} from './printing';
const sample =
  '<h1>PrintShopLedger</h1><p>TEST PRINT — no transaction recorded</p><table><tr><th>Item</th><th>Quantity</th><th>Amount</th></tr><tr><td>Sample printing</td><td>2</td><td>NGN 2,000.00</td></tr></table><p>Total: NGN 2,000.00</p><p>Thank you for your business.</p>';
const fonts = ['Arial', 'Calibri', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'];
export default function PrintSettingsPage({
  scope,
  ready,
  trusted,
  business = 'PrintShopLedger',
}: {
  scope: string;
  ready: boolean;
  /** Signed in to a business workspace, so trusted printing is available. */
  trusted: boolean;
  /** Business branding, so a receipt-roll test print looks like a real receipt. */
  business?: string | Branding;
}) {
  const [message, setMessage, messageTone] = useFeedbackMessage('success');
  const [settings, setSettings] = useState<PrintSettings>(() => {
    try {
      return loadPrintSettings(scope);
    } catch {
      return defaultPrintSettings();
    }
  });
  const [draft, setDraft] = useState<PrintSettings | null>(null);
  const [printers, setPrinters] = useState<string[]>([]);
  const [media, setMedia] = useState<Record<string, PrinterMedia>>({});
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [help, setHelp] = useState(false);
  const [preview, setPreview] = useState(false);
  async function connect() {
    setBusy(true);
    setMessage('');
    try {
      const result = await discoverPrinters();
      setPrinters(result.printers);
      setMedia(result.media);
      setConnected(true);
      setDraft((current) =>
        current && !current.printer ? { ...current, printer: result.defaultPrinter } : current,
      );
      setMessage(
        result.printers.length
          ? 'Printers loaded. Select your default printer and save.'
          : 'Connected, but no installed printers were found.',
        result.printers.length ? 'info' : 'warning',
      );
    } catch (error) {
      setConnected(false);
      setMessage(
        `Could not connect: ${error instanceof Error ? error.message : String(error)}. Install and start QZ Tray on this computer, then try again.`,
        'error',
      );
    } finally {
      setBusy(false);
    }
  }
  function save(e: FormEvent) {
    e.preventDefault();
    try {
      const next = savePrintSettings(scope, validatePrintSettings(draft));
      setSettings(next);
      setDraft(null);
      setMessage('Print settings saved for this workspace on this device.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  async function downloadCertificate() {
    setBusy(true);
    setMessage('');
    try {
      const certificate = await printCertificate();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([certificate], { type: 'application/x-x509-ca-cert' }));
      link.download = 'override.crt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setMessage('Certificate downloaded. Copy override.crt into the QZ Tray folder, then restart QZ Tray.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage('');
    try {
      // Receipt rolls print an example receipt the same way real receipts print.
      if (settings.width <= 90)
        await printReceipt(settings, sampleReceipt() as unknown as CheckoutRecord, business);
      else await printHtml(settings, 'PrintShopLedger test', sample);
      setMessage('Test sent to the printer. Check the printed page.');
    } catch (error) {
      setMessage(`Test print failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setBusy(false);
    }
  }
  const printerSizes = (draft?.printer && media[draft.printer]?.sizes) || [];
  const printerTrays = (draft?.printer && media[draft.printer]?.trays) || [];
  const commonSizes = Object.entries(paperSizes).map(([name, [width, height]]) => ({ name, width, height }));
  const listed = printerSizes.length ? printerSizes : commonSizes;
  // Keep a saved size visible even when the selected printer does not list it.
  const paperOptions =
    draft && draft.paper !== 'Custom' && !listed.some((option) => option.name === draft.paper)
      ? [...listed, { name: draft.paper, width: draft.width, height: draft.height }]
      : listed;
  return (
    <section className="panel print-settings-panel">
      <div className="toolbar">
        <button
          disabled={!ready || busy}
          onClick={() => {
            setMessage('');
            setDraft(structuredClone(settings));
          }}
        >
          <Icon name="edit" /> Edit settings
        </button>
        <button className="secondary" disabled={busy || !ready} onClick={connect}>
          <Icon name="sync" /> Connect printers
        </button>
        <button className="secondary" disabled={busy || !ready || !settings.printer} onClick={test}>
          <Icon name="services" /> Test print
        </button>
        <button className="secondary" onClick={() => setPreview(true)}>
          <Icon name="details" /> Layout sample
        </button>
        <button className="secondary" onClick={() => setHelp(true)}>
          Printer setup
        </button>
      </div>
      <FeedbackBanner message={message} tone={messageTone} />
      <p className="muted">
        These defaults belong to this business workspace on this device. Each computer can use its own
        printer.
      </p>
      <dl className="print-setting-summary">
        <div>
          <dt>Default printer</dt>
          <dd>{settings.printer || 'Not selected'}</dd>
        </div>
        <div>
          <dt>Paper</dt>
          <dd>
            {settings.paper} · {settings.width} × {settings.height} mm
          </dd>
        </div>
        <div>
          <dt>Orientation</dt>
          <dd>{settings.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</dd>
        </div>
        <div>
          <dt>Paper source</dt>
          <dd>{settings.paperSource || 'Printer default'}</dd>
        </div>
        <div>
          <dt>Font</dt>
          <dd>
            {settings.font} · {settings.fontSize} pt{settings.bold ? ' · Bold' : ''}
            {settings.italic ? ' · Italic' : ''}
          </dd>
        </div>
        <div>
          <dt>Colour</dt>
          <dd>{settings.color ? 'Colour' : 'Monochrome'}</dd>
        </div>
        <div>
          <dt>Margins (mm)</dt>
          <dd>
            Top {settings.margins.top} · Right {settings.margins.right} · Bottom {settings.margins.bottom} ·
            Left {settings.margins.left}
          </dd>
        </div>
        <div>
          <dt>Copies</dt>
          <dd>{settings.copies}</dd>
        </div>
        <div>
          <dt>Automatic printing preference</dt>
          <dd>{settings.autoPrint ? 'Enabled' : 'Disabled'}</dd>
        </div>
        <div>
          <dt>Printer connection</dt>
          <dd>{connected ? 'Connected during this session' : 'Not checked'}</dd>
        </div>
      </dl>
      <section className="trusted-printing">
        <h3>Trusted printing</h3>
        {trusted ? (
          <>
            <p>
              Install this business’s printing certificate in QZ Tray once on each printing computer. QZ Tray
              then recognises print requests from this business and stops asking for approval.
            </p>
            <ol>
              <li>Download the certificate below.</li>
              <li>
                Copy <code>override.crt</code> into the QZ Tray folder — Windows:{' '}
                <code>C:\Program Files\QZ Tray</code>; Mac:{' '}
                <code>/Applications/QZ Tray.app/Contents/Resources</code>; Linux: <code>/opt/qz-tray</code>.
                The computer may ask for administrator permission.
              </li>
              <li>Restart QZ Tray (right-click its icon, choose Exit, then open QZ Tray again).</li>
              <li>Select Connect printers. Printing no longer asks for approval.</li>
            </ol>
            <button className="secondary" disabled={busy || !ready} onClick={downloadCertificate}>
              <Icon name="save" /> Download certificate (override.crt)
            </button>
            <p className="muted">
              Each business has its own certificate; a computer trusts one business at a time. Without an
              internet connection, QZ Tray asks for approval as usual.
            </p>
          </>
        ) : (
          <p className="muted">Sign in to a business workspace to set up trusted printing.</p>
        )}
      </section>
      {draft && (
        <Modal
          title="Edit print settings"
          wide
          busy={busy}
          onClose={() => {
            setDraft(null);
            setMessage('');
          }}
        >
          <FeedbackBanner message={message} tone={messageTone} />
          <form onSubmit={save}>
            <div className="form-grid">
              <label>
                Default printer
                <select
                  aria-label="Default printer"
                  value={draft.printer}
                  onChange={(e) => setDraft({ ...draft, printer: e.target.value })}
                >
                  <option value="">Select a printer</option>
                  {Array.from(new Set([...printers, ...(draft.printer ? [draft.printer] : [])])).map(
                    (name) => (
                      <option key={name}>{name}</option>
                    ),
                  )}
                </select>
                <button className="secondary" type="button" disabled={busy} onClick={connect}>
                  Find installed printers
                </button>
              </label>
              <label>
                Paper size
                <select
                  aria-label="Paper size"
                  value={paperOptions.some((option) => option.name === draft.paper) ? draft.paper : 'Custom'}
                  onChange={(e) => {
                    const size = paperOptions.find((option) => option.name === e.target.value);
                    setDraft({
                      ...draft,
                      paper: e.target.value,
                      ...(size ? { width: size.width, height: size.height } : {}),
                    });
                  }}
                >
                  {paperOptions.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.name} ({option.width} × {option.height} mm)
                    </option>
                  ))}
                  <option value="Custom">Custom size</option>
                </select>
                <small>
                  {printerSizes.length
                    ? 'Sizes reported by this printer’s driver.'
                    : draft.printer && connected
                      ? 'This printer did not report its sizes; common sizes are shown. QZ Tray 2.2.3 or newer lists them.'
                      : 'Select Find installed printers to list the sizes this printer supports.'}
                </small>
              </label>
              <label>
                Paper width (mm)
                <input
                  type="number"
                  min="20"
                  max="1000"
                  step="0.1"
                  required
                  value={draft.width}
                  onChange={(e) => setDraft({ ...draft, paper: 'Custom', width: Number(e.target.value) })}
                />
              </label>
              <label>
                Paper height (mm)
                <input
                  type="number"
                  min="20"
                  max="2000"
                  step="0.1"
                  required
                  value={draft.height}
                  onChange={(e) => setDraft({ ...draft, paper: 'Custom', height: Number(e.target.value) })}
                />
              </label>
              <label>
                Orientation
                <select
                  aria-label="Orientation"
                  value={draft.orientation}
                  onChange={(e) => setDraft({ ...draft, orientation: e.target.value })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Paper source / tray
                {printerTrays.length ? (
                  <select
                    aria-label="Paper source / tray"
                    value={draft.paperSource}
                    onChange={(e) => setDraft({ ...draft, paperSource: e.target.value })}
                  >
                    <option value="">Printer default</option>
                    {Array.from(
                      new Set([...printerTrays, ...(draft.paperSource ? [draft.paperSource] : [])]),
                    ).map((tray) => (
                      <option key={tray}>{tray}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      aria-label="Paper source / tray"
                      value={draft.paperSource}
                      maxLength={200}
                      placeholder="Leave blank for printer default"
                      onChange={(e) => setDraft({ ...draft, paperSource: e.target.value })}
                    />
                    <small>Use the exact tray name from your printer driver.</small>
                  </>
                )}
              </label>
              {draft.width <= 90 && (
                <>
                  <label>
                    Receipt printer mode
                    <select
                      aria-label="Receipt printer mode"
                      value={draft.rollMethod ?? 'escpos'}
                      onChange={(e) =>
                        setDraft({ ...draft, rollMethod: e.target.value as 'escpos' | 'driver' })
                      }
                    >
                      <option value="escpos">Printer commands (recommended for thermal printers)</option>
                      <option value="driver">Through the printer driver</option>
                    </select>
                    <small>
                      Printer commands fit the receipt exactly to the print head. Use the driver only if the
                      printer does not understand ESC/POS.
                    </small>
                  </label>
                  {(draft.rollMethod ?? 'escpos') === 'escpos' && (
                    <label>
                      Print width
                      <select
                        aria-label="Print width"
                        value={draft.rollDots ?? 0}
                        onChange={(e) => setDraft({ ...draft, rollDots: Number(e.target.value) })}
                      >
                        <option value={0}>From the paper size</option>
                        <option value={576}>576 dots (80 mm paper, 72 mm print)</option>
                        <option value={512}>512 dots (80 mm paper, 64 mm print)</option>
                        <option value={384}>384 dots (58 mm paper, 48 mm print)</option>
                      </select>
                      <small>If the right side is cut off, choose the next smaller width.</small>
                    </label>
                  )}
                </>
              )}
              <label>
                Font
                <input
                  aria-label="Font"
                  list="print-fonts"
                  value={draft.font}
                  maxLength={200}
                  required
                  onChange={(e) => setDraft({ ...draft, font: e.target.value })}
                />
                <datalist id="print-fonts">
                  {fonts.map((font) => (
                    <option key={font} value={font} />
                  ))}
                </datalist>
                <small>The font must be installed on this computer.</small>
              </label>
              <label>
                Font size (pt)
                <input
                  type="number"
                  min="6"
                  max="72"
                  step="0.5"
                  required
                  value={draft.fontSize}
                  onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
                />
              </label>
              <label>
                Copies
                <input
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  required
                  value={draft.copies}
                  onChange={(e) => setDraft({ ...draft, copies: Number(e.target.value) })}
                />
              </label>
              <label>
                Print colour
                <select
                  aria-label="Print colour"
                  value={draft.color ? 'color' : 'mono'}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value === 'color' })}
                >
                  <option value="mono">Monochrome</option>
                  <option value="color">Colour</option>
                </select>
              </label>
              {(['top', 'right', 'bottom', 'left'] as const).map((edge) => (
                <label key={edge}>
                  {edge[0].toUpperCase() + edge.slice(1)} margin (mm)
                  <input
                    type="number"
                    min="0"
                    max="200"
                    step="0.1"
                    required
                    value={draft.margins[edge]}
                    onChange={(e) =>
                      setDraft({ ...draft, margins: { ...draft.margins, [edge]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="print-checkboxes">
              <label>
                <input
                  type="checkbox"
                  checked={draft.bold}
                  onChange={(e) => setDraft({ ...draft, bold: e.target.checked })}
                />{' '}
                Bold
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.italic}
                  onChange={(e) => setDraft({ ...draft, italic: e.target.checked })}
                />{' '}
                Italic
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.autoPrint}
                  onChange={(e) => setDraft({ ...draft, autoPrint: e.target.checked })}
                />{' '}
                Automatically print after transactions that require printing
              </label>
            </div>
            <p
              style={{
                fontFamily: draft.font,
                fontSize: `${draft.fontSize}pt`,
                fontWeight: draft.bold ? 'bold' : 'normal',
                fontStyle: draft.italic ? 'italic' : 'normal',
              }}
            >
              Font sample: PrintShopLedger · 0123456789
            </p>
            <div className="material-actions">
              <button disabled={busy} type="submit">
                <Icon name="save" /> Save settings
              </button>
              <button className="secondary" disabled={busy} type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      {help && (
        <Modal title="Printer setup" onClose={() => setHelp(false)}>
          <ol>
            <li>Install the printer and driver on this computer.</li>
            <li>
              Install and start{' '}
              <a href="https://qz.io/download/" target="_blank" rel="noreferrer">
                QZ Tray
              </a>
              .
            </li>
            <li>Select Connect printers, allow the connection, then edit and save your default printer.</li>
            <li>Use Test print to check the paper, font and margins.</li>
          </ol>
          <h3>Printer properties and custom paper</h3>
          <p>
            On Windows, open Settings → Bluetooth &amp; devices → Printers &amp; scanners → your printer →
            Printing preferences. Manage driver paper sizes, trays and other printer options there, then enter
            the matching size here. This web app cannot open the native printer-properties dialog.
          </p>
          <h3>Printing without prompts</h3>
          <p>
            QZ Tray sends print jobs without a browser print preview. To stop its approval prompts, install
            the business certificate as described under Trusted printing on this page.
          </p>
        </Modal>
      )}
      {preview && (
        <Modal title="Layout sample" wide onClose={() => setPreview(false)}>
          <p className="muted">A font and content sample; use Test print to verify actual paper output.</p>
          <div
            className="print-layout-sample"
            style={{
              fontFamily: settings.font,
              fontSize: `${settings.fontSize}pt`,
              fontWeight: settings.bold ? 'bold' : 'normal',
              fontStyle: settings.italic ? 'italic' : 'normal',
            }}
          >
            <h2>PrintShopLedger</h2>
            <p>TEST — no transaction recorded</p>
            <p>Sample printing · Quantity: 2</p>
            <p>Total: NGN 2,000.00</p>
            <p>Thank you for your business.</p>
          </div>
        </Modal>
      )}
    </section>
  );
}
