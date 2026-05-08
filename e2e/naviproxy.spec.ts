import { expect, test } from '@playwright/test';

test('creates an app and opens the admin detail panel', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'NaviProxy' })).toBeVisible();
  const diagnosticsLoaded = page.waitForResponse(
    (response) =>
      response.url().includes('/api/proxy/diagnostics') && response.ok()
  );
  await page.getByRole('button', { name: 'Add app' }).first().click();
  await diagnosticsLoaded;
  await expect(
    page.getByRole('heading', { name: 'Services', exact: true })
  ).toBeVisible();

  await page.getByLabel('App name').fill('E2E Service');
  await page.getByLabel('LAN target URL').fill('http://127.0.0.1:3925');
  await page.getByLabel('Public host').fill('e2e.lab.home');
  await page.getByLabel('Category').fill('Testing');
  await page.getByLabel('Tags').fill('e2e, smoke');
  await page.getByRole('button', { name: 'Save app' }).click();

  await expect(
    page.getByRole('heading', { name: 'E2E Service' }).first()
  ).toBeVisible();
  await expect(page.getByText('1 configured')).toBeVisible();

  await page.getByRole('button', { name: 'App details' }).click();
  await expect(page.locator('h3').filter({ hasText: 'E2E Service' })).toBeVisible();
  await expect(page.getByText('e2e.lab.home').nth(1)).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:3925').nth(1)).toBeVisible();
});
