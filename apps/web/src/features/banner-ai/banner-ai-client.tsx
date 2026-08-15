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
  composeUploadedBannerCandidates,
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

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

const messageFrom = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;
const VERIFIED_REPLAY_PROVENANCE = 'Verified Meta SAM 2.1 cutout replay — no live call' as const;

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
    const picked = selectMarqueeCandidates(
      next,
      uploadedOperation?.candidates ?? [],
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
        const picked = selectMarqueeCandidates(
          finalMarquee,
          uploadedOperation?.candidates ?? [],
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
              <h2 id="uploaded-candidates-title">Select cutout layers</h2>
              <p>Drag across the image to select layers. Shift-drag adds to the selection.</p>
              <p>{uploadedOperation.provenance}</p>
              <div
                ref={stageRef}
                className="candidate-composer-stage"
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
                {uploadedOperation.candidates.map((candidate) => {
                  const checked = selectedCandidates.includes(candidate.candidateId);
                  const { crop, source } = candidate;
                  return (
                    <button
                      key={candidate.candidateId}
                      type="button"
                      className={checked ? 'candidate-hotspot selected' : 'candidate-hotspot'}
                      style={{
                        left: `${(crop.left / source.width) * 100}%`,
                        top: `${(crop.top / source.height) * 100}%`,
                        width: `${(crop.width / source.width) * 100}%`,
                        height: `${(crop.height / source.height) * 100}%`,
                        zIndex: candidate.order,
                      }}
                      aria-label={`Candidate ${candidate.order}`}
                      aria-pressed={checked}
                      onClick={() =>
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
                {marquee !== null ? (
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
                  {selectedCandidates.length} of {uploadedOperation.candidates.length} layers
                  selected
                </strong>
                <span>Click a marker to toggle it, or use the checkboxes below.</span>
                {selectedCandidates.length > 0 ? (
                  <button type="button" onClick={() => setSelectedCandidates([])}>
                    Clear selection
                  </button>
                ) : null}
              </div>
              <div className="editor-candidate-choice">
                {uploadedOperation.candidates.map((candidate) => {
                  const checked = selectedCandidates.includes(candidate.candidateId);
                  return (
                    <label key={candidate.candidateId} className={checked ? 'selected' : ''}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={candidate.thumbnail.dataUrl} alt={`Candidate ${candidate.order}`} />
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedCandidates((current) =>
                            checked
                              ? current.filter((id) => id !== candidate.candidateId)
                              : [...current, candidate.candidateId],
                          )
                        }
                      />{' '}
                      Candidate {candidate.order}
                    </label>
                  );
                })}
              </div>
              {composeError !== null ? <p role="alert">{composeError}</p> : null}
              <button
                type="button"
                disabled={selectedCandidates.length === 0 || composeBusy}
                onClick={async () => {
                  const composeRevision = requestRevisionRef.current;
                  const composeOperationId = uploadedOperation.operationId;
                  setComposeBusy(true);
                  setComposeError(null);
                  try {
                    const { subjectId } = await composeUploadedBannerCandidates(
                      uploadedOperation.operationId,
                      selectedCandidates,
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
                {composeBusy ? 'Opening layers…' : 'Continue with selected layers'}
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
