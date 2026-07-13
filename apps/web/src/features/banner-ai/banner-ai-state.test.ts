import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import type { BannerAnalysisData } from './banner-ai-contract';
import {
  bannerAiReducer,
  getBannerAiUploadControlCopy,
  initialBannerAiState,
  type BannerAiState,
  type SelectedBannerUpload,
} from './banner-ai-state';

const selection: SelectedBannerUpload = {
  filename: 'angel.png',
  mediaType: 'image/png',
  originalByteSize: 123,
  previewUrl: 'blob:angel',
  width: 300,
  height: 250,
};

const selectedState = (
  selected: SelectedBannerUpload = selection,
  requestRevision = 1,
): BannerAiState => {
  const validating = bannerAiReducer(initialBannerAiState, {
    type: 'selection_started',
    requestRevision,
  });
  return bannerAiReducer(validating, {
    type: 'selection_succeeded',
    requestRevision,
    selection: selected,
  });
};

const succeededState = (
  result: BannerAnalysisData = sampleBannerAnalysisData,
  selected: SelectedBannerUpload = selection,
): BannerAiState => {
  const ready = selectedState(selected, 1);
  const running = bannerAiReducer(ready, { type: 'analysis_started', requestRevision: 2 });
  return bannerAiReducer(running, {
    type: 'analysis_succeeded',
    requestRevision: 2,
    result,
  });
};

describe('Banner AI client state', () => {
  it('derives accurate upload-control copy from application state', () => {
    expect(getBannerAiUploadControlCopy(initialBannerAiState)).toEqual({
      kind: 'status',
      text: 'No image selected',
    });

    const validating = bannerAiReducer(initialBannerAiState, {
      type: 'selection_started',
      requestRevision: 1,
    });
    expect(getBannerAiUploadControlCopy(validating)).toEqual({
      kind: 'status',
      text: 'Validating selected image…',
    });

    const selected = bannerAiReducer(validating, {
      type: 'selection_succeeded',
      requestRevision: 1,
      selection: { ...selection, filename: 'إعلان.png' },
    });
    expect(getBannerAiUploadControlCopy(selected)).toEqual({
      kind: 'filename',
      text: 'إعلان.png',
    });

    const invalidStart = bannerAiReducer(initialBannerAiState, {
      type: 'selection_started',
      requestRevision: 2,
    });
    const invalid = bannerAiReducer(invalidStart, {
      type: 'selection_failed',
      requestRevision: 2,
      message: 'Unsupported image.',
    });
    expect(getBannerAiUploadControlCopy(invalid)).toEqual({
      kind: 'status',
      text: 'No valid image selected',
    });
  });

  it('moves through the request phases and initializes review state only on success', () => {
    const phases: BannerAiState['phase'][] = [initialBannerAiState.phase];
    let state = bannerAiReducer(initialBannerAiState, {
      type: 'selection_started',
      requestRevision: 1,
    });
    phases.push(state.phase);
    state = bannerAiReducer(state, {
      type: 'selection_succeeded',
      requestRevision: 1,
      selection,
    });
    phases.push(state.phase);
    expect(state.selection).toEqual(selection);
    state = bannerAiReducer(state, { type: 'analysis_started', requestRevision: 2 });
    phases.push(state.phase);
    expect(state.layerReview).toBeNull();
    state = bannerAiReducer(state, {
      type: 'analysis_succeeded',
      requestRevision: 2,
      result: sampleBannerAnalysisData,
    });
    phases.push(state.phase);

    expect(phases).toEqual(['idle', 'validating', 'idle', 'running', 'succeeded']);
    expect(state.result?.proposal.parts.map((part) => part.label)).toEqual([
      'Background',
      'Angel body',
      'Left wing',
      'Right wing',
    ]);
    expect(state.layerReview).toMatchObject({
      sourceSha256: sampleBannerAnalysisData.source.sha256,
      selectedPartKey: 'background',
    });
    expect(state.activeRequestRevision).toBeNull();
  });

  it('shows distinct validation and analysis failure states and invalidates completions', () => {
    const validating = bannerAiReducer(initialBannerAiState, {
      type: 'selection_started',
      requestRevision: 1,
    });
    const invalid = bannerAiReducer(validating, {
      type: 'selection_failed',
      requestRevision: 1,
      message: 'Unsupported image.',
    });
    expect(invalid).toMatchObject({
      phase: 'failed',
      selection: null,
      layerReview: null,
      activeRequestRevision: null,
      error: { source: 'validation', message: 'Unsupported image.' },
    });
    expect(
      bannerAiReducer(invalid, {
        type: 'selection_succeeded',
        requestRevision: 1,
        selection,
      }),
    ).toBe(invalid);

    const ready = selectedState();
    const running = bannerAiReducer(ready, { type: 'analysis_started', requestRevision: 2 });
    const failed = bannerAiReducer(running, {
      type: 'analysis_failed',
      requestRevision: 2,
      message: 'Fixture unavailable.',
    });
    expect(failed).toMatchObject({
      phase: 'failed',
      selection,
      result: null,
      layerReview: null,
      activeRequestRevision: null,
      error: { source: 'analysis', message: 'Fixture unavailable.' },
    });
    expect(
      bannerAiReducer(failed, {
        type: 'analysis_succeeded',
        requestRevision: 2,
        result: sampleBannerAnalysisData,
      }),
    ).toBe(failed);
  });

  it('resets all review choices when a different source is selected and analyzed', () => {
    let state = succeededState();
    state = bannerAiReducer(state, { type: 'layer_selected', partKey: 'wing.left' });
    state = bannerAiReducer(state, {
      type: 'layer_inclusion_set',
      partKey: 'wing.left',
      included: false,
    });
    state = bannerAiReducer(state, {
      type: 'layer_visibility_set',
      partKey: 'wing.left',
      visible: false,
    });

    state = bannerAiReducer(state, { type: 'selection_started', requestRevision: 3 });
    expect(state.result).toBeNull();
    expect(state.layerReview).toBeNull();
    const nextSelection = {
      ...selection,
      filename: 'second.png',
      previewUrl: 'blob:second',
      width: 640,
      height: 360,
    };
    state = bannerAiReducer(state, {
      type: 'selection_succeeded',
      requestRevision: 3,
      selection: nextSelection,
    });
    state = bannerAiReducer(state, { type: 'analysis_started', requestRevision: 4 });
    const nextResult: BannerAnalysisData = {
      ...sampleBannerAnalysisData,
      source: {
        ...sampleBannerAnalysisData.source,
        displayFilename: 'second.png',
        width: 640,
        height: 360,
        sha256: 'c'.repeat(64),
      },
    };
    state = bannerAiReducer(state, {
      type: 'analysis_succeeded',
      requestRevision: 4,
      result: nextResult,
    });

    expect(state.layerReview).toMatchObject({
      sourceSha256: 'c'.repeat(64),
      selectedPartKey: 'background',
      parts: expect.arrayContaining([{ partKey: 'wing.left', included: true, visible: true }]),
    });
  });

  it('clears review state on analysis restart and preserves it across unrelated layer no-ops', () => {
    const succeeded = succeededState();
    const unknown = bannerAiReducer(succeeded, { type: 'layer_selected', partKey: 'missing' });
    expect(unknown).toBe(succeeded);

    const restarted = bannerAiReducer(succeeded, {
      type: 'analysis_started',
      requestRevision: 3,
    });
    expect(restarted).toMatchObject({
      phase: 'running',
      result: null,
      layerReview: null,
      requestRevision: 3,
      activeRequestRevision: 3,
    });
  });

  it('returns exact identity for stale success/failure and invalid request revisions', () => {
    const ready = selectedState();
    const running = bannerAiReducer(ready, { type: 'analysis_started', requestRevision: 2 });

    expect(
      bannerAiReducer(running, {
        type: 'analysis_succeeded',
        requestRevision: 1,
        result: sampleBannerAnalysisData,
      }),
    ).toBe(running);
    expect(
      bannerAiReducer(running, {
        type: 'analysis_failed',
        requestRevision: 1,
        message: 'Stale failure.',
      }),
    ).toBe(running);

    for (const requestRevision of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 0]) {
      expect(
        bannerAiReducer(initialBannerAiState, {
          type: 'selection_started',
          requestRevision,
        }),
      ).toBe(initialBannerAiState);
      expect(bannerAiReducer(ready, { type: 'analysis_started', requestRevision })).toBe(ready);
    }
  });
});
