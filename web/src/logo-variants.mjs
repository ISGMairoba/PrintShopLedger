export const logoLayouts = {
  complete: 'Complete logo',
  stacked: 'Stacked · label below',
  horizontal: 'Horizontal · label beside',
  wordmark: 'Wordmark',
  icon: 'Icon',
};
export const logoUsageDefaults = () => ({ sidebar: 'horizontal', documents: 'complete', favicon: 'icon' });
export const logoVariantsDefaults = () =>
  Object.fromEntries(Object.keys(logoLayouts).map((key) => [key, { light: '', dark: '' }]));
export function validLogoImage(value) {
  return (
    value === '' ||
    (typeof value === 'string' &&
      value.length <= 350000 &&
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
  );
}
export function validateLogoVariants(input) {
  const result = logoVariantsDefaults();
  if (input === undefined) return result;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(logoLayouts, key))
  )
    throw Error('Invalid logo layouts.');
  for (const key of Object.keys(logoLayouts)) {
    const pair = input[key];
    if (pair === undefined) continue;
    if (
      !pair ||
      typeof pair !== 'object' ||
      Array.isArray(pair) ||
      Object.keys(pair).some((mode) => !['light', 'dark'].includes(mode))
    )
      throw Error('Invalid logo color variants.');
    for (const mode of ['light', 'dark']) {
      const image = pair[mode] === undefined ? '' : pair[mode];
      if (!validLogoImage(image)) throw Error('Choose a PNG or JPEG logo up to 250 KB after processing.');
      result[key][mode] = image;
    }
  }
  return result;
}
export function validateLogoUsage(input) {
  const result = { ...logoUsageDefaults(), ...input };
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw Error('Invalid logo usage.');
  for (const [key, layout] of Object.entries(result))
    if (!Object.hasOwn(logoUsageDefaults(), key) || !Object.hasOwn(logoLayouts, layout))
      throw Error('Choose a valid logo layout.');
  return result;
}
/** Prefer the requested background, then the legacy logo, then any available layout. */
export function resolveLogo(settings, usage = 'documents', background = 'light') {
  if (!settings || typeof settings === 'string') return '';
  const mode = background === 'dark' ? 'dark' : 'light';
  const opposite = mode === 'dark' ? 'light' : 'dark';
  const documentLayout =
    usage === 'roll'
      ? settings.receipt?.logoLayout
      : ['page', 'documents'].includes(usage)
        ? settings.receiptPage?.logoLayout
        : '';
  const layout =
    documentLayout ||
    settings.logoUsage?.[usage] ||
    (['roll', 'page'].includes(usage) ? settings.logoUsage?.documents : '') ||
    logoUsageDefaults()[usage] ||
    'complete';
  const variants = settings.logoVariants ?? {};
  const order = [...new Set([layout, 'complete', ...Object.keys(logoLayouts)])];
  for (const key of order) if (variants[key]?.[mode]) return variants[key][mode];
  if (settings.logo) return settings.logo;
  for (const key of order) if (variants[key]?.[opposite]) return variants[key][opposite];
  return '';
}
