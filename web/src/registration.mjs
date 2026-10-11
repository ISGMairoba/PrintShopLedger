export function validateBusinessRegistration(input) {
  const businessName = String(input.businessName ?? '').trim(),
    ownerName = String(input.ownerName ?? '').trim();
  if (!businessName || businessName.length > 160)
    throw Error('Enter a business name of up to 160 characters.');
  if (!ownerName || ownerName.length > 160)
    throw Error('Enter the owner’s full name (up to 160 characters).');
  return { businessName, ownerName };
}
export function validateSignup(input) {
  const profile = validateBusinessRegistration(input),
    email = String(input.email ?? '')
      .trim()
      .toLowerCase(),
    password = String(input.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw Error('Enter a valid email address.');
  validateNewPassword(password, input.confirmPassword);
  return { ...profile, email, password };
}
export function validateNewPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw Error('Use a password with 12–128 characters.');
  if (confirmation !== undefined && password !== confirmation) throw Error('The passwords do not match.');
  return password;
}
export const validActivationToken = (token) => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
export function developerActivationEmail(row) {
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  return {
    subject: 'PrintShopLedger: new business Developer access',
    text: `Business: ${row.business_name}\nBusiness ID: ${row.shop_id}\nBusiness email: ${row.owner_email}\nDeveloper username: developer\n\nSet this business’s Developer password:\n${row.activation_url}\n\nThis single-use link expires in seven days. Sign in to the business first, then use the Developer staff account.`,
    html: `<p>A business registered with PrintShopLedger.</p><p>Business: <strong>${escape(row.business_name)}</strong><br>Business ID: ${escape(row.shop_id)}<br>Business email: ${escape(row.owner_email)}<br>Developer username: <strong>developer</strong></p><p><a href="${escape(row.activation_url)}">Set the Developer password</a></p><p>This single-use link expires in seven days. Sign in to the business first, then use the Developer staff account.</p>`,
  };
}
