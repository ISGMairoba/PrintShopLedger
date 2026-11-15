// The icon an installed copy of the app shows on the phone or computer (home screen, app list).
// The business picks a logo layout and a background; the app draws a 512 px square PNG from it
// (with room around the logo for round and squircle masks) and saves it as settings.appIcon.
// The server hands it out at /b/<business>/icon.png with a matching manifest
// (supabase/functions/app-icon), so Android, desktop and iPhone installs use it.
import { resolveLogo } from './logo-variants.mjs';

export const APP_ICON_SIZE = 512;
export const appIconDefaults = () => ({ layout: 'none', background: '#ffffff', png: '' });

/** Settings from storage: a layout name, a #rrggbb background and the drawn PNG ('' for none). */
export function validateAppIcon(input) {
  const value = { ...appIconDefaults(), ...(input && typeof input === 'object' ? input : {}) };
  if (!['none', 'complete', 'stacked', 'horizontal', 'wordmark', 'icon'].includes(value.layout))
    throw Error('Choose a valid app icon layout.');
  if (!/^#[0-9a-f]{6}$/i.test(value.background)) throw Error('Choose a valid app icon background.');
  if (
    value.png !== '' &&
    !(
      typeof value.png === 'string' &&
      value.png.length <= 400000 &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.png)
    )
  )
    throw Error('The app icon is too large. Use a smaller logo.');
  if (value.layout === 'none') value.png = '';
  return { layout: value.layout, background: value.background, png: value.png };
}

/** The logo the icon is drawn from: the chosen layout on a light or dark background. */
export function appIconSource(settings, layout, background) {
  if (layout === 'none') return '';
  const dark = luminance(background) < 0.5;
  return resolveLogo({ ...settings, logoUsage: { ...settings.logoUsage, app: layout } }, 'app', dark ? 'dark' : 'light');
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Draw the square icon in the browser: the logo centred inside the safe 80% on the background. */
export async function drawAppIcon(source, background) {
  if (!source) return '';
  const image = new Image();
  image.src = source;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = APP_ICON_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw Error('This browser cannot draw the app icon.');
  context.fillStyle = background;
  context.fillRect(0, 0, APP_ICON_SIZE, APP_ICON_SIZE);
  const room = APP_ICON_SIZE * 0.72;
  const scale = Math.min(room / image.naturalWidth, room / image.naturalHeight);
  const w = image.naturalWidth * scale,
    h = image.naturalHeight * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, (APP_ICON_SIZE - w) / 2, (APP_ICON_SIZE - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}
