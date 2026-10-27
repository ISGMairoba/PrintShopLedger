export function validDocumentTerms(value = '') {
  if (typeof value !== 'string' || value.length > 5000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw Error('Terms and conditions must be text, up to 5,000 characters.');
  return value.trim();
}
