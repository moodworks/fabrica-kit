import { createHash } from 'node:crypto';

import { expect, test, type Download, type Locator, type Page } from '@playwright/test';

const applicationOrigin = 'http://127.0.0.1:3102';
const storageKey = 'fabrica.banner-ai.verified-sam-replay-project.v1';

const readDownload = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream();
  if (stream === null) throw new Error('The local ZIP download stream was unavailable.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const activateWithKeyboard = async (page: Page, locator: Locator) => {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
};

test('open → edit → preset → save → preview → export → validate → reload → injected failure → retry', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const saveBodies: unknown[] = [];
  const openCandidateBodies: unknown[] = [];
  const exportBodies: unknown[] = [];
  const observedDownloads: Download[] = [];

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    const trackedWindow = window as typeof window & { __providerFreeBlobUrlCount?: number };
    trackedWindow.__providerFreeBlobUrlCount = 0;
    URL.createObjectURL = (value: Blob | MediaSource): string => {
      trackedWindow.__providerFreeBlobUrlCount =
        (trackedWindow.__providerFreeBlobUrlCount ?? 0) + 1;
      return original(value);
    };
  });
  page.on('download', (download) => observedDownloads.push(download));
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') &&
      requestUrl.origin !== applicationOrigin
    ) {
      externalRequests.push(requestUrl.href);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON() as unknown;
    if (
      path === '/api/banner-ai/demo-project' &&
      body &&
      typeof body === 'object' &&
      (body as { action?: unknown }).action === 'save'
    )
      saveBodies.push(body);
    if (
      path === '/api/banner-ai/demo-project' &&
      body &&
      typeof body === 'object' &&
      (body as { action?: unknown }).action === 'open-candidate'
    )
      openCandidateBodies.push(body);
    if (path === '/api/banner-ai/demo-project/export') exportBodies.push(body);
  });

  await page.goto('/banner-ai/editor');
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  const openButton = page.getByRole('button', { name: 'Open approved demo project' });
  await activateWithKeyboard(page, openButton);
  await expect(page.getByRole('radio')).toHaveCount(8);
  await page.getByRole('radio').nth(0).check();
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Open selected candidate' }));
  await expect(
    page.getByRole('heading', { name: 'Development-only verified Meta SAM replay' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Development-only verified Meta SAM replay; automatic candidate 1, manually selected.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Source banner', { exact: true })).toBeVisible();
  await expect(page.getByText('Reference only', { exact: false })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Source banner reference' })).toBeVisible();
  expect(openCandidateBodies).toHaveLength(1);
  expect((openCandidateBodies[0] as { candidateId: string }).candidateId).toMatch(
    /^samc_v1_[0-9a-f]{64}$/u,
  );

  const layerRows = page.locator('.editor-layer-row');
  await expect(layerRows).toHaveCount(2);
  await expect(layerRows.locator('.editor-layer-name')).toHaveText([
    'Solid background',
    'banner-person-v1 subject',
  ]);
  const revisionOneSubject = await page.evaluate(() => {
    const project = JSON.parse(
      localStorage.getItem('fabrica.banner-ai.verified-sam-replay-project.v1')!,
    );
    return project.revisions[0].scene.layers[0];
  });
  expect(revisionOneSubject.asset.sha256).toBe(
    'efa97f238a11d55d31e0438887bddece3de757f2b4abf117c8f1895553977022',
  );
  expect(revisionOneSubject.frame).toEqual({ x: 258, y: 0, width: 42, height: 69 });
  const thumbnailState = await layerRows.locator('img').evaluateAll((images) =>
    images.map((image) => ({
      complete: (image as HTMLImageElement).complete,
      height: (image as HTMLImageElement).naturalHeight,
      source: (image as HTMLImageElement).currentSrc,
      width: (image as HTMLImageElement).naturalWidth,
    })),
  );
  expect(thumbnailState).toHaveLength(2);
  expect(
    thumbnailState.every(
      (thumbnail) =>
        thumbnail.complete &&
        thumbnail.width > 0 &&
        thumbnail.height > 0 &&
        thumbnail.source.startsWith('data:image/png;base64,'),
    ),
  ).toBe(true);

  const subjectRadio = page.getByRole('radio', { name: /^banner-person-v1 subject/u });
  await subjectRadio.focus();
  await expect(subjectRadio).toBeFocused();
  const focusedOutline = await subjectRadio.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(focusedOutline).not.toBe('none');
  await page.keyboard.press('Space');
  await expect(subjectRadio).toBeChecked();

  const showSubject = page.getByRole('checkbox', { name: 'Show banner-person-v1 subject' });
  await showSubject.focus();
  await page.keyboard.press('Space');
  await expect(showSubject).not.toBeChecked();

  const includeSubject = page.getByRole('checkbox', { name: 'Include banner-person-v1 subject' });
  await includeSubject.focus();
  await page.keyboard.press('Space');
  await expect(includeSubject).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(includeSubject).toBeChecked();

  await activateWithKeyboard(page, page.getByRole('button', { name: 'Apply Gentle float' }));
  await expect(page.getByText('applied here', { exact: false })).toBeVisible();
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Save changes' }));
  await expect(page.getByRole('heading', { name: 'Accepted revision 2' })).toBeVisible();
  await expect(page.getByText('Saved locally and accepted.', { exact: false })).toBeVisible();

  const acceptedDigest = (await page
    .locator('.editor-revision-strip .digest')
    .textContent())!.trim();
  expect(acceptedDigest).toMatch(/^[0-9a-f]{64}$/u);
  expect(saveBodies).toHaveLength(1);
  const saveBody = saveBodies[0] as {
    readonly action: string;
    readonly scene: {
      readonly layers: readonly {
        readonly id: string;
        readonly name: string;
        readonly included: boolean;
        readonly visible: boolean;
      }[];
      readonly timeline: readonly {
        readonly targetLayerId: string;
        readonly preset: { readonly kind: string; readonly distancePx: number };
      }[];
    };
    readonly selectedPartId: string;
  };
  const savedSubject = saveBody.scene.layers.find(
    (layer) => layer.name === 'banner-person-v1 subject',
  )!;
  expect(saveBody.action).toBe('save');
  expect(saveBody.selectedPartId).toBe(savedSubject.id);
  expect(savedSubject).toMatchObject({ included: true, visible: false });
  expect(saveBody.scene.timeline).toEqual([
    expect.objectContaining({
      targetLayerId: savedSubject.id,
      preset: expect.objectContaining({ kind: 'float', distancePx: -6 }),
    }),
  ]);

  const stored = await page.evaluate((key) => localStorage.getItem(key), storageKey);
  expect(stored).not.toBeNull();
  const storedProject = JSON.parse(stored!) as {
    readonly fixtureId: string;
    readonly projectId: string;
    readonly currentAcceptedRevision: number;
    readonly selectedPartId: string;
    readonly revisions: readonly {
      readonly sceneSha256: string;
      readonly sceneVersionId: string;
      readonly parentSceneSha256: string | null;
    }[];
  };
  expect(storedProject).toMatchObject({
    fixtureId: 'banner-person-sam-replay-v1',
    projectId: '2a000000-0000-5000-8000-000000000001',
    currentAcceptedRevision: 2,
    selectedPartId: savedSubject.id,
  });
  expect(storedProject.revisions[1]!.sceneSha256).toBe(acceptedDigest);
  expect(storedProject.revisions[1]!.parentSceneSha256).toBe(
    storedProject.revisions[0]!.sceneSha256,
  );
  expect(storedProject.revisions[1]!.sceneVersionId).not.toBe(
    storedProject.revisions[0]!.sceneVersionId,
  );

  const previewButton = page.getByRole('button', { name: 'Preview accepted scene' });
  await activateWithKeyboard(page, previewButton);
  const iframe = page.locator(
    'iframe[title="Development-only verified Meta SAM replay isolated preview"]',
  );
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).not.toHaveAttribute('allow-same-origin', /.*/u);
  await expect(page.getByText('The isolated preview completed.')).toBeVisible();
  const previewFrame = page.frames().find((frame) => frame !== page.mainFrame());
  expect(previewFrame).toBeDefined();
  expect(
    await previewFrame!.evaluate(() => {
      let parentDocumentDenied = false;
      let originStorageErrorName: string | null = null;
      try {
        void window.parent.document;
      } catch {
        parentDocumentDenied = true;
      }
      try {
        void window.localStorage.length;
      } catch (error) {
        originStorageErrorName = error instanceof DOMException ? error.name : null;
      }
      return { originStorageErrorName, parentDocumentDenied };
    }),
  ).toEqual({ originStorageErrorName: 'SecurityError', parentDocumentDenied: true });
  expect(
    await previewFrame!
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content'),
  ).toBe(
    "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  );
  const editorUrl = page.url();
  const exitControl = previewFrame!.getByRole('button', { name: 'Report preview exit' });
  await exitControl.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Preview exit was intercepted.', { exact: false })).toBeVisible();
  expect(page.url()).toBe(editorUrl);

  const firstDownloadPromise = page.waitForEvent('download');
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Generate HTML5 ZIP' }));
  const firstDownload = await firstDownloadPromise;
  const firstZip = await readDownload(firstDownload);
  await expect(page.getByRole('heading', { name: 'Internal checks passed' })).toBeVisible();
  await expect(
    page.getByText('internal, provider-free, and not GDN certification', { exact: false }),
  ).toBeVisible();
  const firstArtifactSha = (await page
    .locator('.banner-export-identities dd.digest')
    .last()
    .textContent())!.trim();
  expect(createHash('sha256').update(firstZip).digest('hex')).toBe(firstArtifactSha);
  expect(firstDownload.suggestedFilename()).toMatch(
    /^verified-meta-sam-replay-r2-[0-9a-f]{12}\.zip$/u,
  );

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Development-only verified Meta SAM replay' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Accepted revision 2' })).toBeVisible();
  await expect(page.locator('.editor-revision-strip .digest')).toHaveText(acceptedDigest);
  await expect(page.getByRole('radio', { name: /^banner-person-v1 subject/u })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Include banner-person-v1 subject' }),
  ).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Show banner-person-v1 subject' }),
  ).not.toBeChecked();
  await expect(page.getByText('applied here', { exact: false })).toBeVisible();

  let injectedBody: unknown = null;
  await page.route('**/api/banner-ai/demo-project/export', async (route) => {
    injectedBody = route.request().postDataJSON() as unknown;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: {
          code: 'SYNTHETIC_EXPORT_FAILURE',
          message: 'The injected local export failure preserved the accepted scene.',
        },
      }),
    });
  });
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Generate HTML5 ZIP' }));
  await expect(page.getByText('Export failed')).toBeVisible();
  await expect(page.locator('.editor-revision-strip .digest')).toHaveText(acceptedDigest);
  await expect(page.getByRole('radio', { name: /^banner-person-v1 subject/u })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Show banner-person-v1 subject' }),
  ).not.toBeChecked();

  await page.unroute('**/api/banner-ai/demo-project/export');
  const retryDownloadPromise = page.waitForEvent('download');
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Retry same scene digest' }));
  const retryDownload = await retryDownloadPromise;
  const retryZip = await readDownload(retryDownload);
  await expect(page.getByRole('heading', { name: 'Internal checks passed' })).toBeVisible();
  const retryArtifactSha = (await page
    .locator('.banner-export-identities dd.digest')
    .last()
    .textContent())!.trim();
  expect(retryZip).toEqual(firstZip);
  expect(retryArtifactSha).toBe(firstArtifactSha);

  const retryBody = exportBodies.at(-1) as {
    readonly sceneSha256: string;
    readonly sceneVersionId: string;
  };
  const failedBody = injectedBody as {
    readonly sceneSha256: string;
    readonly sceneVersionId: string;
  };
  expect(retryBody.sceneSha256).toBe(failedBody.sceneSha256);
  expect(retryBody.sceneVersionId).toBe(failedBody.sceneVersionId);
  expect(retryBody.sceneSha256).toBe(acceptedDigest);

  const subjectVisibility = page.getByRole('checkbox', { name: 'Show banner-person-v1 subject' });
  await subjectVisibility.focus();
  await page.keyboard.press('Space');
  await expect(subjectVisibility).toBeChecked();

  let releaseDelayedSave!: () => void;
  const delayedSaveGate = new Promise<void>((resolve) => {
    releaseDelayedSave = resolve;
  });
  let observeDelayedSave!: () => void;
  const delayedSaveObserved = new Promise<void>((resolve) => {
    observeDelayedSave = resolve;
  });
  await page.route('**/api/banner-ai/demo-project', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { action?: unknown } | null;
    if (body?.action !== 'save') {
      await route.continue();
      return;
    }
    observeDelayedSave();
    await delayedSaveGate;
    await route.continue();
  });
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Save changes' }));
  await delayedSaveObserved;
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Reset demo project' }));
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Confirm demo reset' }));
  await expect(page.getByRole('heading', { name: 'Accepted revision 1' })).toBeVisible();
  const delayedSaveResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/banner-ai/demo-project' &&
      response.request().method() === 'POST' &&
      (response.request().postDataJSON() as { action?: unknown }).action === 'save',
  );
  releaseDelayedSave();
  await delayedSaveResponse;
  await expect
    .poll(async () => {
      const value = await page.evaluate((key) => localStorage.getItem(key), storageKey);
      return value === null
        ? null
        : (JSON.parse(value) as { readonly currentAcceptedRevision: number })
            .currentAcceptedRevision;
    })
    .toBe(1);
  await expect(page.getByRole('heading', { name: 'Accepted revision 1' })).toBeVisible();
  await page.unroute('**/api/banner-ai/demo-project');

  let releaseDelayedPreview!: () => void;
  const delayedPreviewGate = new Promise<void>((resolve) => {
    releaseDelayedPreview = resolve;
  });
  let observeDelayedPreview!: () => void;
  const delayedPreviewObserved = new Promise<void>((resolve) => {
    observeDelayedPreview = resolve;
  });
  let releaseReplacementPreview!: () => void;
  const replacementPreviewGate = new Promise<void>((resolve) => {
    releaseReplacementPreview = resolve;
  });
  let observeReplacementPreview!: () => void;
  const replacementPreviewObserved = new Promise<void>((resolve) => {
    observeReplacementPreview = resolve;
  });
  let previewRequestCount = 0;
  await page.route('**/api/banner-ai/demo-project/preview', async (route) => {
    previewRequestCount += 1;
    if (previewRequestCount === 1) {
      observeDelayedPreview();
      await delayedPreviewGate;
    } else {
      observeReplacementPreview();
      await replacementPreviewGate;
    }
    await route.continue();
  });
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Preview accepted scene' }));
  await delayedPreviewObserved;
  const blobCountBeforeStalePreview = await page.evaluate(
    () =>
      (window as typeof window & { __providerFreeBlobUrlCount?: number })
        .__providerFreeBlobUrlCount ?? 0,
  );
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Reset demo project' }));
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Confirm demo reset' }));
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Preview accepted scene' }));
  await replacementPreviewObserved;
  const delayedPreviewResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/banner-ai/demo-project/preview',
  );
  releaseDelayedPreview();
  await delayedPreviewResponse;
  await expect(page.locator('iframe[title$="isolated preview"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __providerFreeBlobUrlCount?: number })
          .__providerFreeBlobUrlCount ?? 0,
    ),
  ).toBe(blobCountBeforeStalePreview);
  const replacementPreviewResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/banner-ai/demo-project/preview',
  );
  releaseReplacementPreview();
  await replacementPreviewResponse;
  await expect(page.getByText('The isolated preview completed.')).toBeVisible();
  await expect(page.locator('iframe[title$="isolated preview"]')).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __providerFreeBlobUrlCount?: number })
          .__providerFreeBlobUrlCount ?? 0,
    ),
  ).toBe(blobCountBeforeStalePreview + 1);
  await page.unroute('**/api/banner-ai/demo-project/preview');

  let releaseDelayedExport!: () => void;
  const delayedExportGate = new Promise<void>((resolve) => {
    releaseDelayedExport = resolve;
  });
  let observeDelayedExport!: () => void;
  const delayedExportObserved = new Promise<void>((resolve) => {
    observeDelayedExport = resolve;
  });
  await page.route('**/api/banner-ai/demo-project/export', async (route) => {
    observeDelayedExport();
    await delayedExportGate;
    await route.continue();
  });
  const downloadCountBeforeStaleExport = observedDownloads.length;
  const blobCountBeforeStaleExport = await page.evaluate(
    () =>
      (window as typeof window & { __providerFreeBlobUrlCount?: number })
        .__providerFreeBlobUrlCount ?? 0,
  );
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Generate HTML5 ZIP' }));
  await delayedExportObserved;
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Reset demo project' }));
  await activateWithKeyboard(page, page.getByRole('button', { name: 'Confirm demo reset' }));
  const delayedExportResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/banner-ai/demo-project/export',
  );
  releaseDelayedExport();
  await delayedExportResponse;
  await expect(page.getByRole('heading', { name: 'Accepted revision 1' })).toBeVisible();
  expect(observedDownloads).toHaveLength(downloadCountBeforeStaleExport);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __providerFreeBlobUrlCount?: number })
          .__providerFreeBlobUrlCount ?? 0,
    ),
  ).toBe(blobCountBeforeStaleExport);
  await page.unroute('**/api/banner-ai/demo-project/export');

  const resetButton = page.getByRole('button', { name: 'Reset demo project' });
  await resetButton.focus();
  await expect(resetButton).toBeFocused();
  await expect(resetButton).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole('button', { name: /Preview (?:accepted scene|again)/u }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate HTML5 ZIP' })).toBeVisible();

  expect(externalRequests).toEqual([]);
});
