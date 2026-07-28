export type BannerAiExportStatus =
  'not-requested' | 'generating' | 'validating' | 'passed' | 'failed';

export interface BannerAiExportArtifactView {
  readonly filename: string;
  readonly mediaType: 'application/zip';
  readonly byteSize: number;
  readonly sha256: string;
  readonly validationLabel: 'internal-provider-free-not-gdn';
}

export interface BannerAiValidatorFindingView {
  readonly ruleCode: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly entryPath: string | null;
}

export interface BannerAiValidationResultView {
  readonly validationLabel: 'internal-provider-free-not-gdn';
  readonly artifactSha256: string;
  readonly profile: {
    readonly validatorProfileId: string;
    readonly validatorProfileVersion: number;
    readonly rulesSha256: string;
  };
  readonly outcome: 'internal-check-passed' | 'internal-check-failed';
  readonly findings: readonly BannerAiValidatorFindingView[];
}

export interface BannerAiExportPanelProps {
  readonly sceneSha256: string;
  readonly status: BannerAiExportStatus;
  readonly artifact: BannerAiExportArtifactView | null;
  readonly validation: BannerAiValidationResultView | null;
  readonly errorMessage?: string | null | undefined;
  readonly disabled?: boolean;
  readonly onGenerate: () => void;
  readonly onRetry: () => void;
  readonly onDownload: () => void;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
};

const exportStatusCopy = (status: BannerAiExportStatus): string => {
  switch (status) {
    case 'not-requested':
      return 'No export has been generated for this accepted scene.';
    case 'generating':
      return 'Generating the deterministic, self-contained HTML5 ZIP.';
    case 'validating':
      return 'Running the offline internal validator.';
    case 'passed':
      return 'Export completed. The offline internal validator result is shown below.';
    case 'failed':
      return 'Export or validation could not be completed. The accepted scene is unchanged.';
  }
};

const validationOutcomeCopy = (outcome: BannerAiValidationResultView['outcome']): string =>
  outcome === 'internal-check-passed' ? 'Internal checks passed' : 'Internal checks failed';

export function BannerAiExportPanel({
  sceneSha256,
  status,
  artifact,
  validation,
  errorMessage = null,
  disabled = false,
  onGenerate,
  onRetry,
  onDownload,
}: BannerAiExportPanelProps) {
  const busy = status === 'generating' || status === 'validating';

  return (
    <section className="banner-export-panel" aria-labelledby="banner-export-title" aria-busy={busy}>
      <div className="editor-section-heading">
        <div>
          <p className="section-kicker">Export and validation</p>
          <h2 id="banner-export-title">Create the HTML5 ZIP</h2>
        </div>
        <span>Local ZIP</span>
      </div>

      <p className="banner-operation-status" role="status" aria-live="polite" aria-atomic="true">
        {exportStatusCopy(status)}
      </p>

      <p className="banner-validation-scope">
        Validation scope: <strong>internal</strong>, <strong>provider-free</strong>, and{' '}
        <strong>not GDN certification</strong>.
      </p>

      {status === 'failed' && errorMessage !== null ? (
        <div className="editor-operation-error" role="alert">
          <strong>Export failed</strong>
          <span>{errorMessage}</span>
          <span>Retry uses the same accepted scene digest shown below.</span>
        </div>
      ) : null}

      <dl className="editor-identity-list banner-export-identities">
        <div>
          <dt>Scene digest</dt>
          <dd className="digest">{sceneSha256}</dd>
        </div>
        {artifact === null ? null : (
          <>
            <div>
              <dt>Download</dt>
              <dd>
                <bdi dir="auto">{artifact.filename}</bdi>
              </dd>
            </div>
            <div>
              <dt>ZIP size</dt>
              <dd>{formatBytes(artifact.byteSize)}</dd>
            </div>
            <div>
              <dt>ZIP digest</dt>
              <dd className="digest">{artifact.sha256}</dd>
            </div>
            <div>
              <dt>Artifact label</dt>
              <dd>{artifact.validationLabel}</dd>
            </div>
          </>
        )}
      </dl>

      <div className="editor-operation-actions">
        {status === 'failed' ? (
          <button type="button" onClick={onRetry} disabled={disabled}>
            Retry same scene digest
          </button>
        ) : (
          <button type="button" onClick={onGenerate} disabled={disabled || busy}>
            {status === 'generating'
              ? 'Generating ZIP…'
              : status === 'validating'
                ? 'Validating ZIP…'
                : 'Generate HTML5 ZIP'}
          </button>
        )}
        {artifact === null ? null : (
          <button className="editor-secondary-button" type="button" onClick={onDownload}>
            Download {artifact.filename}
          </button>
        )}
      </div>

      {validation === null ? null : (
        <section
          className="banner-validator-result"
          aria-labelledby="banner-validator-result-title"
        >
          <div className="banner-validator-heading">
            <div>
              <p className="section-kicker">Offline validator result</p>
              <h3 id="banner-validator-result-title">
                {validationOutcomeCopy(validation.outcome)}
              </h3>
            </div>
            <span>{validation.findings.length} findings</span>
          </div>

          <p>
            This result applies only to artifact <code>{validation.artifactSha256}</code> under the
            repository-owned internal profile. It is not GDN certification.
          </p>

          {validation.findings.length === 0 ? (
            <p className="banner-validator-empty">No validator findings were reported.</p>
          ) : (
            <>
              <nav className="banner-finding-summary" aria-label="Validator finding summary">
                <span>Jump to a finding:</span>
                <ol>
                  {validation.findings.map((finding, index) => (
                    <li key={`${finding.ruleCode}-${index}`}>
                      <a href={`#banner-validator-finding-${index + 1}`}>
                        {finding.severity} · {finding.ruleCode}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>

              <ol className="banner-validator-findings">
                {validation.findings.map((finding, index) => (
                  <li
                    id={`banner-validator-finding-${index + 1}`}
                    key={`${finding.ruleCode}-${index}`}
                  >
                    <div>
                      <strong>{finding.severity}</strong>
                      <code>{finding.ruleCode}</code>
                    </div>
                    <p>{finding.message}</p>
                    {finding.entryPath === null ? null : (
                      <p>
                        Entry: <code>{finding.entryPath}</code>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}

          <details className="banner-validator-identity">
            <summary>Validator identity</summary>
            <dl className="editor-identity-list">
              <div>
                <dt>Profile</dt>
                <dd>{validation.profile.validatorProfileId}</dd>
              </div>
              <div>
                <dt>Profile version</dt>
                <dd>{validation.profile.validatorProfileVersion}</dd>
              </div>
              <div>
                <dt>Rules digest</dt>
                <dd className="digest">{validation.profile.rulesSha256}</dd>
              </div>
              <div>
                <dt>Result label</dt>
                <dd>{validation.validationLabel}</dd>
              </div>
            </dl>
          </details>

          <p className="banner-validator-next-step">
            Return to the layer controls to change the scene, or retry an operational failure
            against the same accepted digest.
          </p>
        </section>
      )}
    </section>
  );
}
