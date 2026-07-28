import type { BannerSceneV1 } from '@fabrica/banner-ai/browser';

import type { ProviderFreeProjectOpenData } from './banner-ai-project-contract';
import type { ProviderFreeExportData } from './banner-ai-project-contract';
import type { ProviderFreeOperationCapture } from './banner-ai-project-api';

export type OpeningStatus = 'closed' | 'loading' | 'ready' | 'open-failed';
export type DraftStatus = 'clean' | 'dirty' | 'saving' | 'save-failed';
export type PersistenceStatus = 'available' | 'unavailable' | 'corrupt';
export type PreviewStatus =
  'not-requested' | 'loading' | 'ready' | 'running' | 'completed' | 'failed';
export type ExportStatus = 'not-requested' | 'generating' | 'validating' | 'passed' | 'failed';

export interface SafeUiFailure {
  readonly code: string;
  readonly message: string;
}

export type ProviderFreeExportEvidence = Omit<ProviderFreeExportData, 'artifact'> & {
  readonly artifact: Omit<ProviderFreeExportData['artifact'], 'bytesBase64'>;
};

export interface BannerAiProjectState {
  readonly lifecycleId: number;
  readonly opening: OpeningStatus;
  readonly projectData: ProviderFreeProjectOpenData | null;
  readonly draftScene: BannerSceneV1 | null;
  readonly selectedPartId: string | null;
  readonly draftStatus: DraftStatus;
  readonly saveOperationId: number;
  readonly persistence: PersistenceStatus;
  readonly openingError: SafeUiFailure | null;
  readonly saveError: SafeUiFailure | null;
  readonly preview: {
    readonly status: PreviewStatus;
    readonly lifecycleId: number;
    readonly operationId: number;
    readonly capture: ProviderFreeOperationCapture | null;
    readonly iframeSrc: string | null;
    readonly nonce: string | null;
    readonly sceneSha256: string | null;
    readonly progressBps: number;
    readonly error: SafeUiFailure | null;
    readonly exitReported: boolean;
  };
  readonly export: {
    readonly status: ExportStatus;
    readonly lifecycleId: number;
    readonly operationId: number;
    readonly capture: ProviderFreeOperationCapture | null;
    readonly sceneSha256: string | null;
    readonly result: ProviderFreeExportEvidence | null;
    readonly error: SafeUiFailure | null;
  };
}

export const initialBannerAiProjectState: BannerAiProjectState = Object.freeze({
  lifecycleId: 0,
  opening: 'closed',
  projectData: null,
  draftScene: null,
  selectedPartId: null,
  draftStatus: 'clean',
  saveOperationId: 0,
  persistence: 'available',
  openingError: null,
  saveError: null,
  preview: Object.freeze({
    status: 'not-requested',
    lifecycleId: 0,
    operationId: 0,
    capture: null,
    iframeSrc: null,
    nonce: null,
    sceneSha256: null,
    progressBps: 0,
    error: null,
    exitReported: false,
  }),
  export: Object.freeze({
    status: 'not-requested',
    lifecycleId: 0,
    operationId: 0,
    capture: null,
    sceneSha256: null,
    result: null,
    error: null,
  }),
});

export type BannerAiProjectEvent =
  | { readonly type: 'open_started'; readonly lifecycleId: number }
  | {
      readonly type: 'open_succeeded';
      readonly lifecycleId: number;
      readonly data: ProviderFreeProjectOpenData;
      readonly persistence: Exclude<PersistenceStatus, 'corrupt'>;
    }
  | {
      readonly type: 'open_failed';
      readonly lifecycleId: number;
      readonly error: SafeUiFailure;
      readonly corrupt: boolean;
    }
  | {
      readonly type: 'draft_changed';
      readonly scene: BannerSceneV1;
      readonly selectedPartId: string;
    }
  | { readonly type: 'save_started'; readonly lifecycleId: number; readonly operationId: number }
  | {
      readonly type: 'save_succeeded';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly data: ProviderFreeProjectOpenData;
      readonly persistence: 'available';
    }
  | {
      readonly type: 'save_failed';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly error: SafeUiFailure;
      readonly persistence: Exclude<PersistenceStatus, 'corrupt'>;
    }
  | {
      readonly type: 'preview_started';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly capture: ProviderFreeOperationCapture;
      readonly nonce: string;
    }
  | {
      readonly type: 'preview_document_ready';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly iframeSrc: string;
      readonly sceneSha256: string;
    }
  | {
      readonly type: 'preview_ready';
      readonly lifecycleId: number;
      readonly operationId: number;
    }
  | {
      readonly type: 'preview_progress';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly progressBps: number;
    }
  | { readonly type: 'preview_exit'; readonly lifecycleId: number; readonly operationId: number }
  | {
      readonly type: 'preview_failed';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly error: SafeUiFailure;
    }
  | {
      readonly type: 'export_started';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly capture: ProviderFreeOperationCapture;
    }
  | {
      readonly type: 'export_validating';
      readonly lifecycleId: number;
      readonly operationId: number;
    }
  | {
      readonly type: 'export_succeeded';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly result: ProviderFreeExportEvidence;
    }
  | {
      readonly type: 'export_failed';
      readonly lifecycleId: number;
      readonly operationId: number;
      readonly error: SafeUiFailure;
    };

const currentScene = (data: ProviderFreeProjectOpenData): BannerSceneV1 => {
  const revision = data.project.revisions[data.project.currentAcceptedRevision - 1];
  if (revision === undefined) throw new TypeError('Accepted project revision is missing.');
  return revision.scene;
};

export const bannerAiProjectReducer = (
  state: BannerAiProjectState,
  event: BannerAiProjectEvent,
): BannerAiProjectState => {
  switch (event.type) {
    case 'open_started':
      return event.lifecycleId <= state.lifecycleId
        ? state
        : {
            ...state,
            lifecycleId: event.lifecycleId,
            opening: 'loading',
            openingError: null,
            saveOperationId: 0,
            preview: initialBannerAiProjectState.preview,
            export: initialBannerAiProjectState.export,
          };
    case 'open_succeeded':
      if (event.lifecycleId !== state.lifecycleId) return state;
      return {
        ...state,
        opening: 'ready',
        projectData: event.data,
        draftScene: currentScene(event.data),
        selectedPartId: event.data.project.selectedPartId,
        draftStatus: 'clean',
        saveOperationId: 0,
        persistence: event.persistence,
        openingError: null,
        saveError: null,
        preview: initialBannerAiProjectState.preview,
        export: initialBannerAiProjectState.export,
      };
    case 'open_failed':
      if (event.lifecycleId !== state.lifecycleId) return state;
      return {
        ...state,
        opening: 'open-failed',
        openingError: event.error,
        persistence: event.corrupt ? 'corrupt' : state.persistence,
      };
    case 'draft_changed':
      if (state.opening !== 'ready' || state.projectData === null) return state;
      return {
        ...state,
        draftScene: event.scene,
        selectedPartId: event.selectedPartId,
        draftStatus: 'dirty',
        saveError: null,
      };
    case 'save_started':
      return event.lifecycleId !== state.lifecycleId ||
        (state.draftStatus !== 'dirty' && state.draftStatus !== 'save-failed')
        ? state
        : {
            ...state,
            draftStatus: 'saving',
            saveOperationId: event.operationId,
            saveError: null,
          };
    case 'save_succeeded':
      if (
        event.lifecycleId !== state.lifecycleId ||
        event.operationId !== state.saveOperationId ||
        state.draftStatus !== 'saving'
      ) {
        return state;
      }
      return {
        ...state,
        projectData: event.data,
        draftScene: currentScene(event.data),
        selectedPartId: event.data.project.selectedPartId,
        draftStatus: 'clean',
        saveOperationId: 0,
        persistence: event.persistence,
        saveError: null,
        preview: initialBannerAiProjectState.preview,
        export: initialBannerAiProjectState.export,
      };
    case 'save_failed':
      return event.lifecycleId !== state.lifecycleId ||
        event.operationId !== state.saveOperationId ||
        state.draftStatus !== 'saving'
        ? state
        : {
            ...state,
            draftStatus: 'save-failed',
            persistence: event.persistence,
            saveError: event.error,
          };
    case 'preview_started':
      if (
        event.lifecycleId !== state.lifecycleId ||
        state.preview.status === 'loading' ||
        state.preview.status === 'running'
      )
        return state;
      return {
        ...state,
        preview: {
          status: 'loading',
          lifecycleId: event.lifecycleId,
          operationId: event.operationId,
          capture: event.capture,
          iframeSrc: null,
          nonce: event.nonce,
          sceneSha256: event.capture.sceneSha256,
          progressBps: 0,
          error: null,
          exitReported: false,
        },
      };
    case 'preview_document_ready':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.preview.lifecycleId ||
        event.operationId !== state.preview.operationId ||
        state.preview.status !== 'loading'
        ? state
        : {
            ...state,
            preview: {
              ...state.preview,
              status: 'ready',
              iframeSrc: event.iframeSrc,
              sceneSha256: event.sceneSha256,
            },
          };
    case 'preview_ready':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.preview.lifecycleId ||
        event.operationId !== state.preview.operationId
        ? state
        : { ...state, preview: { ...state.preview, status: 'ready' } };
    case 'preview_progress':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.preview.lifecycleId ||
        event.operationId !== state.preview.operationId
        ? state
        : {
            ...state,
            preview: {
              ...state.preview,
              status: event.progressBps === 10_000 ? 'completed' : 'running',
              progressBps: event.progressBps,
            },
          };
    case 'preview_exit':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.preview.lifecycleId ||
        event.operationId !== state.preview.operationId
        ? state
        : { ...state, preview: { ...state.preview, exitReported: true } };
    case 'preview_failed':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.preview.lifecycleId ||
        event.operationId !== state.preview.operationId
        ? state
        : {
            ...state,
            preview: { ...state.preview, status: 'failed', error: event.error },
          };
    case 'export_started':
      if (
        event.lifecycleId !== state.lifecycleId ||
        state.export.status === 'generating' ||
        state.export.status === 'validating'
      )
        return state;
      return {
        ...state,
        export: {
          status: 'generating',
          lifecycleId: event.lifecycleId,
          operationId: event.operationId,
          capture: event.capture,
          sceneSha256: event.capture.sceneSha256,
          result: state.export.result,
          error: null,
        },
      };
    case 'export_validating':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.export.lifecycleId ||
        event.operationId !== state.export.operationId
        ? state
        : { ...state, export: { ...state.export, status: 'validating' } };
    case 'export_succeeded':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.export.lifecycleId ||
        event.operationId !== state.export.operationId
        ? state
        : {
            ...state,
            export: {
              ...state.export,
              status: 'passed',
              sceneSha256: event.result.sceneSha256,
              result: event.result,
              error: null,
            },
          };
    case 'export_failed':
      return event.lifecycleId !== state.lifecycleId ||
        event.lifecycleId !== state.export.lifecycleId ||
        event.operationId !== state.export.operationId
        ? state
        : {
            ...state,
            export: { ...state.export, status: 'failed', error: event.error },
          };
  }
};
