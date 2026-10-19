// Choose from a type-to-search drop-down (src/SearchSelect.tsx) the way a person does: open it,
// then click an option. choice: { index } (position in the open list), { label } (exact text),
// { text } (contains), or a value (string).
export async function pick(scope, label, choice) {
  const box = scope.getByRole('combobox', { name: label, exact: true });
  await box.click();
  const list = box.locator('xpath=ancestor::div[contains(@class,"search-select")][1]').getByRole('option');
  const option =
    typeof choice === 'string'
      ? list.and(box.page().locator(`[data-value="${choice}"]`))
      : choice.index !== undefined
        ? list.nth(choice.index)
        : choice.label !== undefined
          ? list.filter({ has: box.page().getByText(choice.label, { exact: true }) })
          : list.filter({ hasText: choice.text });
  await option.first().click();
}
/** The value chosen in a type-to-search drop-down. */
export const pickedValue = (scope, label) =>
  scope.getByRole('combobox', { name: label, exact: true }).getAttribute('data-value');
/** The option texts a type-to-search drop-down offers (opens it, reads, closes it). */
export async function pickOptions(scope, label) {
  const box = scope.getByRole('combobox', { name: label, exact: true });
  await box.click();
  const texts = await box
    .locator('xpath=ancestor::div[contains(@class,"search-select")][1]')
    .getByRole('option')
    .allInnerTexts();
  await box.press('Escape');
  return texts;
}
