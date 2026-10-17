/** Select the same settings section through desktop tabs or the mobile picker. */
export async function settingsSection(page, name) {
  const picker = page.getByLabel('Business settings section', { exact: true });
  if (await picker.isVisible()) {
    const choices = await picker.locator('option').evaluateAll((options) =>
      options.map((option) => ({
        value: option.value,
        label: option.textContent.replace(' •', '').trim(),
      })),
    );
    const choice = choices.find((option) =>
      typeof name === 'string' ? option.label === name : name.test(option.label),
    );
    if (!choice) throw Error(`Settings section not available: ${name}`);
    await picker.selectOption(choice.value);
  } else await page.getByRole('tab', { name, exact: typeof name === 'string' }).click();
}
