import { resolveLogo } from './logo-variants.mjs';

export const logoPositions = {
  right: 'Right, beside business details',
  left: 'Left, beside business details',
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
};
export const logoPosition = (value) => (Object.hasOwn(logoPositions, value) ? value : 'right');

export function resolveWatermark(settings) {
  if (!settings?.documents?.watermark) return '';
  const layout = settings.documents.watermarkLogoLayout;
  return resolveLogo(
    layout ? { ...settings, receiptPage: { ...settings.receiptPage, logoLayout: layout } } : settings,
    'page',
  );
}

/** Keep the logo's aspect ratio; reserve space so business details never overlap it. */
export function documentHeaderGeometry(position, left, top, width, w, h, gap = 8) {
  const p = logoPosition(position);
  const above = p.startsWith('top-');
  const x =
    p === 'left' || p === 'top-left' ? left : p === 'top-center' ? left + (width - w) / 2 : left + width - w;
  return {
    x,
    y: top,
    textX: !above && p === 'left' ? left + w + gap : left,
    textY: above ? top + h + gap : top,
    textWidth: above ? width : Math.max(1, width - w - gap),
    bottom: top + h,
  };
}

/** Inputs are already escaped by the document renderer. */
export function documentHeaderHtml(identity, logo, position) {
  const p = logoPosition(position);
  if (!logo) return `<table class="head"><tr><td>${identity}</td></tr></table>`;
  if (p.startsWith('top-')) {
    const align = p === 'top-center' ? 'center' : p === 'top-right' ? 'right' : 'left';
    return `<div class="head-logo" style="text-align:${align};margin-bottom:10px">${logo}</div><table class="head"><tr><td>${identity}</td></tr></table>`;
  }
  return `<table class="head"><tr>${p === 'left' ? `<td style="padding-right:16px;width:1%">${logo}</td><td>${identity}</td>` : `<td>${identity}</td><td class="r">${logo}</td>`}</tr></table>`;
}
