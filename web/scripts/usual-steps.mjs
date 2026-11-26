import { settingsSection } from './settings-navigation.mjs';
import { choose } from './choose.mjs';
/**
 * New businesses follow Added → Processing → Completed → Collected. Checks that move jobs through
 * several stages first save a workflow with these steps as the usual one.
 */
export async function useUsualSteps(page, nav, steps = ['In Queue', 'Printing'], name = 'Production') {
  await nav('Business Settings');
  await settingsSection(page, /Dropdowns & workflow/);
  // The settings load just after the app opens: until then the section's fields are disabled and a
  // click does nothing, so wait for the button to be usable, and click again if no window appears.
  const add = page.getByRole('button', { name: 'Add workflow', exact: true });
  const d = page.getByRole('dialog', { name: 'Add workflow' });
  for (let i = 0; i < 20 && !(await d.isVisible()); i++) {
    if (await add.isEnabled()) await add.click();
    await d.waitFor({ timeout: 2000 }).catch(() => {});
  }
  await d.getByLabel('Workflow name', { exact: true }).fill(name);
  for (let i = 2; i < steps.length; i++)
    await d.getByRole('button', { name: 'Add step', exact: true }).last().click();
  for (const [i, step] of steps.entries())
    await d.getByLabel(`${name}: step ${i + 1} name`, { exact: true }).fill(step);
  await d.getByRole('button', { name: 'Save steps', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await choose(page, 'Usual steps', name);
  await page.getByRole('button', { name: 'Save dropdown settings', exact: true }).click();
  await page.getByText('Dropdown settings saved.', { exact: true }).waitFor();
}
