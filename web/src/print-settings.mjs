export const defaultPrintSettings = () => ({
  printer: '',
  paper: 'A4',
  width: 210,
  height: 297,
  orientation: 'portrait',
  font: 'Arial',
  fontSize: 10,
  bold: false,
  italic: false,
  color: false,
  margins: { top: 5, right: 5, bottom: 5, left: 5 },
  copies: 1,
  paperSource: '',
  autoPrint: false,
});
export const paperSizes = {
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4],
  'Receipt 80mm': [80, 200],
  'Receipt 58mm': [58, 200],
};
export function validatePrintSettings(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid print settings.');
  const s = structuredClone(value);
  for (const field of ['printer', 'font', 'paperSource', 'paper']) {
    if (typeof s[field] !== 'string' || s[field].length > 200 || /[\x00-\x1f]/.test(s[field]))
      throw new Error(`Invalid ${field}.`);
    s[field] = s[field].trim();
  }
  if (!s.font) throw new Error('Choose a font.');
  for (const [field, min, max] of [
    ['width', 20, 1000],
    ['height', 20, 2000],
    ['fontSize', 6, 72],
    ['copies', 1, 20],
  ]) {
    if (!Number.isFinite(s[field]) || s[field] < min || s[field] > max)
      throw new Error(`${field} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(s.copies)) throw new Error('Copies must be a whole number.');
  if (!['portrait', 'landscape'].includes(s.orientation)) throw new Error('Choose a valid orientation.');
  for (const flag of ['bold', 'italic', 'color', 'autoPrint'])
    if (typeof s[flag] !== 'boolean') throw new Error(`Invalid ${flag}.`);
  for (const edge of ['top', 'right', 'bottom', 'left'])
    if (!Number.isFinite(s.margins?.[edge]) || s.margins[edge] < 0 || s.margins[edge] > 200)
      throw new Error('Margins must be between 0 and 200 mm.');
  const [w, h] = s.orientation === 'landscape' ? [s.height, s.width] : [s.width, s.height];
  if (s.margins.left + s.margins.right >= w || s.margins.top + s.margins.bottom >= h)
    throw new Error('Margins must leave room for printing.');
  if (s.autoPrint && !s.printer) throw new Error('Select a printer before enabling automatic printing.');
  return s;
}
export const settingsKey = (scope) => `printshopledger:printing:v1:${scope}`;
export function loadPrintSettings(scope, storage = localStorage) {
  const raw = storage.getItem(settingsKey(scope));
  return raw ? validatePrintSettings(JSON.parse(raw)) : defaultPrintSettings();
}
export function savePrintSettings(scope, settings, storage = localStorage) {
  if (!scope) throw new Error('Open a business workspace first.');
  const validated = validatePrintSettings(settings);
  storage.setItem(settingsKey(scope), JSON.stringify(validated));
  return validated;
}
export function qzOptions(settings, name = 'PrintShopLedger') {
  const s = validatePrintSettings(settings);
  return {
    units: 'mm',
    size: { width: s.width, height: s.height },
    margins: s.margins,
    orientation: s.orientation,
    colorType: s.color ? 'color' : 'grayscale',
    copies: s.copies,
    ...(s.paperSource ? { printerTray: s.paperSource } : {}),
    jobName: name,
    scaleContent: false,
  };
}
export const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export function printDocument(settings, title, body) {
  const s = validatePrintSettings(settings);
  // body is trusted app-rendered markup; all user values must be escaped by the caller.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{margin:0;font-family:"${escapeHtml(s.font).replace(/\\/g, '')}";font-size:${s.fontSize}pt;font-weight:${s.bold ? 'bold' : 'normal'};font-style:${s.italic ? 'italic' : 'normal'};-webkit-print-color-adjust:exact;print-color-adjust:exact}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:4px}h1{font-size:1.4em}</style></head><body>${body}</body></html>`;
}

/**
 * The paper a receipt is drawn for, from Print Settings: printable size after orientation,
 * margins, colour, and a font scale (10 pt is the design size). Roll paper up to 90 mm wide
 * gets the till-roll layout, cut to the content's length; anything wider gets the page layout.
 */
export function receiptMedia(settings) {
  const s = validatePrintSettings(settings);
  const [width, height] = s.orientation === 'landscape' ? [s.height, s.width] : [s.width, s.height];
  return {
    width,
    height,
    margins: { ...s.margins },
    layout: width <= 90 ? 'roll' : 'page',
    color: s.color,
    fontScale: Math.min(1.6, Math.max(0.7, s.fontSize / 10)),
    copies: s.copies,
  };
}
/**
 * Narrowest edges a printer can print to. Printers cannot print to the paper's edge: 80 mm
 * thermal rolls print 72 mm, 58 mm rolls 48 mm, office printers leave about 4 mm.
 */
export const unprintableEdge = (paperWidth) => (paperWidth <= 60 ? 5 : 4);

/**
 * Layout for printing straight to the printer. The PDF is drawn only as wide as the area the
 * printer can reach and placed at that area's edges, so nothing is shifted or cut off.
 * (A downloaded PDF keeps the full paper width; PDF viewers fit it to the printable area.)
 */
export function directPrintLayout(settings) {
  const media = receiptMedia(settings);
  const edge = unprintableEdge(media.width);
  const left = Math.max(media.margins.left, edge),
    right = Math.max(media.margins.right, edge);
  const inset = 1; // keep text off the very edge of the print head
  return {
    paperWidth: media.width,
    sides: { left, right },
    media: {
      ...media,
      width: media.width - left - right,
      margins: { ...media.margins, left: inset, right: inset },
    },
  };
}

/** QZ options for a PDF from directPrintLayout: placed inside the side edges, fitted to that area. */
export function qzPdfOptions(settings, name = 'PrintShopLedger', pageHeight = null) {
  const base = qzOptions(settings, name),
    layout = directPrintLayout(settings);
  return {
    ...base,
    size: { width: layout.paperWidth, height: pageHeight ?? layout.media.height },
    orientation: 'portrait',
    margins: { top: 0, bottom: 0, left: layout.sides.left, right: layout.sides.right },
    scaleContent: true,
  };
}

const standardPrefix = /^(iso|na|jis|jpn|prc|roc|om|oufuko)-/;
/** A readable label for a paper name reported by the printer driver ("iso-a4" → "A4"). */
export function paperLabel(name) {
  const text = String(name ?? '').trim();
  if (!standardPrefix.test(text)) return text;
  const [prefix, ...rest] = text.split('-');
  const words = rest.map((word) =>
    /^[a-z]\d+$/.test(word) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1),
  );
  return (prefix === 'jis' || prefix === 'prc' ? [prefix.toUpperCase(), ...words] : words).join(' ');
}

/**
 * Paper sizes and trays from QZ Tray's printer details (QZ Tray 2.2.3+ reports sizes; 2.1+ trays).
 * Sizes are returned once each, in millimetres rounded to 0.1, sorted by area.
 */
export function printerMedia(details) {
  const sizes = [];
  const seen = new Set();
  for (const size of Array.isArray(details?.sizes) ? details.sizes : []) {
    const width = Math.round(Number(size?.mm?.width) * 10) / 10,
      height = Math.round(Number(size?.mm?.height) * 10) / 10;
    const label = paperLabel(size?.name).slice(0, 200);
    if (!label || !(width >= 20 && width <= 1000 && height >= 20 && height <= 2000) || seen.has(label))
      continue;
    seen.add(label);
    sizes.push({ name: label, width, height });
  }
  sizes.sort((a, b) => a.width * a.height - b.width * b.height || a.name.localeCompare(b.name));
  const trays = [
    ...new Set(
      (Array.isArray(details?.trays) ? details.trays : [])
        .map((tray) => String(tray).trim())
        .filter((tray) => tray && tray.length <= 200),
    ),
  ];
  return { sizes, trays };
}
