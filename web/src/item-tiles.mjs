// Quick sale item tiles (Business Settings → Appearance → Item tiles): the card is the theme's colour;
// the icon area is coloured. Colours are made from the brand colours (small changes of hue, saturation
// and lightness), so every tile belongs to the brand. The business chooses varied or one colour, by
// category or by item, and how many colours (3–8); it can generate a new mix or set any colour itself.
// Saved colours are the light-mode shade; dark mode uses the same hue, deeper.

export const TILE_COUNTS = [3, 4, 5, 6, 7, 8];
export const tileDefaults = () => ({ mode: 'varied', by: 'category', count: 6, seed: 0, colors: /** @type {string[]} */ ([]) });

const hex6 = /^#[0-9a-f]{6}$/i;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** '#rrggbb' → [hue 0–360, saturation 0–100, lightness 0–100]. */
export function toHsl(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/** [hue, saturation, lightness] → '#rrggbb'. */
export function toHex([h, s, l]) {
  const sat = clamp(s, 0, 100) / 100,
    lig = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// A small, repeatable random series for "Generate again".
const series = (seed) => {
  let x = (seed * 2654435761 + 1013904223) >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
};

/**
 * `count` light tile colours from the brand colours: shades around the primary and accent hues
 * (within about ±40°), softly saturated and light. `seed` gives another mix.
 */
export function generateTileColors(primary, accent, count = 6, seed = 0) {
  const bases = [primary, accent].filter((c) => hex6.test(c ?? '')).map(toHsl);
  if (!bases.length) bases.push([160, 60, 18]);
  const rand = series(seed);
  const colors = [];
  for (let i = 0; i < count; i++) {
    const [h, s] = bases[i % bases.length];
    const step = Math.floor(i / bases.length);
    const spread = Math.ceil(count / bases.length);
    // Spread the shades of each brand colour from −40° to +40°, nudged by the seed.
    const offset = spread > 1 ? -40 + (80 * step) / (spread - 1) : 0;
    const hue = (h + offset + (rand() - 0.5) * 16 + 360) % 360;
    const sat = clamp((s || 40) * 0.75 + (rand() - 0.5) * 14, 22, 62);
    const light = 88 + (rand() - 0.5) * 6;
    colors.push(toHex([hue, sat, light]));
  }
  return colors;
}

/** Saved tile settings, checked (colours: as many as `count`, or none for generated ones). */
export function validateTiles(input) {
  const value = tileDefaults();
  if (input === undefined || input === null) return value;
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid item tile settings.');
  value.mode = input.mode === 'single' ? 'single' : 'varied';
  value.by = input.by === 'item' ? 'item' : 'category';
  value.count = TILE_COUNTS.includes(input.count) ? input.count : 6;
  value.seed = Number.isSafeInteger(input.seed) && input.seed >= 0 && input.seed < 1e6 ? input.seed : 0;
  const colors = Array.isArray(input.colors) ? input.colors : [];
  if (colors.length && (colors.length !== value.count || colors.some((c) => !hex6.test(c))))
    throw Error('Choose a valid colour for each tile colour.');
  value.colors = colors.map((c) => c.toLowerCase());
  return value;
}

/** The light tile colours in use: the business's own, else generated from the brand. */
export function tileColors(tiles, primary, accent) {
  const t = validateTiles(tiles);
  if (t.mode === 'single') return [generateTileColors(primary, accent, 1, t.seed)[0]];
  return t.colors.length ? t.colors : generateTileColors(primary, accent, t.count, t.seed);
}

/** A light tile colour as shown: its background and icon colour, in light or dark mode. */
export function tileLook(color, dark = false) {
  const [h, s] = toHsl(color);
  return dark
    ? { background: toHex([h, clamp(s * 0.7, 10, 45), 24]), ink: toHex([h, clamp(s + 20, 30, 80), 80]) }
    : { background: color, ink: toHex([h, clamp(s + 25, 35, 85), 26]) };
}

const hash = (text) => {
  let n = 2166136261;
  for (const ch of String(text)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n;
};

/**
 * Which colour each item gets: by category (all items of a category share a colour, categories in
 * A–Z order take the colours in turn; items with no category by item) or by item.
 * @returns {(item: { id: string, category?: string }) => number} the colour's index
 */
export function tileColorPicker(tiles, items, count) {
  const t = validateTiles(tiles);
  if (t.mode === 'single' || count <= 1) return () => 0;
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  return (item) =>
    t.by === 'category' && item.category ? categories.indexOf(item.category) % count : hash(item.id) % count;
}
