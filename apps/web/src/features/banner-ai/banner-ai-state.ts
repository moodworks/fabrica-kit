import type { BannerAnalysisData } from './banner-ai-contract';

export type BannerAiPhase = 'idle' | 'validating' | 'running' | 'succeeded' | 'failed';

export interface SelectedBannerUpload {
  readonly filename: string;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly originalByteSize: number;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface BannerAiState {
  readonly phase: BannerAiPhase;
  readonly selection: SelectedBannerUpload | null;
  readonly result: BannerAnalysisData | null;
  readonly error: { readonly source: 'validation' | 'analysis'; readonly message: string } | null;
}

export interface BannerAiUploadControlCopy {
  readonly kind: 'filename' | 'status';
  readonly text: string;
}

export type BannerAiEvent =
  | { readonly type: 'selection_started' }
  | { readonly type: 'selection_succeeded'; readonly selection: SelectedBannerUpload }
  | { readonly type: 'selection_failed'; readonly message: string }
  | { readonly type: 'selection_cleared' }
  | { readonly type: 'analysis_started' }
  | { readonly type: 'analysis_succeeded'; readonly result: BannerAnalysisData }
  | { readonly type: 'analysis_failed'; readonly message: string };

export const initialBannerAiState: BannerAiState = Object.freeze({
  phase: 'idle',
  selection: null,
  result: null,
  error: null,
});

export const getBannerAiUploadControlCopy = (state: BannerAiState): BannerAiUploadControlCopy => {
  if (state.selection !== null) {
    return { kind: 'filename', text: state.selection.filename };
  }
  if (state.phase === 'validating') {
    return { kind: 'status', text: 'Validating selected image…' };
  }
  if (state.error?.source === 'validation') {
    return { kind: 'status', text: 'No valid image selected' };
  }
  return { kind: 'status', text: 'No image selected' };
};

export const bannerAiReducer = (state: BannerAiState, event: BannerAiEvent): BannerAiState => {
  switch (event.type) {
    case 'selection_started':
      return { phase: 'validating', selection: null, result: null, error: null };
    case 'selection_succeeded':
      return { phase: 'idle', selection: event.selection, result: null, error: null };
    case 'selection_failed':
      return {
        phase: 'failed',
        selection: null,
        result: null,
        error: { source: 'validation', message: event.message },
      };
    case 'selection_cleared':
      return initialBannerAiState;
    case 'analysis_started':
      if (state.selection === null) return state;
      return { ...state, phase: 'running', result: null, error: null };
    case 'analysis_succeeded':
      if (state.selection === null) return state;
      return { ...state, phase: 'succeeded', result: event.result, error: null };
    case 'analysis_failed':
      if (state.selection === null) return state;
      return {
        ...state,
        phase: 'failed',
        result: null,
        error: { source: 'analysis', message: event.message },
      };
  }
};
