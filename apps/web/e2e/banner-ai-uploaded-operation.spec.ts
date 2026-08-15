import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const storageKey = 'fabrica.banner-ai.verified-sam-replay-project.v1';
const fixture = resolve(
  import.meta.dirname,
  '../../../packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
);

test('uploads, marquee-selects two layers, edits, previews, and exports without external requests', async ({
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
  await expect(page.getByText('Select cutout layers')).toBeVisible();
  await expect(page.getByText('Deterministic test output — NOT SAM OUTPUT')).toBeVisible();
  const candidates = page.locator(
    'section[aria-labelledby="uploaded-candidates-title"] input[type="checkbox"]',
  );
  await expect(candidates).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Continue with selected layers' })).toBeDisabled();
  const stage = page.locator('.candidate-composer-stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  if (box === null) throw new Error('candidate stage is not visible');
  await page.mouse.move(box.x + box.width * 0.01, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.95);
  await page.mouse.up();
  await expect(candidates.nth(0)).toBeChecked();
  await expect(candidates.nth(1)).toBeChecked();
  await expect(candidates.nth(2)).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Candidate 1' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Candidate 2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await candidates.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(candidates.nth(0)).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(candidates.nth(0)).toBeChecked();
  await page.getByRole('button', { name: 'Continue with selected layers' }).click();

  await expect(page.getByRole('heading', { name: 'Uploaded layer selection' })).toBeVisible();
  await expect(page.locator('.editor-layer-name', { hasText: 'Uploaded cutout' })).toHaveCount(2);
  await expect(page.getByText(/Separate uploaded cutout layers/)).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();

  const layerRows = page.getByRole('radio', { name: /Uploaded cutout/u });
  await expect(layerRows).toHaveCount(2);
  await layerRows.nth(0).check();
  await page.getByRole('button', { name: 'Apply Gentle float' }).click();
  await layerRows.nth(1).check();
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
