import { settingsSection } from './settings-navigation.mjs';
/**
 * New businesses follow Added → Processing → Completed → Collected. Checks that move jobs through
 * several stages first save a workflow with these steps as the usual one.
 */
export async function useUsualSteps(page, nav, steps = ['In Queue', 'Printing'], name = 'Production') {
  await nav('Business Settings');
  await settingsSection(page, /Dropdowns & workflow/);
  await page.getByRole('button', { name: 'Add workflow', exact: true }).click();
  await page.getByLabel('Workflow 1 name', { exact: true }).fill(name);
  for (let i = 2; i < steps.length; i++)
    await page.getByRole('button', { name: 'Add step', exact: true }).last().click();
  for (const [i, step] of steps.entries())
    await page.getByLabel(`${name}: step ${i + 1} name`, { exact: true }).fill(step);
  await page.getByLabel('Usual steps', { exact: true }).selectOption({ label: name });
  await page.getByRole('button', { name: 'Save dropdown settings', exact: true }).click();
  await page.getByText('Dropdown settings saved.', { exact: true }).waitFor();
}
