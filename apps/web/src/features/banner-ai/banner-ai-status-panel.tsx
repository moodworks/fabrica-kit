import type { BannerAnalysisData } from './banner-ai-contract';
import type { BannerAiPhase } from './banner-ai-state';

const statusLabel = Object.freeze({
  idle: 'Idle',
  validating: 'Validating',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
} satisfies Record<BannerAiPhase, string>);

const statusCopy = (phase: BannerAiPhase, ready: boolean): string => {
  switch (phase) {
    case 'idle':
      return ready
        ? 'The image is ready for the local fixture.'
        : 'Select one JPG or PNG to begin.';
    case 'validating':
      return 'Validating the selected image and decoding its dimensions in this browser.';
    case 'running':
      return 'Running the trusted provider-free composition fixture.';
    case 'succeeded':
      return 'The local fixture returned a validated composition proposal.';
    case 'failed':
      return 'The current operation could not be completed.';
  }
};

const percent = (basisPoints: number): string => `${(basisPoints / 100).toFixed(0)}%`;

export interface BannerAiStatusPanelProps {
  readonly phase: BannerAiPhase;
  readonly ready: boolean;
  readonly error: string | null;
  readonly result: BannerAnalysisData | null;
}

export function BannerAiStatusPanel({ phase, ready, error, result }: BannerAiStatusPanelProps) {
  return (
    <section className="status-card" aria-labelledby="analysis-status-title" aria-live="polite">
      <div className="status-heading">
        <div>
          <p className="section-kicker">Analysis state</p>
          <h2 id="analysis-status-title">{statusLabel[phase]}</h2>
        </div>
        <span className={`status-dot status-dot-${phase}`} aria-hidden="true" />
      </div>
      <p className="status-copy">{statusCopy(phase, ready)}</p>

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

      {phase === 'succeeded' && result !== null ? (
        <div className="result-panel">
          <div className="result-heading">
            <div>
              <p className="section-kicker">Fixture proposal</p>
              <h3>Proposed layers</h3>
            </div>
            <span>{result.proposal.parts.length} parts</span>
          </div>
          <ol className="layer-list">
            {result.proposal.parts.map((part, index) => (
              <li key={part.partKey}>
                <span className="layer-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="layer-name">{part.label}</span>
                <span className="layer-role">{part.role}</span>
                <span className="layer-bounds">
                  {percent(part.bounds.widthBps)} × {percent(part.bounds.heightBps)}
                </span>
              </li>
            ))}
          </ol>

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
