import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import { BannerAiStatusPanel } from './banner-ai-status-panel';

const renderStatus = (phase: 'idle' | 'validating' | 'running' | 'succeeded' | 'failed') =>
  renderToStaticMarkup(
    createElement(BannerAiStatusPanel, {
      phase,
      ready: phase !== 'idle',
      error: phase === 'failed' ? 'Fixture failure is visible.' : null,
      result: phase === 'succeeded' ? sampleBannerAnalysisData : null,
    }),
  );

describe('Banner AI status rendering', () => {
  it.each([
    ['idle', 'Idle'],
    ['validating', 'Validating'],
    ['running', 'Running'],
  ] as const)('renders the %s state', (phase, label) => {
    expect(renderStatus(phase)).toContain(`>${label}</h2>`);
  });

  it('renders all four successful fixture layers', () => {
    const markup = renderStatus('succeeded');
    expect(markup).toContain('>Succeeded</h2>');
    for (const label of ['Background', 'Angel body', 'Left wing', 'Right wing']) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('No / disabled');
    expect(markup).toContain('0 micros USD');
    expect(markup).toContain('<details class="technical-details">');
    expect(markup).not.toMatch(/<details\b[^>]*\bopen(?:=|[\s>])/);
  });

  it('renders failure copy in an accessible alert', () => {
    const markup = renderStatus('failed');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Fixture failure is visible.');
  });
});
