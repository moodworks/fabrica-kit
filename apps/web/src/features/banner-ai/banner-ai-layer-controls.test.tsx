import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BannerAiLayerControls, type BannerAiLayerControlPart } from './banner-ai-layer-controls';

const thumbnail = Object.freeze({
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  byteSize: 8,
  sha256: 'a'.repeat(64),
  pixelWidth: 72,
  pixelHeight: 48,
});

const parts = Object.freeze([
  {
    partKey: 'background',
    targetId: 'background',
    name: 'Warm background',
    role: 'background',
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    thumbnail,
    included: true,
    visible: null,
  },
  {
    partKey: 'angel.body',
    targetId: 'layer_angel_body_v1',
    name: 'Angel <body>',
    role: 'subject',
    bounds: { x: 90, y: 20, width: 120, height: 160 },
    thumbnail,
    included: true,
    visible: true,
  },
  {
    partKey: 'wing.left',
    targetId: 'layer_left_wing_v1',
    name: 'Left wing',
    role: 'foreground',
    bounds: { x: 15, y: 36, width: 105, height: 120 },
    thumbnail,
    included: false,
    visible: true,
  },
  {
    partKey: 'wing.right',
    targetId: 'layer_right_wing_v1',
    name: 'Right wing',
    role: 'foreground',
    bounds: { x: 180, y: 36, width: 105, height: 120 },
    thumbnail,
    included: true,
    visible: false,
  },
] satisfies readonly BannerAiLayerControlPart[]);

const renderControls = () =>
  renderToStaticMarkup(
    createElement(BannerAiLayerControls, {
      parts,
      selectedPartId: 'layer_left_wing_v1',
      onSelectPart: () => {},
      onSetPartIncluded: () => {},
      onSetPartVisible: () => {},
    }),
  );

describe('provider-free editor layer controls', () => {
  it('renders exactly one named native selection group and the expected native toggles', () => {
    const markup = renderControls();

    expect(markup.match(/type="radio"/g)).toHaveLength(4);
    expect(markup.match(/name="banner-ai-editor-selected-part"/g)).toHaveLength(4);
    expect(markup.match(/type="checkbox"/g)).toHaveLength(7);
    expect(markup.match(/<input(?=[^>]*type="radio")(?=[^>]*checked="")[^>]*>/g)).toHaveLength(1);
    expect(markup).toContain('<fieldset class="editor-layer-fieldset">');
    expect(markup).toContain('<legend>Select one presentation part</legend>');

    for (let index = 0; index < 4; index += 1) {
      expect(markup).toContain(`id="editor-layer-select-${index}"`);
      expect(markup).toContain(`for="editor-layer-select-${index}"`);
      expect(markup).toContain(`id="editor-layer-include-${index}"`);
      expect(markup).toContain(`for="editor-layer-include-${index}"`);
    }
    for (let index = 1; index < 4; index += 1) {
      expect(markup).toContain(`id="editor-layer-visible-${index}"`);
      expect(markup).toContain(`for="editor-layer-visible-${index}"`);
    }
    expect(markup).not.toContain('id="editor-layer-visible-0"');
  });

  it('shows bounded decorative data thumbnails, escaped names, and explicit non-color states', () => {
    const markup = renderControls();

    expect(markup.match(/src="data:image\/png;base64,iVBORw0KGgo="/g)).toHaveLength(4);
    expect(markup.match(/class="editor-layer-thumbnail"/g)).toHaveLength(4);
    expect(markup.match(/alt="" aria-hidden="true" width="72" height="48"/g)).toHaveLength(4);
    expect(markup).toContain('Angel &lt;body&gt;');
    expect(markup).not.toContain('<body>');
    expect(markup).toContain('subject · 120 × 160 px');
    expect(markup).toContain('Selection: selected');
    expect(markup).toContain('Inclusion: excluded');
    expect(markup).toContain('Visibility: hidden');
    expect(markup).toContain('Visibility: N/A · canvas background');
    expect(markup).toContain('Names and order stay fixed for this demo.');
  });

  it('provides visible-focus, reduced-motion, and narrow-viewport rules', () => {
    const stylesheet = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

    expect(stylesheet).toMatch(/\.editor-layer-selection input:focus-visible \+ label/);
    expect(stylesheet).toMatch(/\.editor-layer-toggle input:focus-visible \+ label/);
    expect(stylesheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(stylesheet).toMatch(/@media \(max-width: 420px\)/);
    expect(stylesheet).toMatch(/\.editor-layer-row\s*{[^}]*grid-template-columns: 1fr/s);
  });
});
