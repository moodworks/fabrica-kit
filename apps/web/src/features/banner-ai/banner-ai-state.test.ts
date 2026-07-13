import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
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

describe('Banner AI client state', () => {
  it('derives accurate upload-control copy from application state', () => {
    expect(getBannerAiUploadControlCopy(initialBannerAiState)).toEqual({
      kind: 'status',
      text: 'No image selected',
    });

    const validating = bannerAiReducer(initialBannerAiState, { type: 'selection_started' });
    expect(getBannerAiUploadControlCopy(validating)).toEqual({
      kind: 'status',
      text: 'Validating selected image…',
    });

    const selected = bannerAiReducer(validating, {
      type: 'selection_succeeded',
      selection: { ...selection, filename: 'إعلان.png' },
    });
    expect(getBannerAiUploadControlCopy(selected)).toEqual({
      kind: 'filename',
      text: 'إعلان.png',
    });

    const invalid = bannerAiReducer(validating, {
      type: 'selection_failed',
      message: 'Unsupported image.',
    });
    expect(getBannerAiUploadControlCopy(invalid)).toEqual({
      kind: 'status',
      text: 'No valid image selected',
    });
  });

  it('moves through idle, validating, ready idle, running, and succeeded', () => {
    const phases: BannerAiState['phase'][] = [initialBannerAiState.phase];
    let state = bannerAiReducer(initialBannerAiState, { type: 'selection_started' });
    phases.push(state.phase);
    state = bannerAiReducer(state, { type: 'selection_succeeded', selection });
    phases.push(state.phase);
    expect(state.selection).toEqual(selection);
    state = bannerAiReducer(state, { type: 'analysis_started' });
    phases.push(state.phase);
    state = bannerAiReducer(state, {
      type: 'analysis_succeeded',
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
  });

  it('shows distinct validation and analysis failure states', () => {
    const validating = bannerAiReducer(initialBannerAiState, { type: 'selection_started' });
    const invalid = bannerAiReducer(validating, {
      type: 'selection_failed',
      message: 'Unsupported image.',
    });
    expect(invalid).toMatchObject({
      phase: 'failed',
      selection: null,
      error: { source: 'validation', message: 'Unsupported image.' },
    });

    const ready = bannerAiReducer(validating, { type: 'selection_succeeded', selection });
    const running = bannerAiReducer(ready, { type: 'analysis_started' });
    const failed = bannerAiReducer(running, {
      type: 'analysis_failed',
      message: 'Fixture unavailable.',
    });
    expect(failed).toMatchObject({
      phase: 'failed',
      selection,
      error: { source: 'analysis', message: 'Fixture unavailable.' },
    });
  });
});
