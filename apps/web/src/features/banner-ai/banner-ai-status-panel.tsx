import type { BannerAnalysisData } from './banner-ai-contract';
import {
  getSelectedBannerLayerReview,
  type BannerLayerReviewState,
  type SelectedBannerLayerReview,
} from './banner-ai-layer-state';
import type { BannerAiPhase } from './banner-ai-state';

const statusLabel = Object.freeze({
  idle: 'Idle',
  validating: 'Validating',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
} satisfies Record<BannerAiPhase, string>);

export const bannerAiStatusCopy = (
  phase: BannerAiPhase,
  ready: boolean,
  provenance:
    | 'Deterministic test output — NOT SAM OUTPUT'
    | 'Verified Meta SAM 2.1 cutout replay — no live call' = 'Deterministic test output — NOT SAM OUTPUT',
): string => {
  const replay = provenance === 'Verified Meta SAM 2.1 cutout replay — no live call';
  switch (phase) {
    case 'idle':
      return ready
        ? replay
          ? 'The exact Samsung fixture is ready for stored verified Meta SAM 2.1 cutouts.'
          : 'The image is ready for bounded deterministic automatic candidates.'
        : 'Select one JPG or PNG to begin.';
    case 'validating':
      return 'Validating the selected image and decoding its dimensions in this browser.';
    case 'running':
      return replay
        ? 'Generating stored verified Meta SAM 2.1 cutouts — no live provider call.'
        : 'Generating bounded deterministic automatic candidates — NOT SAM OUTPUT.';
    case 'succeeded':
      return replay
        ? 'Stored verified Meta SAM 2.1 cutouts are ready — no live provider call.'
        : 'Deterministic automatic candidates are ready — NOT SAM OUTPUT.';
    case 'failed':
      return 'The current operation could not be completed.';
  }
};

const percent = (basisPoints: number): string => `${(basisPoints / 100).toFixed(0)}%`;

const exactBound = (basisPoints: number): string =>
  `${basisPoints.toLocaleString('en-US')} bps (${(basisPoints / 100).toFixed(2)}%)`;

const futureSceneEffect = ({ part, state }: SelectedBannerLayerReview): string => {
  if (part.role === 'background') {
    return state.included
      ? 'Future-scene intent: include this fixture background as a canvas background candidate.'
      : 'Future-scene intent: omit this fixture background from the future composition.';
  }
  if (!state.included) {
    return `Future-scene intent: exclude this proposed layer while retaining its ${state.visible === true ? 'visible' : 'hidden'} setting in memory.`;
  }
  return state.visible === true
    ? 'Future-scene intent: include and show this proposed layer.'
    : 'Future-scene intent: include this proposed layer but keep it hidden.';
};

export interface BannerAiStatusPanelProps {
  readonly phase: BannerAiPhase;
  readonly ready: boolean;
  readonly error: string | null;
  readonly result: BannerAnalysisData | null;
  readonly review: BannerLayerReviewState | null;
  readonly uploadProvenance?:
    | 'Deterministic test output — NOT SAM OUTPUT'
    | 'Verified Meta SAM 2.1 cutout replay — no live call';
  readonly onSelectPart: (partKey: string) => void;
  readonly onSetPartIncluded: (partKey: string, included: boolean) => void;
  readonly onSetPartVisible: (partKey: string, visible: boolean) => void;
}

export function BannerAiStatusPanel({
  phase,
  ready,
  error,
  result,
  review,
  uploadProvenance,
  onSelectPart,
  onSetPartIncluded,
  onSetPartVisible,
}: BannerAiStatusPanelProps) {
  const selected = getSelectedBannerLayerReview(result, review);

  return (
    <section className="status-card" aria-labelledby="analysis-status-title">
      <div className="status-heading">
        <div>
          <p className="section-kicker">Analysis state</p>
          <h2 id="analysis-status-title">{statusLabel[phase]}</h2>
        </div>
        <span className={`status-dot status-dot-${phase}`} aria-hidden="true" />
      </div>
      <p className="status-copy" role="status" aria-live="polite" aria-atomic="true">
        {bannerAiStatusCopy(phase, ready, uploadProvenance)}
      </p>

      {phase === 'validating' || phase === 'running' ? (
        <div className="progress-track" aria-label={`${statusLabel[phase]} in progress`}>
          <span />
        </div>
      ) : null}

      {phase === 'failed' && error !== null ? (
        <div className="error-alert" role="alert">
          <strong>{error}</strong>
          <span>Choose another image or retry the local fixture.</span>
        </div>
      ) : null}

      {phase === 'succeeded' && result !== null && review !== null ? (
        <div className="result-panel">
          <div className="result-heading">
            <div>
              <p className="section-kicker">Deterministic test output — NOT SAM OUTPUT</p>
              <h3>Candidate layer controls</h3>
            </div>
            <span>{result.proposal.parts.length} parts</span>
          </div>

          <fieldset className="layer-review" aria-describedby="fixture-layer-review-description">
            <legend>Provider-free fixture layer controls</legend>
            <p className="layer-review-description" id="fixture-layer-review-description">
              Temporary deterministic integration previews exist for these proposed boxes; no
              BannerScene or persisted layer asset has been created.
            </p>
            <ol className="layer-list">
              {result.proposal.parts.map((part, index) => {
                const partState = review.parts.find(
                  (candidate) => candidate.partKey === part.partKey,
                );
                if (partState === undefined) return null;
                const selectId = `fixture-part-select-${index}`;
                const inclusionId = `fixture-part-included-${index}`;
                const visibilityId = `fixture-part-visible-${index}`;
                const isSelected = review.selectedPartKey === part.partKey;

                return (
                  <li
                    className={isSelected ? 'layer-row layer-row-selected' : 'layer-row'}
                    key={part.partKey}
                  >
                    <div className="layer-selection-control">
                      <input
                        className="layer-select-input"
                        id={selectId}
                        name="provider-free-fixture-selected-part"
                        type="radio"
                        checked={isSelected}
                        aria-label={`Select ${part.label} provider-free fixture part`}
                        onChange={() => onSelectPart(part.partKey)}
                      />
                      <label className="layer-select-label" htmlFor={selectId}>
                        <span className="layer-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="layer-name">{part.label}</span>
                        <span className="layer-role">{part.role}</span>
                        <span className="layer-bounds">
                          {percent(part.bounds.widthBps)} × {percent(part.bounds.heightBps)}
                        </span>
                        {part.role !== 'background' ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- bounded deterministic data URL preview */}
                            <img
                              className="layer-cutout-preview"
                              src={
                                result.extraction.previews.find(
                                  (preview) => preview.partKey === part.partKey,
                                )?.dataUrl
                              }
                              alt={`${part.label} deterministic fake integration preview`}
                              width={80}
                              height={80}
                            />
                          </>
                        ) : null}
                      </label>
                    </div>
                    <div className="layer-control-set">
                      <div className="layer-toggle-control">
                        <input
                          className="layer-toggle-input"
                          id={inclusionId}
                          type="checkbox"
                          checked={partState.included}
                          onChange={(event) =>
                            onSetPartIncluded(part.partKey, event.currentTarget.checked)
                          }
                        />
                        <label className="layer-toggle-label" htmlFor={inclusionId}>
                          Include {part.label} in future scene
                        </label>
                      </div>
                      {partState.visible === null ? (
                        <span className="layer-visibility-na">
                          Visibility N/A · canvas background
                        </span>
                      ) : (
                        <div className="layer-toggle-control">
                          <input
                            className="layer-toggle-input"
                            id={visibilityId}
                            type="checkbox"
                            checked={partState.visible}
                            onChange={(event) =>
                              onSetPartVisible(part.partKey, event.currentTarget.checked)
                            }
                          />
                          <label className="layer-toggle-label" htmlFor={visibilityId}>
                            Show {part.label} in future scene
                          </label>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </fieldset>

          {selected === null ? null : (
            <section className="layer-inspector" aria-labelledby="selected-fixture-part-title">
              <div className="layer-inspector-heading">
                <div>
                  <p className="section-kicker">Selected fixture metadata</p>
                  <h4 id="selected-fixture-part-title">{selected.part.label}</h4>
                </div>
                <span>In memory</span>
              </div>
              <dl>
                <div>
                  <dt>Part key</dt>
                  <dd className="digest">{selected.part.partKey}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd className="capitalize">{selected.part.role}</dd>
                </div>
                <div>
                  <dt>Included</dt>
                  <dd>{selected.state.included ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt>Visible</dt>
                  <dd>
                    {selected.state.visible === null
                      ? 'N/A · canvas background'
                      : selected.state.visible
                        ? 'Yes'
                        : 'No'}
                  </dd>
                </div>
                <div>
                  <dt>X</dt>
                  <dd>{exactBound(selected.part.bounds.xBps)}</dd>
                </div>
                <div>
                  <dt>Y</dt>
                  <dd>{exactBound(selected.part.bounds.yBps)}</dd>
                </div>
                <div>
                  <dt>Width</dt>
                  <dd>{exactBound(selected.part.bounds.widthBps)}</dd>
                </div>
                <div>
                  <dt>Height</dt>
                  <dd>{exactBound(selected.part.bounds.heightBps)}</dd>
                </div>
              </dl>
              <p className="future-scene-effect">
                {futureSceneEffect(selected)} Integration preview generated from the proposed box
                using a deterministic fake mask; not real SAM output or segmentation-quality
                evidence. No BannerScene or persisted layer asset has been created.
              </p>
            </section>
          )}

          <dl className="provenance-grid">
            <div>
              <dt>Normalized source</dt>
              <dd>
                {result.source.width} × {result.source.height} PNG
              </dd>
            </div>
            <div>
              <dt>Source type</dt>
              <dd>{result.source.sourceMediaType}</dd>
            </div>
            <div>
              <dt>Fixture model</dt>
              <dd>{result.provenance.fixture.modelKey}</dd>
            </div>
            <div>
              <dt>Workflow</dt>
              <dd>v{result.provenance.workflow.workflowVersion}</dd>
            </div>
            <div>
              <dt>External / network</dt>
              <dd>No / disabled</dd>
            </div>
            <div>
              <dt>Estimated cost</dt>
              <dd>
                {result.provenance.estimatedCostMicros} micros {result.provenance.currency}
              </dd>
            </div>
            <div>
              <dt>Ownership</dt>
              <dd>Development-local</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{result.provenance.elapsedMs.toFixed(1)} ms</dd>
            </div>
          </dl>
          <details className="technical-details">
            <summary>Technical provenance</summary>
            <dl>
              <div>
                <dt>Normalized bytes</dt>
                <dd>{result.source.normalizedByteSize.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd className="digest">{result.source.sha256}</dd>
              </div>
              <div>
                <dt>Workflow ID</dt>
                <dd className="digest">{result.provenance.workflow.workflowVersionId}</dd>
              </div>
              <div>
                <dt>Request ID</dt>
                <dd className="digest">{result.provenance.ownership.requestId}</dd>
              </div>
            </dl>
          </details>
        </div>
      ) : null}
    </section>
  );
}
