import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BannerAiExportPanel, type BannerAiExportPanelProps } from './banner-ai-export-panel';

const sceneDigest = 'c'.repeat(64);
const artifactDigest = 'd'.repeat(64);

const artifact = Object.freeze({
  filename: 'angel-demo.html5.zip',
  mediaType: 'application/zip' as const,
  byteSize: 12_288,
  sha256: artifactDigest,
  validationLabel: 'internal-provider-free-not-gdn' as const,
});

const validation = Object.freeze({
  validationLabel: 'internal-provider-free-not-gdn' as const,
  artifactSha256: artifactDigest,
  profile: {
    validatorProfileId: 'validator_profile_provider_free_internal_v1',
    validatorProfileVersion: 1,
    rulesSha256: 'e'.repeat(64),
  },
  outcome: 'internal-check-failed' as const,
  findings: [
    {
      ruleCode: 'ARCHIVE_ENTRY_REQUIRED',
      severity: 'error' as const,
      message: 'Add the required local runtime entry.',
      entryPath: 'runtime.js',
    },
    {
      ruleCode: 'MANIFEST_NOTICE',
      severity: 'warning' as const,
      message: 'Review the <internal> manifest notice.',
      entryPath: null,
    },
  ],
});

const renderPanel = (overrides: Partial<BannerAiExportPanelProps> = {}) =>
  renderToStaticMarkup(
    createElement(BannerAiExportPanel, {
      sceneSha256: sceneDigest,
      status: 'passed',
      artifact,
      validation,
      onGenerate: () => {},
      onRetry: () => {},
      onDownload: () => {},
      ...overrides,
    }),
  );

describe('deterministic export and internal-validator presentation', () => {
  it('labels the result without certification claims and renders exact download metadata', () => {
    const markup = renderPanel();

    expect(markup).toContain(
      'Validation scope: <strong>internal</strong>, <strong>provider-free</strong>, and <strong>not GDN certification</strong>.',
    );
    expect(markup).toContain('internal-provider-free-not-gdn');
    expect(markup).toContain('angel-demo.html5.zip');
    expect(markup).toContain('12.0 KiB');
    expect(markup).toContain(artifactDigest);
    expect(markup).toContain('<button class="editor-secondary-button" type="button">');
    expect(markup).toContain('Download angel-demo.html5.zip');
    expect(markup).not.toMatch(/GDN valid|Google approved/i);
  });

  it('links a semantic summary to every ordered actionable finding', () => {
    const markup = renderPanel();
    const firstFinding = markup.indexOf('id="banner-validator-finding-1"');
    const secondFinding = markup.indexOf('id="banner-validator-finding-2"');

    expect(markup).toContain(
      '<nav class="banner-finding-summary" aria-label="Validator finding summary">',
    );
    expect(markup).toContain('href="#banner-validator-finding-1"');
    expect(markup).toContain('href="#banner-validator-finding-2"');
    expect(markup).toContain('<ol class="banner-validator-findings">');
    expect(firstFinding).toBeGreaterThan(-1);
    expect(secondFinding).toBeGreaterThan(firstFinding);
    expect(markup).toContain('<strong>error</strong><code>ARCHIVE_ENTRY_REQUIRED</code>');
    expect(markup).toContain('Entry: <code>runtime.js</code>');
    expect(markup).toContain('Review the &lt;internal&gt; manifest notice.');
    expect(markup).not.toContain('<internal>');
    expect(markup).toContain('Return to the layer controls to change the scene');
  });

  it('renders an explicit zero-finding pass without inventing certification', () => {
    const markup = renderPanel({
      validation: {
        ...validation,
        outcome: 'internal-check-passed',
        findings: [],
      },
    });

    expect(markup).toContain('Internal checks passed');
    expect(markup).toContain('No validator findings were reported.');
    expect(markup).not.toContain('banner-finding-summary');
    expect(markup).toContain('It is not GDN certification.');
  });

  it('keeps an operational failure, retry control, accepted digest, and prior download visible', () => {
    const markup = renderPanel({
      status: 'failed',
      errorMessage: 'The local export could not be completed.',
    });

    expect(markup).toContain('<div class="editor-operation-error" role="alert">');
    expect(markup).toContain('The local export could not be completed.');
    expect(markup).toContain('<button type="button">Retry same scene digest</button>');
    expect(markup).toContain(sceneDigest);
    expect(markup).toContain('Download angel-demo.html5.zip');
    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(markup).not.toMatch(/<section[^>]*aria-live/);
  });
});
