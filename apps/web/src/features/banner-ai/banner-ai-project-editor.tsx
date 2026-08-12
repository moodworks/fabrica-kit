'use client';

import Link from 'next/link';
import {
  GENTLE_FLOAT_PRESET_V1,
  isProviderFreeLayerIdV1,
  mutateProviderFreeBannerSceneV1,
  validatePreviewMessage,
} from '@fabrica/banner-ai/browser';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { BannerAiExportPanel } from './banner-ai-export-panel';
import { BannerAiLayerControls, type BannerAiLayerControlPart } from './banner-ai-layer-controls';
import { BannerAiPreview } from './banner-ai-preview';
import {
  BannerProjectRequestError,
  captureAcceptedProviderFreeRevision,
  reopenProviderFreeProject,
  requestProviderFreeExport,
  requestProviderFreePreview,
  requestProviderFreeProject,
  saveProviderFreeProject,
  type ProviderFreeOperationCapture,
} from './banner-ai-project-api';
import { getAcceptedRevision } from './banner-ai-project-contract';
import {
  bannerAiProjectReducer,
  initialBannerAiProjectState,
  type ProviderFreeExportEvidence,
  type SafeUiFailure,
} from './banner-ai-project-state';
import {
  readStoredProviderFreeProject,
  resetStoredProviderFreeProject,
  writeStoredProviderFreeProject,
} from './banner-ai-project-storage';

const fallbackFailure = (operation: 'open' | 'preview' | 'save' | 'export'): SafeUiFailure => ({
  code: `DEMO_${operation.toUpperCase()}_FAILED`,
  message: `The local ${operation} operation could not be completed. Your accepted scene is unchanged.`,
});

const safeFailureFrom = (
  error: unknown,
  operation: 'open' | 'preview' | 'save' | 'export',
): SafeUiFailure =>
  error instanceof BannerProjectRequestError
    ? { code: error.code, message: error.message }
    : fallbackFailure(operation);

const freshPreviewNonce = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
};

const bytesFromBase64 = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const downloadZip = (encoded: string, filename: string): void => {
  const bytes = bytesFromBase64(encoded);
  const url = URL.createObjectURL(new Blob([exactArrayBuffer(bytes)], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const exportEvidenceFrom = (
  result: Awaited<ReturnType<typeof requestProviderFreeExport>>,
): ProviderFreeExportEvidence => ({
  ...result,
  artifact: {
    byteSize: result.artifact.byteSize,
    filename: result.artifact.filename,
    mediaType: result.artifact.mediaType,
    sha256: result.artifact.sha256,
    validationLabel: result.artifact.validationLabel,
  },
});

interface OperationLease {
  readonly lifecycleId: number;
  readonly operationId: number;
}

const sameLease = (left: OperationLease | null, right: OperationLease): boolean =>
  left?.lifecycleId === right.lifecycleId && left.operationId === right.operationId;

export function BannerAiProjectEditor() {
  const [state, dispatch] = useReducer(bannerAiProjectReducer, initialBannerAiProjectState);
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const lifecycleIdRef = useRef(0);
  const operationIdRef = useRef(0);
  const saveActiveRef = useRef<OperationLease | null>(null);
  const previewActiveRef = useRef<OperationLease | null>(null);
  const exportActiveRef = useRef<OperationLease | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const resetButtonRef = useRef<HTMLButtonElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const exportBytesRef = useRef<{ readonly encoded: string; readonly filename: string } | null>(
    null,
  );

  const nextOperationId = (): number => {
    operationIdRef.current += 1;
    return operationIdRef.current;
  };

  const revokePreviewUrl = useCallback((): void => {
    if (previewUrlRef.current !== null) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const beginProjectLifecycle = useCallback((): number => {
    lifecycleIdRef.current += 1;
    const lifecycleId = lifecycleIdRef.current;
    saveActiveRef.current = null;
    previewActiveRef.current = null;
    exportActiveRef.current = null;
    revokePreviewUrl();
    exportBytesRef.current = null;
    dispatch({ type: 'open_started', lifecycleId });
    return lifecycleId;
  }, [revokePreviewUrl]);

  const leaseIsCurrent = (active: OperationLease | null, lease: OperationLease): boolean =>
    lifecycleIdRef.current === lease.lifecycleId && sameLease(active, lease);

  useEffect(
    () => () => {
      lifecycleIdRef.current += 1;
      saveActiveRef.current = null;
      previewActiveRef.current = null;
      exportActiveRef.current = null;
      revokePreviewUrl();
      exportBytesRef.current = null;
    },
    [revokePreviewUrl],
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (): void => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const acceptOpenedProject = useCallback(
    (data: Awaited<ReturnType<typeof requestProviderFreeProject>>, lifecycleId: number): void => {
      if (lifecycleIdRef.current !== lifecycleId) return;
      const write = writeStoredProviderFreeProject(localStorage, data.canonicalProjectJson);
      if (lifecycleIdRef.current !== lifecycleId) return;
      dispatch({
        type: 'open_succeeded',
        lifecycleId,
        data,
        persistence: write.success ? 'available' : 'unavailable',
      });
    },
    [],
  );

  const openFreshProject = useCallback(
    async (lifecycleId: number): Promise<void> => {
      try {
        acceptOpenedProject(await requestProviderFreeProject(), lifecycleId);
      } catch (error) {
        if (lifecycleIdRef.current !== lifecycleId) return;
        dispatch({
          type: 'open_failed',
          lifecycleId,
          error: safeFailureFrom(error, 'open'),
          corrupt: false,
        });
      }
    },
    [acceptOpenedProject],
  );

  const reopenStored = useCallback(
    async (canonicalProjectJson: string, lifecycleId: number): Promise<void> => {
      try {
        const data = await reopenProviderFreeProject(canonicalProjectJson);
        if (lifecycleIdRef.current !== lifecycleId) return;
        if (data.canonicalProjectJson !== canonicalProjectJson) {
          dispatch({
            type: 'open_failed',
            lifecycleId,
            corrupt: true,
            error: {
              code: 'PROJECT_STORAGE_CORRUPT',
              message:
                'Saved demo data is not canonical. Reset only this local demo project to continue.',
            },
          });
          return;
        }
        dispatch({ type: 'open_succeeded', lifecycleId, data, persistence: 'available' });
      } catch (error) {
        if (lifecycleIdRef.current !== lifecycleId) return;
        const failure = safeFailureFrom(error, 'open');
        dispatch({
          type: 'open_failed',
          lifecycleId,
          error: failure,
          corrupt:
            failure.code === 'PROJECT_STORAGE_CORRUPT' ||
            failure.code === 'PROJECT_VALIDATION_FAILED',
        });
      }
    },
    [],
  );

  useEffect(() => {
    const stored = readStoredProviderFreeProject(localStorage);
    if (stored.status !== 'available') return;
    const lifecycleId = beginProjectLifecycle();
    void reopenStored(stored.canonicalProjectJson, lifecycleId);
  }, [beginProjectLifecycle, reopenStored]);

  const openProject = async (): Promise<void> => {
    if (state.opening === 'loading') return;
    const lifecycleId = beginProjectLifecycle();
    const stored = readStoredProviderFreeProject(localStorage);
    if (stored.status === 'unavailable') {
      await openFreshProject(lifecycleId);
      return;
    }
    if (stored.status === 'missing') {
      await openFreshProject(lifecycleId);
      return;
    }

    await reopenStored(stored.canonicalProjectJson, lifecycleId);
  };

  const confirmReset = async (): Promise<void> => {
    const lifecycleId = beginProjectLifecycle();
    if (!resetStoredProviderFreeProject(localStorage)) {
      dispatch({
        type: 'open_failed',
        lifecycleId,
        corrupt: state.persistence === 'corrupt',
        error: {
          code: 'PROJECT_RESET_FAILED',
          message: 'The local demo key could not be reset. No other browser data was changed.',
        },
      });
      return;
    }
    setResetConfirmation(false);
    await openFreshProject(lifecycleId);
    if (lifecycleIdRef.current !== lifecycleId) return;
    window.setTimeout(() => {
      if (lifecycleIdRef.current === lifecycleId) {
        (resetButtonRef.current ?? openButtonRef.current)?.focus();
      }
    }, 0);
  };

  const cancelReset = (): void => {
    setResetConfirmation(false);
    window.setTimeout(() => resetButtonRef.current?.focus(), 0);
  };

  const projectData = state.projectData;
  const draftScene = state.draftScene;
  const acceptedRevision = projectData === null ? null : getAcceptedRevision(projectData.project);

  const layerParts = useMemo<readonly BannerAiLayerControlPart[]>(() => {
    if (projectData === null || draftScene === null) return [];
    return projectData.presentation.parts.map((part) => {
      if (part.targetId === 'background') {
        return {
          ...part,
          included: draftScene.canvas.background.kind !== 'transparent',
          visible: null,
        };
      }
      const layer = draftScene.layers.find((candidate) => candidate.id === part.targetId);
      if (layer === undefined) throw new TypeError('Fixture presentation layer is unresolved.');
      return { ...part, included: layer.included, visible: layer.visible };
    });
  }, [draftScene, projectData]);

  const updateDraft = (
    scene: NonNullable<typeof draftScene>,
    selectedPartId = state.selectedPartId,
  ): void => {
    if (selectedPartId === null) return;
    dispatch({ type: 'draft_changed', scene, selectedPartId });
  };

  const selectPart = (targetId: string): void => {
    if (draftScene === null) return;
    updateDraft(draftScene, targetId);
  };

  const setIncluded = (targetId: string, included: boolean): void => {
    if (draftScene === null) return;
    const scene =
      targetId === 'background'
        ? mutateProviderFreeBannerSceneV1(draftScene, {
            type: 'set_background_included',
            included,
          })
        : isProviderFreeLayerIdV1(targetId)
          ? mutateProviderFreeBannerSceneV1(draftScene, {
              type: 'set_layer_included',
              layerId: targetId,
              included,
            })
          : null;
    if (scene !== null) updateDraft(scene);
  };

  const setVisible = (targetId: string, visible: boolean): void => {
    if (draftScene === null || !isProviderFreeLayerIdV1(targetId)) return;
    updateDraft(
      mutateProviderFreeBannerSceneV1(draftScene, {
        type: 'set_layer_visible',
        layerId: targetId,
        visible,
      }),
    );
  };

  const applyPreset = (): void => {
    if (
      draftScene === null ||
      state.selectedPartId === null ||
      !isProviderFreeLayerIdV1(state.selectedPartId)
    ) {
      return;
    }
    updateDraft(
      mutateProviderFreeBannerSceneV1(draftScene, {
        type: 'apply_gentle_float',
        layerId: state.selectedPartId,
      }),
    );
  };

  const clearPreset = (): void => {
    if (draftScene === null) return;
    updateDraft(mutateProviderFreeBannerSceneV1(draftScene, { type: 'clear_gentle_float' }));
  };

  const save = async (): Promise<void> => {
    if (
      projectData === null ||
      draftScene === null ||
      state.selectedPartId === null ||
      state.draftStatus === 'saving' ||
      saveActiveRef.current !== null
    ) {
      return;
    }
    const lease = {
      lifecycleId: lifecycleIdRef.current,
      operationId: nextOperationId(),
    } satisfies OperationLease;
    saveActiveRef.current = lease;
    dispatch({ type: 'save_started', ...lease });
    try {
      const data = await saveProviderFreeProject({
        project: projectData.project,
        scene: draftScene,
        selectedPartId: state.selectedPartId,
      });
      if (!leaseIsCurrent(saveActiveRef.current, lease)) return;
      const write = writeStoredProviderFreeProject(localStorage, data.canonicalProjectJson);
      if (!leaseIsCurrent(saveActiveRef.current, lease)) return;
      if (!write.success) {
        dispatch({
          type: 'save_failed',
          ...lease,
          persistence: 'unavailable',
          error: {
            code: write.code,
            message:
              'The accepted scene remains in memory, but browser storage could not save it. Retry without rebuilding the draft.',
          },
        });
        return;
      }
      previewActiveRef.current = null;
      exportActiveRef.current = null;
      revokePreviewUrl();
      exportBytesRef.current = null;
      dispatch({ type: 'save_succeeded', ...lease, data, persistence: 'available' });
    } catch (error) {
      if (!leaseIsCurrent(saveActiveRef.current, lease)) return;
      dispatch({
        type: 'save_failed',
        ...lease,
        persistence: state.persistence === 'unavailable' ? 'unavailable' : 'available',
        error: safeFailureFrom(error, 'save'),
      });
    } finally {
      if (sameLease(saveActiveRef.current, lease)) saveActiveRef.current = null;
    }
  };

  const startPreview = useCallback(
    async (capture: ProviderFreeOperationCapture): Promise<void> => {
      if (previewActiveRef.current !== null) return;
      const lease = {
        lifecycleId: lifecycleIdRef.current,
        operationId: nextOperationId(),
      } satisfies OperationLease;
      previewActiveRef.current = lease;
      const nonce = freshPreviewNonce();
      revokePreviewUrl();
      dispatch({ type: 'preview_started', ...lease, capture, nonce });
      try {
        const result = await requestProviderFreePreview(capture, nonce);
        if (!leaseIsCurrent(previewActiveRef.current, lease)) return;
        if (
          result.nonce !== nonce ||
          result.sceneSha256 !== capture.sceneSha256 ||
          result.byteSize !== bytesFromBase64(result.contentBase64).byteLength
        ) {
          throw new BannerProjectRequestError(
            'PREVIEW_IDENTITY_MISMATCH',
            'The isolated preview identity did not match the accepted scene.',
          );
        }
        const url = URL.createObjectURL(
          new Blob([exactArrayBuffer(bytesFromBase64(result.contentBase64))], {
            type: 'text/html',
          }),
        );
        previewUrlRef.current = url;
        dispatch({
          type: 'preview_document_ready',
          ...lease,
          iframeSrc: url,
          sceneSha256: result.sceneSha256,
        });
      } catch (error) {
        if (!leaseIsCurrent(previewActiveRef.current, lease)) return;
        dispatch({
          type: 'preview_failed',
          ...lease,
          error: safeFailureFrom(error, 'preview'),
        });
      } finally {
        if (sameLease(previewActiveRef.current, lease)) previewActiveRef.current = null;
      }
    },
    [revokePreviewUrl],
  );

  const previewAccepted = (): void => {
    if (projectData === null) return;
    void startPreview(captureAcceptedProviderFreeRevision(projectData.project));
  };

  const retryPreview = (): void => {
    if (state.preview.capture === null) return;
    void startPreview(state.preview.capture);
  };

  useEffect(() => {
    const expectedNonce = state.preview.nonce;
    const lifecycleId = state.preview.lifecycleId;
    const operationId = state.preview.operationId;
    if (expectedNonce === null || state.preview.iframeSrc === null) return;

    const receive = (event: MessageEvent<unknown>): void => {
      const expectedSource = iframeRef.current?.contentWindow;
      if (expectedSource === null || expectedSource === undefined) return;
      const result = validatePreviewMessage(
        { data: event.data, source: event.source },
        { nonce: expectedNonce, source: expectedSource },
      );
      if (!result.success) return;
      switch (result.data.type) {
        case 'ready':
          dispatch({ type: 'preview_ready', lifecycleId, operationId });
          return;
        case 'progress':
          dispatch({
            type: 'preview_progress',
            lifecycleId,
            operationId,
            progressBps: result.data.progressBps,
          });
          return;
        case 'exit':
          dispatch({ type: 'preview_exit', lifecycleId, operationId });
          return;
        case 'error':
          dispatch({
            type: 'preview_failed',
            lifecycleId,
            operationId,
            error: { code: result.data.code, message: result.data.message },
          });
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [
    state.preview.iframeSrc,
    state.preview.lifecycleId,
    state.preview.nonce,
    state.preview.operationId,
  ]);

  const startExport = async (capture: ProviderFreeOperationCapture): Promise<void> => {
    if (exportActiveRef.current !== null) return;
    const lease = {
      lifecycleId: lifecycleIdRef.current,
      operationId: nextOperationId(),
    } satisfies OperationLease;
    exportActiveRef.current = lease;
    dispatch({ type: 'export_started', ...lease, capture });
    try {
      const result = await requestProviderFreeExport(capture);
      if (!leaseIsCurrent(exportActiveRef.current, lease)) return;
      dispatch({ type: 'export_validating', ...lease });
      if (
        result.sceneSha256 !== capture.sceneSha256 ||
        result.artifact.byteSize !== bytesFromBase64(result.artifact.bytesBase64).byteLength
      ) {
        throw new BannerProjectRequestError(
          'EXPORT_IDENTITY_MISMATCH',
          'The deterministic export identity did not match the accepted scene.',
        );
      }
      exportBytesRef.current = {
        encoded: result.artifact.bytesBase64,
        filename: result.artifact.filename,
      };
      dispatch({ type: 'export_succeeded', ...lease, result: exportEvidenceFrom(result) });
      downloadZip(result.artifact.bytesBase64, result.artifact.filename);
    } catch (error) {
      if (!leaseIsCurrent(exportActiveRef.current, lease)) return;
      dispatch({
        type: 'export_failed',
        ...lease,
        error: safeFailureFrom(error, 'export'),
      });
    } finally {
      if (sameLease(exportActiveRef.current, lease)) exportActiveRef.current = null;
    }
  };

  const exportAccepted = (): void => {
    if (projectData === null) return;
    void startExport(captureAcceptedProviderFreeRevision(projectData.project));
  };

  const retryExport = (): void => {
    if (state.export.capture === null) return;
    void startExport(state.export.capture);
  };

  const downloadPriorExport = (): void => {
    const value = exportBytesRef.current;
    if (value !== null) downloadZip(value.encoded, value.filename);
  };

  if (state.opening !== 'ready' || projectData === null || draftScene === null) {
    return (
      <main className="banner-shell banner-editor-shell">
        <nav className="product-nav" aria-label="Product navigation">
          <Link href="/banner-ai">Banner AI</Link>
          <span>Provider-free editor</span>
        </nav>
        <section className="editor-open-card" aria-labelledby="editor-open-title">
          <p className="section-kicker">Verified replay · development-only · 300 × 200</p>
          <h1 id="editor-open-title">Open the verified Meta SAM replay project.</h1>
          <p>
            This fixed local project preserves and replays validated real Meta SAM automatic
            candidate 05, manually selected. There is no live provider call, Qwen box output,
            reconstruction, or product admission.
          </p>
          {state.openingError === null ? null : (
            <div className="editor-operation-error" role="alert">
              <strong>{state.openingError.code}</strong>
              <span>{state.openingError.message}</span>
            </div>
          )}
          <div className="editor-operation-actions">
            <button
              ref={openButtonRef}
              type="button"
              onClick={() => void openProject()}
              disabled={state.opening === 'loading' || state.persistence === 'corrupt'}
            >
              {state.opening === 'loading'
                ? 'Opening approved demo…'
                : 'Open approved demo project'}
            </button>
            {state.persistence === 'corrupt' ? (
              <button
                ref={resetButtonRef}
                className="editor-secondary-button"
                type="button"
                onClick={() => setResetConfirmation(true)}
              >
                Reset demo project
              </button>
            ) : null}
          </div>
          {resetConfirmation ? (
            <div className="editor-reset-confirmation" role="alert">
              <p>
                Remove only the corrupt local verified replay key? No unrelated browser data is
                changed.
              </p>
              <div className="editor-operation-actions">
                <button type="button" onClick={() => void confirmReset()}>
                  Confirm demo reset
                </button>
                <button className="editor-secondary-button" type="button" onClick={cancelReset}>
                  Cancel reset
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  const selectedLayer = draftScene.layers.find((layer) => layer.id === state.selectedPartId);
  const presetTarget = draftScene.timeline[0]?.targetLayerId ?? null;
  const working = state.draftStatus === 'saving';
  const exportResultForDigest =
    state.export.result?.sceneSha256 === state.export.sceneSha256 ? state.export.result : null;

  return (
    <main className="banner-shell banner-editor-shell">
      <nav className="product-nav" aria-label="Product navigation">
        <Link href="/banner-ai">Banner AI</Link>
        <span>Provider-free editor</span>
      </nav>

      <header className="editor-project-header" aria-labelledby="editor-project-title">
        <div>
          <p className="section-kicker">Verified Meta SAM replay · development-only</p>
          <h1 id="editor-project-title">{projectData.project.displayName}</h1>
          <p>
            Exact replay fixture <code>{projectData.project.fixtureId}</code> · 300 × 200 canvas
          </p>
        </div>
        <div className="editor-project-actions">
          <span className="local-badge">Replay · no live provider call</span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              working ||
              (state.draftStatus !== 'dirty' && state.draftStatus !== 'save-failed') ||
              state.persistence === 'corrupt'
            }
          >
            {working ? 'Saving revision…' : 'Save changes'}
          </button>
          <button
            ref={resetButtonRef}
            className="editor-secondary-button"
            type="button"
            onClick={() => setResetConfirmation(true)}
          >
            Reset demo project
          </button>
        </div>
      </header>

      <section className="editor-revision-strip" aria-labelledby="editor-revision-title">
        <div>
          <h2 id="editor-revision-title">Accepted revision {acceptedRevision?.revision}</h2>
          <p className="digest">{acceptedRevision?.sceneSha256}</p>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true">
          {state.draftStatus === 'clean'
            ? 'Saved locally and accepted.'
            : state.draftStatus === 'dirty'
              ? 'Unsaved scene changes.'
              : state.draftStatus === 'saving'
                ? 'Validating and saving a new append-only revision.'
                : 'Save failed; the accepted revision and draft are preserved.'}
          {state.persistence === 'unavailable'
            ? ' Browser persistence is unavailable; accepted in-memory state remains.'
            : ''}
        </p>
      </section>

      {state.saveError === null ? null : (
        <div className="editor-operation-error" role="alert">
          <strong>{state.saveError.code}</strong>
          <span>{state.saveError.message}</span>
        </div>
      )}

      {resetConfirmation ? (
        <div className="editor-reset-confirmation" role="alert">
          <p>Reset only this local demo key and reopen revision 1?</p>
          <div className="editor-operation-actions">
            <button type="button" onClick={() => void confirmReset()}>
              Confirm demo reset
            </button>
            <button className="editor-secondary-button" type="button" onClick={cancelReset}>
              Cancel reset
            </button>
          </div>
        </div>
      ) : null}

      <section className="editor-source-reference" aria-labelledby="editor-source-reference-title">
        <div>
          <p className="section-kicker">Immutable input</p>
          <h2 id="editor-source-reference-title">Source banner</h2>
          <p>Reference only — this is the original input, not an editable layer.</p>
          <p className="editor-source-reference-meta">
            876 × 221 · {projectData.presentation.source.asset.sha256}
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- bounded in-memory validated data URL */}
        <img
          src={projectData.presentation.source.thumbnail.dataUrl}
          alt="Source banner reference"
          width={projectData.presentation.source.thumbnail.pixelWidth}
          height={projectData.presentation.source.thumbnail.pixelHeight}
        />
      </section>

      <div className="editor-primary-grid">
        <BannerAiLayerControls
          parts={layerParts}
          selectedPartId={state.selectedPartId ?? 'background'}
          fixtureLabel={projectData.presentation.fixtureLabel}
          disabled={working}
          onSelectPart={selectPart}
          onSetPartIncluded={setIncluded}
          onSetPartVisible={setVisible}
        />

        <section className="editor-preset-card" aria-labelledby="editor-preset-title">
          <div className="editor-section-heading">
            <div>
              <p className="section-kicker">Controlled animation</p>
              <h2 id="editor-preset-title">{GENTLE_FLOAT_PRESET_V1.label}</h2>
            </div>
            <span>Preset v1</span>
          </div>
          <p>
            Moves one foreground layer by −6 px on the y axis for two alternating 1.2-second
            iterations with ease-in-out timing.
          </p>
          {selectedLayer === undefined ? (
            <p className="editor-disabled-explanation">
              Select a foreground layer to apply this preset. The canvas background cannot animate.
            </p>
          ) : (
            <p>
              Selected layer: <strong>{selectedLayer.name}</strong>. Current preset:{' '}
              <strong>
                {presetTarget === selectedLayer.id
                  ? 'applied here'
                  : presetTarget === null
                    ? 'none'
                    : 'applied to another layer'}
              </strong>
              .
            </p>
          )}
          <div className="editor-operation-actions">
            <button
              type="button"
              onClick={applyPreset}
              disabled={working || selectedLayer === undefined}
            >
              Apply Gentle float
            </button>
            <button
              className="editor-secondary-button"
              type="button"
              onClick={clearPreset}
              disabled={working || presetTarget === null}
            >
              Clear Gentle float
            </button>
          </div>
        </section>
      </div>

      <div className="editor-output-grid">
        <BannerAiPreview
          projectName={projectData.project.displayName}
          sceneSha256={state.preview.sceneSha256 ?? acceptedRevision!.sceneSha256}
          status={state.preview.status}
          iframeSrc={state.preview.iframeSrc}
          iframeInstanceId={`${state.preview.operationId}:${state.preview.nonce ?? 'none'}`}
          iframeRef={iframeRef}
          progressBps={state.preview.progressBps}
          errorMessage={state.preview.error?.message}
          reducedMotion={reducedMotion}
          disabled={working}
          onPreview={previewAccepted}
          onRetry={retryPreview}
        />

        <BannerAiExportPanel
          sceneSha256={state.export.sceneSha256 ?? acceptedRevision!.sceneSha256}
          status={state.export.status}
          artifact={exportResultForDigest?.artifact ?? null}
          validation={exportResultForDigest?.validation ?? null}
          errorMessage={state.export.error?.message}
          disabled={working}
          onGenerate={exportAccepted}
          onRetry={retryExport}
          onDownload={downloadPriorExport}
        />
      </div>

      {state.preview.exitReported ? (
        <p className="editor-exit-status" role="status">
          Preview exit was intercepted. The page did not navigate; the accepted destination remains
          inert preview metadata.
        </p>
      ) : null}
    </main>
  );
}
