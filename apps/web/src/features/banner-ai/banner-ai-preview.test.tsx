import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BannerAiPreview, type BannerAiPreviewProps } from './banner-ai-preview';

const digest = 'b'.repeat(64);

const renderPreview = (overrides: Partial<BannerAiPreviewProps> = {}) =>
  renderToStaticMarkup(
    createElement(BannerAiPreview, {
      projectName: 'Provider-free Angel demo',
      sceneSha256: digest,
      status: 'not-requested',
      iframeSrc: null,
      reducedMotion: false,
      onPreview: () => {},
      onRetry: () => {},
      ...overrides,
    }),
  );

describe('isolated provider-free preview presentation', () => {
  it('renders an opaque-origin frame with the exact literal sandbox and a project-specific title', () => {
    const markup = renderPreview({
      projectName: 'Angel <demo>',
      status: 'running',
      progressBps: 5_500,
      iframeSrc: 'blob:https://local.invalid/preview-one',
      iframeInstanceId: 'preview-one',
    });

    expect(markup).toContain('title="Angel &lt;demo&gt; isolated preview"');
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).toContain('src="blob:https://local.invalid/preview-one"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).not.toContain('allow-same-origin');
    expect(markup).not.toContain('srcDoc');
    expect(markup).not.toMatch(/<iframe[^>]*\sallow=/);
    expect(markup).toContain('The isolated preview is playing · 55%.');
    expect(markup).toContain('<progress class="banner-preview-progress" max="10000" value="5500"');
  });

  it('keeps status updates bounded away from controls and explains reduced-motion behavior', () => {
    const markup = renderPreview({ status: 'completed', reducedMotion: true });

    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<p class="banner-operation-status" id="banner-preview-status" role="status" aria-live="polite" aria-atomic="true">[^<]*<\/p>/,
    );
    expect(markup).not.toMatch(/<section[^>]*aria-live/);
    expect(markup).toContain('Reduced motion is active, so the scene remains static.');
    expect(markup).toContain('<button type="button">Preview again</button>');
    expect(markup).toContain(digest);
  });

  it('renders a safe failure alert and a native retry control for the same digest', () => {
    const markup = renderPreview({
      status: 'failed',
      errorMessage: 'Preview bytes could not be loaded. Retry this scene.',
    });

    expect(markup).toContain('<div class="editor-operation-error" role="alert">');
    expect(markup).toContain('Preview bytes could not be loaded. Retry this scene.');
    expect(markup).toContain('<button type="button">Retry same scene digest</button>');
    expect(markup).toContain(digest);
    expect(markup).not.toContain('<iframe');
  });
});
