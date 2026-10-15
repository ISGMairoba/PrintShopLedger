import type { Branding } from './useBusinessBranding';
import { resolveLogo, logoVariantsDefaults } from './logo-variants.mjs';

// Thermal receipt printers print black only: a coloured or pale logo (an orange wordmark, say)
// comes out faint or not at all. For till rolls the logo is turned into solid black ink: every
// pixel that differs clearly from the logo's background becomes black, the rest transparent.

const cache = new Map<string, Promise<string>>();

export function inkLogo(dataUrl: string): Promise<string> {
  let result = cache.get(dataUrl);
  if (!result) {
    result = (async () => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(img, 0, 0);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const px = image.data;
      // Background: the colour of the top-left corner (transparent counts as white).
      const corner = px[3] < 128 ? [255, 255, 255] : [px[0], px[1], px[2]];
      for (let i = 0; i < px.length; i += 4) {
        const alpha = px[i + 3] / 255;
        // Blend onto white so transparent areas read as background.
        const r = px[i] * alpha + 255 * (1 - alpha),
          g = px[i + 1] * alpha + 255 * (1 - alpha),
          b = px[i + 2] * alpha + 255 * (1 - alpha);
        const distance = Math.hypot(r - corner[0], g - corner[1], b - corner[2]);
        const ink = distance > 110; // faint shadows and anti-aliasing stay blank
        px[i] = px[i + 1] = px[i + 2] = 0;
        px[i + 3] = ink ? 255 : 0;
      }
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png');
    })();
    cache.set(dataUrl, result);
    result.catch(() => cache.delete(dataUrl));
  }
  return result;
}

/** The business details with its logo in black ink (unchanged when there is no logo). */
export async function withInkLogo(business: string | Branding): Promise<string | Branding> {
  if (typeof business === 'string') return business;
  const logo = resolveLogo(business, 'documents', 'light');
  if (!logo) return business;
  try {
    return { ...business, logo: await inkLogo(logo), logoVariants: logoVariantsDefaults() };
  } catch {
    return business;
  }
}
