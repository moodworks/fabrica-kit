import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import {
  bannerLayerReviewReducer,
  createBannerLayerReviewState,
  type BannerLayerReviewState,
} from './banner-ai-layer-state';
import { BannerAiStatusPanel } from './banner-ai-status-panel';

const noOp = () => {};

const renderStatus = (
  phase: 'idle' | 'validating' | 'running' | 'succeeded' | 'failed',
  review: BannerLayerReviewState | null = phase === 'succeeded'
    ? createBannerLayerReviewState(sampleBannerAnalysisData)
    : null,
) =>
  renderToStaticMarkup(
    createElement(BannerAiStatusPanel, {
      phase,
      ready: phase !== 'idle',
      error: phase === 'failed' ? 'Fixture failure is visible.' : null,
      result: phase === 'succeeded' ? sampleBannerAnalysisData : null,
      review,
      onSelectPart: noOp,
      onSetPartIncluded: noOp,
      onSetPartVisible: noOp,
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

  it('renders all successful fixture parts without claiming extraction', () => {
    const markup = renderStatus('succeeded');
    expect(markup).toContain('>Succeeded</h2>');
    for (const label of ['Background', 'Angel body', 'Left wing', 'Right wing']) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('Provider-free fixture proposal');
    expect(markup).toContain('Temporary, in-memory intent for a future scene only.');
    expect(markup).toContain('not a BannerScene, extracted assets, masks, or cutouts');
    expect(markup).toContain('No BannerScene or layer asset has been created.');
    expect(markup).toContain('No / disabled');
    expect(markup).toContain('0 micros USD');
    expect(markup).toContain('<details class="technical-details">');
    expect(markup).not.toMatch(/<details\b[^>]*\bopen(?:=|[\s>])/);
  });

  it('renders a named native radio group and explicit native toggle labels', () => {
    const markup = renderStatus('succeeded');

    expect(markup.match(/type="radio"/g)).toHaveLength(4);
    expect(markup.match(/name="provider-free-fixture-selected-part"/g)).toHaveLength(4);
    expect(markup.match(/type="checkbox"/g)).toHaveLength(7);
    expect(markup.match(/<input(?=[^>]*type="radio")(?=[^>]*checked="")[^>]*>/g)).toHaveLength(1);
    for (let index = 0; index < 4; index += 1) {
      expect(markup).toContain(`id="fixture-part-select-${index}"`);
      expect(markup).toContain(`for="fixture-part-select-${index}"`);
      expect(markup).toContain(`id="fixture-part-included-${index}"`);
      expect(markup).toContain(`for="fixture-part-included-${index}"`);
    }
    for (let index = 1; index < 4; index += 1) {
      expect(markup).toContain(`id="fixture-part-visible-${index}"`);
      expect(markup).toContain(`for="fixture-part-visible-${index}"`);
    }
    expect(markup).not.toContain('id="fixture-part-visible-0"');
    expect(markup).toContain('Visibility N/A · canvas background');
    expect(markup).not.toMatch(/id="[^"]*(?:angel\.body|wing\.left|wing\.right)/);
  });

  it('uses native keyboard-operable controls with strong focus-visible styling', () => {
    const markup = renderStatus('succeeded');
    const stylesheet = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

    expect(markup).toContain('type="radio"');
    expect(markup).toContain('type="checkbox"');
    expect(stylesheet).toMatch(/\.layer-select-input:focus-visible\s*\+\s*\.layer-select-label/);
    expect(stylesheet).toMatch(/\.layer-toggle-input:focus-visible\s*\+\s*\.layer-toggle-label/);
  });

  it('keeps the live region bounded away from interactive fixture controls', () => {
    const markup = renderStatus('succeeded');

    expect(markup.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(markup).toMatch(
      /<p class="status-copy" role="status" aria-live="polite" aria-atomic="true">/,
    );
    expect(markup).not.toMatch(/<section class="status-card"[^>]*aria-live/);
    expect(markup).not.toMatch(/<fieldset class="layer-review"[^>]*aria-live/);
  });

  it('renders compact selected metadata and conditional future-scene intent', () => {
    let review = createBannerLayerReviewState(sampleBannerAnalysisData);
    review = bannerLayerReviewReducer(review, { type: 'select', partKey: 'wing.left' });
    review = bannerLayerReviewReducer(review, {
      type: 'set_visible',
      partKey: 'wing.left',
      visible: false,
    });
    review = bannerLayerReviewReducer(review, {
      type: 'set_included',
      partKey: 'wing.left',
      included: false,
    });
    const markup = renderStatus('succeeded', review);

    expect(markup).toContain('Selected fixture metadata');
    expect(markup).toContain('wing.left');
    expect(markup).toContain('500 bps (5.00%)');
    expect(markup).toContain('1,800 bps (18.00%)');
    expect(markup).toContain('3,500 bps (35.00%)');
    expect(markup).toContain('6,000 bps (60.00%)');
    expect(markup).toContain(
      'exclude this proposed layer while retaining its hidden setting in memory',
    );
  });

  it('renders deterministically without mutating ordinary review state', () => {
    const review = createBannerLayerReviewState(sampleBannerAnalysisData);
    const before = JSON.stringify(review);

    expect(renderStatus('succeeded', review)).toBe(renderStatus('succeeded', review));
    expect(JSON.stringify(review)).toBe(before);
    expect(Object.isFrozen(review)).toBe(true);
  });

  it('renders failure copy in an accessible alert', () => {
    const markup = renderStatus('failed');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Fixture failure is visible.');
  });
});
