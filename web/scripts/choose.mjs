/**
 * Choose in a typeable drop-down (SearchSelect): type the option's name and press Enter. The first
 * name that starts with what was typed is filled in, so the whole name picks exactly that option.
 */
export async function choose(scope, label, option) {
  const box = scope.getByRole('combobox', { name: label, exact: true });
  await box.click();
  await box.fill('');
  await box.pressSequentially(option);
  await box.press('Enter');
}
