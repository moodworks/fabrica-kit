'use client';

import Link from 'next/link';
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  requestUploadedBannerOperation,
  composeUploadedBannerMixedLayers,
  promptUploadedBannerCutout,
  type UploadedPromptedCutout,
  type UploadedMixedLayer,
  type UploadedBannerOperationData,
} from './banner-ai-project-api';
import { BannerAiSourceImage } from './banner-ai-source-image';
import { BannerAiStatusPanel } from './banner-ai-status-panel';
import {
  bannerAiReducer,
  getBannerAiUploadControlCopy,
  initialBannerAiState,
} from './banner-ai-state';
import { inspectBrowserRasterUpload } from './browser-upload';
import {
  clampMarqueePoint,
  marqueeRectFromPoints,
  selectMarqueeCandidates,
} from './marquee-selection';
import { sourceCropFromDisplayDrag } from './source-region-geometry';
import { partitionUploadedCandidates } from './candidate-quality';

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

const messageFrom = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;
const VERIFIED_REPLAY_PROVENANCE = 'Verified Meta SAM 2.1 cutout replay — no live call' as const;
type DraftLayer =
  | { readonly kind: 'sam-candidate-group-v1'; readonly candidateIds: readonly string[] }
  | {
      readonly kind: 'source-region-v1';
      readonly crop: {
        readonly left: number;
        readonly top: number;
        readonly width: number;
        readonly height: number;
      };
    }
  | { readonly kind: 'prompted-cutout-v1'; readonly promptedId: string };

export function BannerAiClient() {
  const [state, dispatch] = useReducer(bannerAiReducer, initialBannerAiState);
  const fileRef = useRef<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const requestRevisionRef = useRef(0);
  const [uploadedOperation, setUploadedOperation] = useState<UploadedBannerOperationData | null>(
    null,
  );
  const [uploadProvenance, setUploadProvenance] = useState<
    UploadedBannerOperationData['provenance']
  >(VERIFIED_REPLAY_PROVENANCE);
  const [selectedCandidates, setSelectedCandidates] = useState<readonly string[]>([]);
  const [draftLayers, setDraftLayers] = useState<readonly DraftLayer[]>([]);
  const [builderMode, setBuilderMode] = useState<'candidates' | 'region' | 'prompted'>(
    'candidates',
  );
  const [pendingPrompt, setPendingPrompt] = useState<{
    readonly crop: {
      readonly left: number;
      readonly top: number;
      readonly width: number;
      readonly height: number;
    };
    readonly token: number;
    readonly status: 'ready' | 'generating' | 'failed';
    readonly error?: string;
  } | null>(null);
  const [redrawingPrompt, setRedrawingPrompt] = useState(false);
  const [promptAnnouncement, setPromptAnnouncement] = useState('');
  const [promptedCutouts, setPromptedCutouts] = useState<
    ReadonlyMap<string, UploadedPromptedCutout>
  >(new Map());
  const promptGenerating = pendingPrompt?.status === 'generating';
  const [showSmallFragments, setShowSmallFragments] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    start: { x: number; y: number };
    baseline: readonly string[];
    additive: boolean;
    dragging: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const pendingPromptTokenRef = useRef(0);
  const promptAttemptRef = useRef(0);
  const promptInFlightRef = useRef<number | null>(null);
  const quality = partitionUploadedCandidates(uploadedOperation?.candidates ?? []);
  const visibleCandidates = showSmallFragments
    ? (uploadedOperation?.candidates ?? [])
    : quality.suggested;

  const stagePoint = (event: { clientX: number; clientY: number }) => {
    const stage = stageRef.current;
    if (stage === null) return null;
    const rect = stage.getBoundingClientRect();
    return clampMarqueePoint(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      rect.width,
      rect.height,
    );
  };
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (composeBusy || promptGenerating) return;
    if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || event.button !== 0)
      return;
    const point = stagePoint(event);
    const stage = stageRef.current;
    if (point === null || stage === null) return;
    dragRef.current = {
      pointerId: event.pointerId,
      start: point,
      baseline: selectedCandidates,
      additive: event.shiftKey,
      dragging: false,
    };
    stage.setPointerCapture(event.pointerId);
  };
  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const point = stagePoint(event);
    const stage = stageRef.current;
    if (point === null || stage === null) return;
    const rect = stage.getBoundingClientRect();
    const next = marqueeRectFromPoints(drag.start, point);
    if (!drag.dragging && next.width < 5 && next.height < 5) return;
    drag.dragging = true;
    setMarquee(next);
    if (builderMode !== 'candidates') return;
    const picked = selectMarqueeCandidates(
      next,
      visibleCandidates.filter(
        (candidate) =>
          !draftLayers.some(
            (layer) =>
              layer.kind === 'sam-candidate-group-v1' &&
              layer.candidateIds.includes(candidate.candidateId),
          ),
      ) ?? [],
      rect.width,
      rect.height,
      state.selection?.width,
      state.selection?.height,
    );
    const merged = drag.additive ? [...new Set([...drag.baseline, ...picked])] : picked;
    setSelectedCandidates(
      merged.toSorted(
        (left, right) =>
          (uploadedOperation?.candidates.find((candidate) => candidate.candidateId === left)
            ?.order ?? 0) -
          (uploadedOperation?.candidates.find((candidate) => candidate.candidateId === right)
            ?.order ?? 0),
      ),
    );
  };
  const finishStagePointer = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    if (cancelled || !drag.dragging) setSelectedCandidates(drag.baseline);
    else {
      const point = stagePoint(event);
      const stage = stageRef.current;
      if (point !== null && stage !== null) {
        const rect = stage.getBoundingClientRect();
        const finalMarquee = marqueeRectFromPoints(drag.start, point);
        if (builderMode === 'region' || builderMode === 'prompted') {
          const sourceWidth = state.selection?.width ?? rect.width;
          const sourceHeight = state.selection?.height ?? rect.height;
          const crop = sourceCropFromDisplayDrag(
            drag.start,
            point,
            { width: rect.width, height: rect.height },
            { width: sourceWidth, height: sourceHeight },
          );
          if (crop !== null && draftLayers.length < 8) {
            if (builderMode === 'prompted') {
              const token = pendingPromptTokenRef.current + 1;
              pendingPromptTokenRef.current = token;
              promptAttemptRef.current += 1;
              setRedrawingPrompt(false);
              setPendingPrompt({ crop, token, status: 'ready' });
            } else setDraftLayers((current) => [...current, { kind: 'source-region-v1', crop }]);
          }
          setSelectedCandidates([]);
        } else {
          const picked = selectMarqueeCandidates(
            finalMarquee,
            visibleCandidates.filter(
              (candidate) =>
                !draftLayers.some(
                  (layer) =>
                    layer.kind === 'sam-candidate-group-v1' &&
                    layer.candidateIds.includes(candidate.candidateId),
                ),
            ) ?? [],
            rect.width,
            rect.height,
            state.selection?.width ?? rect.width,
            state.selection?.height ?? rect.height,
          );
          const merged = drag.additive ? [...new Set([...drag.baseline, ...picked])] : picked;
          setSelectedCandidates(
            merged.toSorted(
              (left, right) =>
                (uploadedOperation?.candidates.find((candidate) => candidate.candidateId === left)
                  ?.order ?? 0) -
                (uploadedOperation?.candidates.find((candidate) => candidate.candidateId === right)
                  ?.order ?? 0),
            ),
          );
        }
      }
    }
    suppressClickRef.current = cancelled ? false : drag.dragging;
    dragRef.current = null;
    setMarquee(null);
    if (stageRef.current?.hasPointerCapture(event.pointerId))
      stageRef.current.releasePointerCapture(event.pointerId);
  };

  useEffect(
    () => () => {
      if (previewUrlRef.current !== null) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const clearPreview = () => {
    if (previewUrlRef.current !== null) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    fileRef.current = null;
  };

  const nextRequestRevision = (): number => {
    requestRevisionRef.current += 1;
    return requestRevisionRef.current;
  };

  const selectFile = async (file: File | undefined): Promise<void> => {
    const requestRevision = nextRequestRevision();
    setUploadedOperation(null);
    setSelectedCandidates([]);
    setDraftLayers([]);
    setPendingPrompt(null);
    setRedrawingPrompt(false);
    pendingPromptTokenRef.current += 1;
    promptAttemptRef.current += 1;
    promptInFlightRef.current = null;
    setPromptedCutouts(new Map());
    setShowSmallFragments(false);
    setBuilderMode('candidates');
    setComposeError(null);
    setUploadProvenance(VERIFIED_REPLAY_PROVENANCE);
    clearPreview();
    if (file === undefined) {
      dispatch({ type: 'selection_cleared', requestRevision });
      return;
    }

    dispatch({ type: 'selection_started', requestRevision });
    const previewUrl = URL.createObjectURL(file);
    try {
      const selection = await inspectBrowserRasterUpload(file, previewUrl);
      if (requestRevisionRef.current !== requestRevision) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      previewUrlRef.current = previewUrl;
      fileRef.current = file;
      dispatch({ type: 'selection_succeeded', requestRevision, selection });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      if (requestRevisionRef.current !== requestRevision) return;
      dispatch({
        type: 'selection_failed',
        requestRevision,
        message: messageFrom(error, 'The selected image could not be validated.'),
      });
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    void selectFile(file);
  };

  const analyze = async (): Promise<void> => {
    const file = fileRef.current;
    if (file === null || state.selection === null) return;
    const requestRevision = nextRequestRevision();
    dispatch({ type: 'analysis_started', requestRevision });
    try {
      const operation = await requestUploadedBannerOperation(file);
      if (requestRevisionRef.current !== requestRevision) return;
      setUploadedOperation(operation);
      setSelectedCandidates([]);
      setDraftLayers([]);
      setPendingPrompt(null);
      setRedrawingPrompt(false);
      pendingPromptTokenRef.current += 1;
      promptAttemptRef.current += 1;
      promptInFlightRef.current = null;
      setPromptedCutouts(new Map());
      setShowSmallFragments(false);
      setBuilderMode('candidates');
      setComposeError(null);
      setUploadProvenance(operation.provenance);
      if (requestRevisionRef.current !== requestRevision) return;
      dispatch({ type: 'uploaded_succeeded', requestRevision });
    } catch (error) {
      if (requestRevisionRef.current !== requestRevision) return;
      setUploadedOperation(null);
      dispatch({
        type: 'analysis_failed',
        requestRevision,
        message: messageFrom(error, 'The local fixture analysis could not be completed.'),
      });
    }
  };

  const busy = state.phase === 'validating' || state.phase === 'running';
  const assignedLayerFor = (candidateId: string): number | null => {
    const index = draftLayers.findIndex(
      (layer) =>
        layer.kind === 'sam-candidate-group-v1' && layer.candidateIds.includes(candidateId),
    );
    return index < 0 ? null : index + 1;
  };
  const createLayer = (): void => {
    if (selectedCandidates.length === 0) return;
    const order = uploadedOperation?.candidates.map((candidate) => candidate.candidateId) ?? [];
    const layer = [...selectedCandidates].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (
      layer.length > 8 ||
      draftLayers.length >= 8 ||
      layer.some((id) =>
        draftLayers.some(
          (existing) =>
            existing.kind === 'sam-candidate-group-v1' && existing.candidateIds.includes(id),
        ),
      )
    )
      return;
    setDraftLayers((current) => [
      ...current,
      { kind: 'sam-candidate-group-v1', candidateIds: layer },
    ]);
    setSelectedCandidates([]);
  };
  const generatePendingPrompt = async (): Promise<void> => {
    if (
      pendingPrompt === null ||
      pendingPrompt.status === 'generating' ||
      uploadedOperation === null
    )
      return;
    const token = pendingPrompt.token;
    const operationId = uploadedOperation.operationId;
    const requestRevision = requestRevisionRef.current;
    const attempt = ++promptAttemptRef.current;
    if (promptInFlightRef.current !== null) return;
    promptInFlightRef.current = attempt;
    setPendingPrompt({
      crop: pendingPrompt.crop,
      token: pendingPrompt.token,
      status: 'generating',
    });
    try {
      const prompted = await promptUploadedBannerCutout(operationId, pendingPrompt.crop);
      if (
        requestRevisionRef.current !== requestRevision ||
        uploadedOperation.operationId !== operationId ||
        token !== pendingPromptTokenRef.current ||
        promptAttemptRef.current !== attempt
      )
        return;
      if (draftLayers.length >= 8) {
        setPendingPrompt({
          crop: pendingPrompt.crop,
          token,
          status: 'failed',
          error: 'There is no available layer slot for this cutout.',
        });
        if (promptInFlightRef.current === attempt) promptInFlightRef.current = null;
        return;
      }
      setPromptedCutouts((map) => new Map(map).set(prompted.promptedId, prompted));
      setDraftLayers((current) => [
        ...current,
        { kind: 'prompted-cutout-v1', promptedId: prompted.promptedId },
      ]);
      setPendingPrompt(null);
      setRedrawingPrompt(false);
      setPromptAnnouncement('Manual cutout created.');
      if (promptInFlightRef.current === attempt) promptInFlightRef.current = null;
    } catch (error) {
      if (
        requestRevisionRef.current === requestRevision &&
        uploadedOperation.operationId === operationId &&
        token === pendingPromptTokenRef.current &&
        promptAttemptRef.current === attempt
      )
        setPendingPrompt({
          crop: pendingPrompt.crop,
          token,
          status: 'failed',
          error: messageFrom(error, 'The transparent cutout could not be generated.'),
        });
      if (promptInFlightRef.current === attempt) promptInFlightRef.current = null;
    }
  };
  const uploadControlCopy = getBannerAiUploadControlCopy(state);

  return (
    <main className="banner-shell">
      <nav className="product-nav" aria-label="Product navigation">
        <Link href="/">Fabrica Kit</Link>
        <span>Banner AI · local fixture</span>
      </nav>

      <header className="banner-hero">
        <div>
          <p className="eyebrow">Provider-free product foundation</p>
          <h1>See a banner as editable parts.</h1>
        </div>
        <p>
          Upload the authorized Samsung fixture PNG to open its stored verified Meta SAM 2.1 cutout
          replay. No provider call is made; other uploads are not currently supported.
        </p>
      </header>

      <section className="demo-project-entry" aria-labelledby="demo-project-entry-title">
        <div>
          <p className="section-kicker">Phase 2A · verified Meta SAM replay</p>
          <h2 id="demo-project-entry-title">Edit the verified Meta SAM replay demo</h2>
          <p>
            Open the development-only preserved/replayed validated real Meta SAM automatic candidate
            05, manually selected. There is no live call, Qwen box result, reconstruction, or
            product admission.
          </p>
        </div>
        <Link className="demo-project-link" href="/banner-ai/editor">
          Open approved demo project
        </Link>
      </section>

      <div className="banner-workspace">
        <section className="upload-card" aria-labelledby="source-image-title">
          <div className="card-heading">
            <div>
              <p className="section-kicker">01 · Source</p>
              <h2 id="source-image-title">Choose a banner image</h2>
            </div>
            <span className="local-badge">Local only</span>
          </div>

          <div className="file-control">
            <label htmlFor="banner-file">JPG or PNG image</label>
            <p id="banner-file-help">Maximum 20 MiB and 4096 px on either side.</p>
            <div className="file-picker">
              <input
                className="file-picker-input"
                id="banner-file"
                name="banner-file"
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                aria-describedby="banner-file-help banner-file-status"
                onChange={onFileChange}
                disabled={busy}
              />
              <label className="file-picker-button" htmlFor="banner-file">
                Choose image
              </label>
              <span
                className="file-picker-status"
                id="banner-file-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {uploadControlCopy.kind === 'filename' ? (
                  <bdi dir="auto">{uploadControlCopy.text}</bdi>
                ) : (
                  uploadControlCopy.text
                )}
              </span>
            </div>
          </div>

          {state.selection !== null ? (
            <div className="preview-panel">
              <BannerAiSourceImage
                selection={state.selection}
                result={state.result}
                review={state.layerReview}
              />
              <dl className="file-metadata">
                <div className="filename-row">
                  <dt>Filename</dt>
                  <dd>
                    <bdi dir="auto">{state.selection.filename}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {state.selection.width} × {state.selection.height} px
                  </dd>
                </div>
                <div>
                  <dt>Original size</dt>
                  <dd>{formatBytes(state.selection.originalByteSize)}</dd>
                </div>
                <div>
                  <dt>Declared type</dt>
                  <dd>{state.selection.mediaType}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="empty-preview" aria-hidden="true">
              <span>JPG</span>
              <span>PNG</span>
              <p>Your selected image preview will appear here.</p>
            </div>
          )}

          <div className="analysis-action">
            <div>
              <strong>Verified Samsung cutout replay</strong>
              <span>
                Only the exact authorized Samsung fixture is supported locally: eight stored Meta
                SAM 2.1 cutouts, with no live provider call. The server revalidates every byte.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={state.selection === null || busy}
            >
              {state.phase === 'running'
                ? 'Generating candidates…'
                : 'Generate verified Samsung cutouts'}
            </button>
          </div>

          {uploadedOperation !== null ? (
            <section
              aria-labelledby="uploaded-candidates-title"
              className="editor-candidate-picker"
            >
              <p className="section-kicker">02 · Layers</p>
              <h2 id="uploaded-candidates-title">Build editable layers</h2>
              <p>
                Suggested cutouts first. Drag across the image to select cutouts for the next layer.
              </p>
              <p>{quality.suggested.length} suggested cutouts shown first.</p>
              {quality.suggested.length === 0 ? (
                <p>
                  No suggested cutouts were found. Draw a source region or reveal small fragments.
                </p>
              ) : null}
              {quality.smallFragments.length > 0 ? (
                <button
                  type="button"
                  disabled={composeBusy || promptGenerating}
                  onClick={() => {
                    if (showSmallFragments) {
                      const visibleIds = new Set(
                        quality.suggested.map((candidate) => candidate.candidateId),
                      );
                      setSelectedCandidates((selected) =>
                        selected.filter((id) => visibleIds.has(id)),
                      );
                    }
                    setShowSmallFragments(!showSmallFragments);
                  }}
                >
                  {showSmallFragments
                    ? `Hide ${quality.smallFragments.length} small fragments`
                    : `Show ${quality.smallFragments.length} small fragments`}
                </button>
              ) : null}
              <div role="group" aria-label="Layer creation mode">
                <button
                  type="button"
                  aria-pressed={builderMode === 'candidates'}
                  disabled={composeBusy || promptGenerating}
                  onClick={() => setBuilderMode('candidates')}
                >
                  Select cutouts
                </button>
                <button
                  type="button"
                  aria-pressed={builderMode === 'region'}
                  disabled={composeBusy || promptGenerating}
                  onClick={() => setBuilderMode('region')}
                >
                  Draw source region
                </button>
                <button
                  type="button"
                  aria-pressed={builderMode === 'prompted'}
                  disabled={composeBusy || promptGenerating}
                  onClick={() => setBuilderMode('prompted')}
                >
                  Draw transparent cutout
                </button>
              </div>
              <p>{uploadedOperation.provenance}</p>
              <div
                ref={stageRef}
                className={`candidate-composer-stage${builderMode !== 'candidates' ? ' source-region-mode' : ''}`}
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={finishStagePointer}
                onPointerCancel={(event) => finishStagePointer(event, true)}
                onLostPointerCapture={(event) => finishStagePointer(event, true)}
                onClick={(event) => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  if (!(event.target as HTMLElement).closest('.candidate-hotspot'))
                    setSelectedCandidates([]);
                }}
                style={{
                  aspectRatio: `${state.selection?.width ?? 1} / ${state.selection?.height ?? 1}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={state.selection?.previewUrl} alt="Uploaded banner" draggable={false} />
                {builderMode === 'candidates'
                  ? visibleCandidates
                      .filter((candidate) => selectedCandidates.includes(candidate.candidateId))
                      .map((candidate) => (
                        <div
                          key={`silhouette-${candidate.candidateId}`}
                          className="candidate-silhouette"
                          aria-hidden="true"
                          style={{
                            left: `${(candidate.crop.left / candidate.source.width) * 100}%`,
                            top: `${(candidate.crop.top / candidate.source.height) * 100}%`,
                            width: `${(candidate.crop.width / candidate.source.width) * 100}%`,
                            height: `${(candidate.crop.height / candidate.source.height) * 100}%`,
                            maskImage: `url(${candidate.thumbnail.dataUrl})`,
                            WebkitMaskImage: `url(${candidate.thumbnail.dataUrl})`,
                          }}
                        />
                      ))
                  : null}
                {visibleCandidates.map((candidate) => {
                  const checked = selectedCandidates.includes(candidate.candidateId);
                  const assigned = assignedLayerFor(candidate.candidateId);
                  const { crop, source } = candidate;
                  return (
                    <button
                      key={candidate.candidateId}
                      type="button"
                      className={
                        assigned !== null
                          ? 'candidate-hotspot assigned'
                          : checked
                            ? 'candidate-hotspot selected'
                            : 'candidate-hotspot'
                      }
                      style={{
                        left: `${(crop.left / source.width) * 100}%`,
                        top: `${(crop.top / source.height) * 100}%`,
                        width: `${(crop.width / source.width) * 100}%`,
                        height: `${(crop.height / source.height) * 100}%`,
                        zIndex: candidate.order,
                      }}
                      aria-label={`Candidate ${candidate.order}${assigned !== null ? ` assigned to Layer ${assigned}` : ''}`}
                      aria-pressed={checked}
                      disabled={
                        builderMode !== 'candidates' ||
                        assigned !== null ||
                        composeBusy ||
                        promptGenerating
                      }
                      onClick={() =>
                        builderMode === 'candidates' &&
                        setSelectedCandidates((current) =>
                          checked
                            ? current.filter((id) => id !== candidate.candidateId)
                            : [...current, candidate.candidateId],
                        )
                      }
                    >
                      <span>{candidate.order}</span>
                    </button>
                  );
                })}
                {builderMode !== 'candidates' && marquee !== null ? (
                  <div
                    className="candidate-marquee"
                    style={{
                      left: marquee.left,
                      top: marquee.top,
                      width: marquee.width,
                      height: marquee.height,
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <div className="candidate-selection-summary" aria-live="polite">
                <strong>
                  {builderMode === 'region'
                    ? 'Drag a source region to add an opaque layer immediately'
                    : builderMode === 'prompted'
                      ? 'Draw a box, then generate a transparent cutout'
                      : `${selectedCandidates.length} cutouts selected for the next layer`}
                </strong>
                <span>
                  {builderMode === 'region'
                    ? 'The opaque source-region layer is added on pointer release.'
                    : builderMode === 'prompted'
                      ? 'The crop remains pending until you generate it.'
                      : 'Click a marker to toggle it, or use the checkboxes below.'}
                </span>
                {selectedCandidates.length > 0 ? (
                  <button
                    type="button"
                    disabled={composeBusy || promptGenerating}
                    onClick={() => setSelectedCandidates([])}
                  >
                    Clear selection
                  </button>
                ) : null}
              </div>
              <div className="editor-candidate-choice">
                {visibleCandidates.map((candidate) => {
                  const checked = selectedCandidates.includes(candidate.candidateId);
                  const assigned = assignedLayerFor(candidate.candidateId);
                  return (
                    <label key={candidate.candidateId} className={checked ? 'selected' : ''}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={candidate.thumbnail.dataUrl} alt={`Candidate ${candidate.order}`} />
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={
                          builderMode !== 'candidates' ||
                          assigned !== null ||
                          composeBusy ||
                          promptGenerating
                        }
                        onChange={() =>
                          builderMode === 'candidates' &&
                          setSelectedCandidates((current) =>
                            checked
                              ? current.filter((id) => id !== candidate.candidateId)
                              : [...current, candidate.candidateId],
                          )
                        }
                      />{' '}
                      Candidate {candidate.order}
                      {assigned !== null ? ` · Assigned to Layer ${assigned}` : ''}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={
                  builderMode !== 'candidates' ||
                  selectedCandidates.length === 0 ||
                  composeBusy ||
                  promptGenerating
                }
                onClick={createLayer}
              >
                Create layer from {selectedCandidates.length} cutouts
              </button>
              {draftLayers.length > 0 || pendingPrompt !== null ? (
                <div className="created-layer-list" aria-label="Created layers">
                  {pendingPrompt !== null ? (
                    <div
                      className="created-layer-card"
                      role={pendingPrompt.status === 'failed' ? 'alert' : undefined}
                    >
                      <strong>
                        {redrawingPrompt
                          ? 'Redraw transparent cutout'
                          : 'Pending transparent cutout'}
                      </strong>
                      <span>
                        {pendingPrompt.crop.left},{pendingPrompt.crop.top} ·{' '}
                        {pendingPrompt.crop.width}×{pendingPrompt.crop.height}
                      </span>
                      {pendingPrompt.error ? <span>{pendingPrompt.error}</span> : null}
                      <button
                        aria-label={
                          pendingPrompt.status === 'failed'
                            ? 'Retry transparent cutout'
                            : 'Generate transparent cutout'
                        }
                        type="button"
                        disabled={
                          pendingPrompt.status === 'generating' || composeBusy || promptGenerating
                        }
                        onClick={() => void generatePendingPrompt()}
                      >
                        {pendingPrompt.status === 'failed'
                          ? 'Retry'
                          : 'Generate transparent cutout'}
                      </button>
                      <button
                        aria-label="Redraw transparent cutout"
                        type="button"
                        disabled={
                          pendingPrompt.status === 'generating' || composeBusy || promptGenerating
                        }
                        onClick={() => {
                          promptAttemptRef.current += 1;
                          promptInFlightRef.current = null;
                          setRedrawingPrompt(true);
                          setBuilderMode('prompted');
                        }}
                      >
                        Redraw
                      </button>
                      <button
                        aria-label="Remove pending transparent cutout"
                        type="button"
                        disabled={
                          pendingPrompt.status === 'generating' || composeBusy || promptGenerating
                        }
                        onClick={() => {
                          promptAttemptRef.current += 1;
                          pendingPromptTokenRef.current += 1;
                          promptInFlightRef.current = null;
                          setPendingPrompt(null);
                          setRedrawingPrompt(false);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : null}
                  {draftLayers.map((layer, index) => (
                    <div className="created-layer-card" key={`${layer.kind}-${index}`}>
                      <strong>
                        {layer.kind === 'source-region-v1'
                          ? `Source region ${index + 1} · opaque crop`
                          : layer.kind === 'prompted-cutout-v1'
                            ? `Manual cutout ${index + 1}`
                            : `Layer ${index + 1}`}
                      </strong>
                      {layer.kind === 'prompted-cutout-v1' &&
                      promptedCutouts.get(layer.promptedId) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={promptedCutouts.get(layer.promptedId)!.thumbnail.dataUrl}
                          alt={`Manual cutout ${index + 1}`}
                        />
                      ) : null}
                      <span>
                        {layer.kind === 'source-region-v1'
                          ? `${layer.crop.left},${layer.crop.top} · ${layer.crop.width}×${layer.crop.height}`
                          : layer.kind === 'prompted-cutout-v1'
                            ? `Manual cutout ${index + 1}`
                            : layer.candidateIds
                                .map(
                                  (id) =>
                                    `Candidate ${uploadedOperation.candidates.find((candidate) => candidate.candidateId === id)?.order ?? '?'}`,
                                )
                                .join(', ')}
                      </span>
                      <button
                        type="button"
                        disabled={composeBusy || promptGenerating}
                        aria-label={`Remove Layer ${index + 1}`}
                        onClick={() =>
                          setDraftLayers((current) => current.filter((_, i) => i !== index))
                        }
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={composeBusy || promptGenerating || index === 0}
                        aria-label={`Move Layer ${index + 1} up`}
                        onClick={() =>
                          setDraftLayers((current) => {
                            const next = [...current];
                            [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                            return next;
                          })
                        }
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={
                          composeBusy || promptGenerating || index === draftLayers.length - 1
                        }
                        aria-label={`Move Layer ${index + 1} down`}
                        onClick={() =>
                          setDraftLayers((current) => {
                            const next = [...current];
                            [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                            return next;
                          })
                        }
                      >
                        Move down
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div aria-live="polite" className="sr-only">
                {promptAnnouncement}
              </div>
              {composeError !== null ? <p role="alert">{composeError}</p> : null}
              <button
                type="button"
                disabled={
                  draftLayers.length === 0 ||
                  pendingPrompt !== null ||
                  selectedCandidates.length > 0 ||
                  composeBusy ||
                  promptGenerating
                }
                onClick={async () => {
                  const composeRevision = requestRevisionRef.current;
                  const composeOperationId = uploadedOperation.operationId;
                  setComposeBusy(true);
                  setComposeError(null);
                  try {
                    const layers: readonly UploadedMixedLayer[] = draftLayers;
                    const { subjectId } = await composeUploadedBannerMixedLayers(
                      uploadedOperation.operationId,
                      layers,
                    );
                    if (
                      requestRevisionRef.current !== composeRevision ||
                      uploadedOperation.operationId !== composeOperationId
                    )
                      return;
                    window.location.assign(
                      `/banner-ai/editor?operation=${encodeURIComponent(uploadedOperation.operationId)}&subject=${encodeURIComponent(subjectId)}`,
                    );
                  } catch (error) {
                    if (requestRevisionRef.current !== composeRevision) return;
                    setComposeError(messageFrom(error, 'The selected layers could not be opened.'));
                  } finally {
                    setComposeBusy(false);
                  }
                }}
              >
                {composeBusy
                  ? 'Opening layers…'
                  : `Continue with ${draftLayers.length} created layers`}
              </button>
            </section>
          ) : null}
        </section>

        <BannerAiStatusPanel
          phase={state.phase}
          ready={state.selection !== null}
          error={state.error?.message ?? null}
          result={state.result}
          review={state.layerReview}
          uploadProvenance={uploadProvenance}
          onSelectPart={(partKey) => dispatch({ type: 'layer_selected', partKey })}
          onSetPartIncluded={(partKey, included) =>
            dispatch({ type: 'layer_inclusion_set', partKey, included })
          }
          onSetPartVisible={(partKey, visible) =>
            dispatch({ type: 'layer_visibility_set', partKey, visible })
          }
        />
      </div>

      <aside className="persistence-note">
        <span aria-hidden="true">i</span>
        <p>
          <strong>Deliberately temporary.</strong> Refreshing or restarting discards the selected
          image and result. Persistence is deferred to a later milestone.
        </p>
      </aside>
    </main>
  );
}
