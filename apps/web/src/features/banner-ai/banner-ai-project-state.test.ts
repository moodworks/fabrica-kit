import { describe, expect, it } from 'vitest';

import {
  isProviderFreeLayerIdV1,
  mutateProviderFreeBannerSceneV1,
} from '@fabrica/banner-ai/browser';

import {
  openInitialDemoProject,
  saveDemoProject,
} from '../../server/banner-ai/provider-free-demo-project';
import { captureAcceptedProviderFreeRevision } from './banner-ai-project-api';
import { bannerAiProjectReducer, initialBannerAiProjectState } from './banner-ai-project-state';

const readyState = (data: Awaited<ReturnType<typeof openInitialDemoProject>>, lifecycleId = 1) =>
  bannerAiProjectReducer(
    bannerAiProjectReducer(initialBannerAiProjectState, { type: 'open_started', lifecycleId }),
    { type: 'open_succeeded', lifecycleId, data, persistence: 'available' },
  );

describe('provider-free editor state', () => {
  it('opens the exact accepted revision with a separate clean draft', async () => {
    const data = await openInitialDemoProject();
    const state = bannerAiProjectReducer(
      bannerAiProjectReducer(initialBannerAiProjectState, {
        type: 'open_started',
        lifecycleId: 1,
      }),
      { type: 'open_succeeded', lifecycleId: 1, data, persistence: 'available' },
    );

    expect(state.opening).toBe('ready');
    expect(state.projectData?.project.currentAcceptedRevision).toBe(1);
    expect(state.draftScene).toEqual(data.project.revisions[0]!.scene);
    expect(state.draftStatus).toBe('clean');
  });

  it('preserves the accepted revision and dirty draft when saving fails', async () => {
    const data = await openInitialDemoProject();
    const ready = readyState(data);
    const draft = {
      ...ready.draftScene!,
      layers: ready.draftScene!.layers.map((layer, index) =>
        index === 0 ? { ...layer, visible: false } : layer,
      ),
    };
    const dirty = bannerAiProjectReducer(ready, {
      type: 'draft_changed',
      scene: draft,
      selectedPartId: data.project.revisions[0]!.scene.layers[0]!.id,
    });
    const saving = bannerAiProjectReducer(dirty, {
      type: 'save_started',
      lifecycleId: 1,
      operationId: 2,
    });
    const failed = bannerAiProjectReducer(saving, {
      type: 'save_failed',
      lifecycleId: 1,
      operationId: 2,
      persistence: 'unavailable',
      error: { code: 'PROJECT_STORAGE_WRITE_FAILED', message: 'Safe storage failure.' },
    });

    expect(failed.projectData).toBe(data);
    expect(failed.draftScene).toBe(draft);
    expect(failed.draftStatus).toBe('save-failed');
    expect(failed.persistence).toBe('unavailable');
  });

  it('suppresses duplicate operations and ignores stale completions', async () => {
    const data = await openInitialDemoProject();
    const ready = readyState(data);
    const capture = captureAcceptedProviderFreeRevision(data.project);
    const started = bannerAiProjectReducer(ready, {
      type: 'export_started',
      lifecycleId: 1,
      operationId: 10,
      capture,
    });
    const duplicate = bannerAiProjectReducer(started, {
      type: 'export_started',
      lifecycleId: 1,
      operationId: 11,
      capture,
    });
    const stale = bannerAiProjectReducer(duplicate, {
      type: 'export_failed',
      lifecycleId: 1,
      operationId: 9,
      error: { code: 'STALE', message: 'Safe stale failure.' },
    });

    expect(duplicate).toBe(started);
    expect(stale).toBe(started);
    expect(stale.export.capture?.sceneSha256).toBe(capture.sceneSha256);
  });

  it('retains the exact failed preview capture for same-digest retry', async () => {
    const data = await openInitialDemoProject();
    const capture = captureAcceptedProviderFreeRevision(data.project);
    const started = bannerAiProjectReducer(readyState(data), {
      type: 'preview_started',
      lifecycleId: 1,
      operationId: 3,
      capture,
      nonce: '0'.repeat(32),
    });
    const failed = bannerAiProjectReducer(started, {
      type: 'preview_failed',
      lifecycleId: 1,
      operationId: 3,
      error: { code: 'PREVIEW_FAILED', message: 'Safe preview failure.' },
    });

    expect(failed.preview.status).toBe('failed');
    expect(failed.preview.capture).toBe(capture);
    expect(failed.preview.capture?.sceneSha256).toBe(capture.sceneSha256);
    expect(failed.projectData).not.toBeNull();
  });

  it('clears output operations when a new accepted revision replaces their capture', async () => {
    const initial = await openInitialDemoProject();
    const layer = initial.project.revisions[0]!.scene.layers[0]!;
    if (!isProviderFreeLayerIdV1(layer.id)) throw new Error('Expected a fixed demo layer.');
    const changedScene = mutateProviderFreeBannerSceneV1(initial.project.revisions[0]!.scene, {
      type: 'set_layer_visible',
      layerId: layer.id,
      visible: false,
    });
    const accepted = await saveDemoProject({
      project: initial.project,
      scene: changedScene,
      selectedPartId: layer.id,
    });
    const capture = captureAcceptedProviderFreeRevision(initial.project);
    const dirty = bannerAiProjectReducer(readyState(initial), {
      type: 'draft_changed',
      scene: changedScene,
      selectedPartId: layer.id,
    });
    const previewing = bannerAiProjectReducer(dirty, {
      type: 'preview_started',
      lifecycleId: 1,
      operationId: 4,
      capture,
      nonce: '2'.repeat(32),
    });
    const exporting = bannerAiProjectReducer(previewing, {
      type: 'export_started',
      lifecycleId: 1,
      operationId: 5,
      capture,
    });
    const saving = bannerAiProjectReducer(exporting, {
      type: 'save_started',
      lifecycleId: 1,
      operationId: 6,
    });
    const saved = bannerAiProjectReducer(saving, {
      type: 'save_succeeded',
      lifecycleId: 1,
      operationId: 6,
      data: accepted,
      persistence: 'available',
    });

    expect(saved.projectData?.project.currentAcceptedRevision).toBe(2);
    expect(saved.preview.status).toBe('not-requested');
    expect(saved.export.status).toBe('not-requested');
  });

  it('invalidates delayed save, preview, and export completions across a reset lifecycle', async () => {
    const initial = await openInitialDemoProject();
    const layer = initial.project.revisions[0]!.scene.layers[0]!;
    if (!isProviderFreeLayerIdV1(layer.id)) throw new Error('Expected a fixed demo layer.');
    const changedScene = mutateProviderFreeBannerSceneV1(initial.project.revisions[0]!.scene, {
      type: 'set_layer_visible',
      layerId: layer.id,
      visible: false,
    });
    const delayedSaveData = await saveDemoProject({
      project: initial.project,
      scene: changedScene,
      selectedPartId: layer.id,
    });
    const capture = captureAcceptedProviderFreeRevision(initial.project);
    const dirty = bannerAiProjectReducer(readyState(initial), {
      type: 'draft_changed',
      scene: changedScene,
      selectedPartId: layer.id,
    });
    const saving = bannerAiProjectReducer(dirty, {
      type: 'save_started',
      lifecycleId: 1,
      operationId: 10,
    });
    const previewing = bannerAiProjectReducer(saving, {
      type: 'preview_started',
      lifecycleId: 1,
      operationId: 11,
      capture,
      nonce: '1'.repeat(32),
    });
    const exporting = bannerAiProjectReducer(previewing, {
      type: 'export_started',
      lifecycleId: 1,
      operationId: 12,
      capture,
    });
    const resetReady = bannerAiProjectReducer(
      bannerAiProjectReducer(exporting, { type: 'open_started', lifecycleId: 2 }),
      { type: 'open_succeeded', lifecycleId: 2, data: initial, persistence: 'available' },
    );

    const afterStaleSave = bannerAiProjectReducer(resetReady, {
      type: 'save_succeeded',
      lifecycleId: 1,
      operationId: 10,
      data: delayedSaveData,
      persistence: 'available',
    });
    const afterStalePreview = bannerAiProjectReducer(afterStaleSave, {
      type: 'preview_document_ready',
      lifecycleId: 1,
      operationId: 11,
      iframeSrc: 'blob:https://local.invalid/stale',
      sceneSha256: capture.sceneSha256,
    });
    const afterStaleExport = bannerAiProjectReducer(afterStalePreview, {
      type: 'export_failed',
      lifecycleId: 1,
      operationId: 12,
      error: { code: 'STALE', message: 'A stale completion must be ignored.' },
    });

    expect(afterStaleSave).toBe(resetReady);
    expect(afterStalePreview).toBe(resetReady);
    expect(afterStaleExport).toBe(resetReady);
    expect(afterStaleExport.projectData?.project.currentAcceptedRevision).toBe(1);
    expect(afterStaleExport.preview.status).toBe('not-requested');
    expect(afterStaleExport.export.status).toBe('not-requested');
  });
});
