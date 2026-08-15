import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const storageKey = 'fabrica.banner-ai.verified-sam-replay-project.v1';
const fixture = resolve(
  import.meta.dirname,
  '../../../packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
);

test('uploads, selects a candidate, edits, previews, and exports without external requests', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const host = url.hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') externalRequests.push(request.url());
    }
  });

  await page.goto('/banner-ai');
  await page.locator('#banner-file').setInputFiles(fixture);
  await expect(
    page.locator('#banner-file-status').getByText('banner-no-text-v1.png'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Generate verified Samsung cutouts' }).click();
  await expect(page.getByText('Choose a cutout to edit')).toBeVisible();
  await expect(page.getByText('Deterministic test output — NOT SAM OUTPUT')).toBeVisible();
  const candidates = page.locator('section[aria-labelledby="uploaded-candidates-title"] a');
  await expect(candidates).toHaveCount(3);
  await candidates.nth(1).click();

  await expect(page.getByRole('heading', { name: 'Uploaded banner candidate' })).toBeVisible();
  await expect(page.locator('.editor-layer-name', { hasText: 'Uploaded cutout' })).toBeVisible();
  await expect(page.getByText('738 × 255')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();

  await page.getByRole('radio', { name: /Uploaded cutout/u }).check();
  await page.getByRole('button', { name: 'Apply Gentle float' }).click();
  await page.getByRole('button', { name: 'Save animation changes' }).click();
  await expect(page.getByText('Accepted in this temporary operation.')).toBeVisible();
  await page.getByRole('button', { name: 'Preview accepted scene' }).click();
  await expect(page.getByText('The isolated preview completed.')).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate HTML5 ZIP' }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(
    /^uploaded-deterministic-test-r2-[0-9a-f]{12}\.zip$/u,
  );
  expect(externalRequests).toEqual([]);
});
