// Business Settings → Page access → Business type: Print shop, Retail shop, or Both. The type sets
// which parts of the app show; each part can then be turned on or off on its own (a retail shop
// that prices some items with templates turns Pricing Templates back on). Only Developer can
// change it (the server lets other ranks save only their tabs' settings).

export const businessTypes = /** @type {const} */ ([
  ['both', 'Print shop and retail'],
  ['print', 'Print shop'],
  ['retail', 'Retail shop (sells products off the shelf)'],
]);

/** The parts that can be turned off, with what they cover. */
export const optionalFeatures = /** @type {const} */ ([
  ['Jobs', 'Jobs and production: Add job on Point of Service, stages, the Jobs page'],
  ['Services', 'Services: work done to order, and linking items to stock'],
  ['Pricing Templates', 'Pricing Templates: prices worked out with formulas'],
  ['Quotations', 'Quotations'],
  ['Print Settings', 'Print Settings: printers and print layouts'],
]);

/** Which parts a type shows before any are changed. */
export function typeFeatures(type) {
  const on = type !== 'retail';
  return Object.fromEntries(optionalFeatures.map(([page]) => [page, on]));
}

/** Whether a part of the app shows for this business. */
export function featureOn(settings, page) {
  if (!optionalFeatures.some(([p]) => p === page)) return true;
  const set = settings?.features?.[page];
  return typeof set === 'boolean' ? set : typeFeatures(settings?.businessType)[page];
}

export function validateBusinessType(value) {
  const type = value.businessType ?? 'both';
  if (!businessTypes.some(([t]) => t === type)) throw Error('Choose a business type.');
  const features = value.features ?? {};
  if (
    !features ||
    typeof features !== 'object' ||
    Array.isArray(features) ||
    Object.entries(features).some(
      ([key, on]) => !optionalFeatures.some(([p]) => p === key) || typeof on !== 'boolean',
    )
  )
    throw Error('Invalid business type settings.');
  return { businessType: type, features: { ...features } };
}
