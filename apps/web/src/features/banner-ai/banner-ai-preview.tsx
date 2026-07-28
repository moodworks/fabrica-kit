import type { Ref } from 'react';

export type BannerAiPreviewStatus =
  'not-requested' | 'loading' | 'ready' | 'running' | 'completed' | 'failed';

export interface BannerAiPreviewProps {
  readonly projectName: string;
  readonly sceneSha256: string;
  readonly status: BannerAiPreviewStatus;
  readonly iframeSrc: string | null;
  readonly iframeInstanceId?: string;
  readonly iframeRef?: Ref<HTMLIFrameElement>;
  readonly progressBps?: number | null;
  readonly errorMessage?: string | null | undefined;
  readonly reducedMotion: boolean;
  readonly disabled?: boolean;
  readonly onPreview: () => void;
  readonly onRetry: () => void;
  readonly onIframeLoad?: () => void;
}

const previewStatusCopy = (
  status: BannerAiPreviewStatus,
  progressBps: number | null | undefined,
): string => {
  switch (status) {
    case 'not-requested':
      return 'Preview has not been requested for this accepted scene.';
    case 'loading':
      return 'Preparing an isolated preview for this accepted scene.';
    case 'ready':
      return 'The isolated preview is ready.';
    case 'running':
      return `The isolated preview is playing${
        progressBps === null || progressBps === undefined
          ? '.'
          : ` · ${(progressBps / 100).toFixed(0)}%.`
      }`;
    case 'completed':
      return 'The isolated preview completed.';
    case 'failed':
      return 'The isolated preview could not be completed. The accepted scene is unchanged.';
  }
};

const previewButtonCopy = (status: BannerAiPreviewStatus): string => {
  switch (status) {
    case 'not-requested':
      return 'Preview accepted scene';
    case 'loading':
      return 'Preparing preview…';
    case 'ready':
    case 'running':
      return 'Preview in progress…';
    case 'completed':
      return 'Preview again';
    case 'failed':
      return 'Preview accepted scene';
  }
};

export function BannerAiPreview({
  projectName,
  sceneSha256,
  status,
  iframeSrc,
  iframeInstanceId,
  iframeRef,
  progressBps,
  errorMessage = null,
  reducedMotion,
  disabled = false,
  onPreview,
  onRetry,
  onIframeLoad,
}: BannerAiPreviewProps) {
  const busy = status === 'loading' || status === 'ready' || status === 'running';
  const progressValue =
    status === 'completed' ? 10_000 : status === 'running' ? (progressBps ?? 0) : null;

  return (
    <section
      className="banner-preview-card"
      aria-labelledby="banner-preview-title"
      aria-busy={busy}
    >
      <div className="editor-section-heading">
        <div>
          <p className="section-kicker">Isolated preview</p>
          <h2 id="banner-preview-title">Preview the accepted scene</h2>
        </div>
        <span>Opaque origin</span>
      </div>

      <p
        className="banner-operation-status"
        id="banner-preview-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {previewStatusCopy(status, progressBps)}
      </p>

      {progressValue === null ? null : (
        <progress
          className="banner-preview-progress"
          max="10000"
          value={progressValue}
          aria-label="Preview progress"
        />
      )}

      {status === 'failed' && errorMessage !== null ? (
        <div className="editor-operation-error" role="alert">
          <strong>Preview failed</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {iframeSrc === null ? (
        <div className="banner-preview-empty" aria-hidden="true">
          <span>300 × 200</span>
        </div>
      ) : (
        <div className="banner-preview-frame">
          <iframe
            key={iframeInstanceId}
            ref={iframeRef}
            src={iframeSrc}
            title={`${projectName} isolated preview`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            aria-describedby="banner-preview-boundary banner-preview-status"
            onLoad={onIframeLoad}
          />
        </div>
      )}

      <p className="banner-preview-boundary" id="banner-preview-boundary">
        The frame has no same-origin, form, popup, navigation, download, or network permission.
        {reducedMotion
          ? ' Reduced motion is active, so the scene remains static.'
          : ' The animation completes within 2.4 seconds and becomes static under reduced motion.'}
      </p>

      <dl className="editor-identity-list">
        <div>
          <dt>Scene digest</dt>
          <dd className="digest">{sceneSha256}</dd>
        </div>
      </dl>

      <div className="editor-operation-actions">
        {status === 'failed' ? (
          <button type="button" onClick={onRetry} disabled={disabled}>
            Retry same scene digest
          </button>
        ) : (
          <button type="button" onClick={onPreview} disabled={disabled || busy}>
            {previewButtonCopy(status)}
          </button>
        )}
      </div>
    </section>
  );
}
