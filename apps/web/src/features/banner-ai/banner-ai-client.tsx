'use client';

import Link from 'next/link';
import { useEffect, useReducer, useRef, type ChangeEvent } from 'react';

import { requestLocalFixtureAnalysis } from './banner-ai-api';
import { BannerAiSourceImage } from './banner-ai-source-image';
import { BannerAiStatusPanel } from './banner-ai-status-panel';
import {
  bannerAiReducer,
  getBannerAiUploadControlCopy,
  initialBannerAiState,
} from './banner-ai-state';
import { inspectBrowserRasterUpload } from './browser-upload';

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

const messageFrom = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.length > 0 ? error.message : fallback;

export function BannerAiClient() {
  const [state, dispatch] = useReducer(bannerAiReducer, initialBannerAiState);
  const fileRef = useRef<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const requestRevisionRef = useRef(0);

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
      const result = await requestLocalFixtureAnalysis(file);
      if (requestRevisionRef.current !== requestRevision) return;
      dispatch({ type: 'analysis_succeeded', requestRevision, result });
    } catch (error) {
      if (requestRevisionRef.current !== requestRevision) return;
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
          Upload one JPG or PNG. The trusted local boundary normalizes it, then an exact data-only
          fixture proposes the scene composition—without a model, provider key, database, network,
          or cost.
        </p>
      </header>

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
              <strong>Trusted local fixture</strong>
              <span>The server revalidates every byte before analysis.</span>
            </div>
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={state.selection === null || busy}
            >
              {state.phase === 'running' ? 'Analyzing…' : 'Analyze with local fixture'}
            </button>
          </div>
        </section>

        <BannerAiStatusPanel
          phase={state.phase}
          ready={state.selection !== null}
          error={state.error?.message ?? null}
          result={state.result}
          review={state.layerReview}
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
