import { describe, expect, it } from 'vitest';

import {
  MAX_PREVIEW_MESSAGE_BYTES,
  PREVIEW_CSP,
  PREVIEW_POLICY,
  PREVIEW_SANDBOX,
  parsePreviewCsp,
  validatePreviewMessage,
} from '../src/index.js';

const nonce = '0123456789abcdef0123456789abcdef';
const source = Object.freeze({ syntheticWindow: true });

describe('preview isolation policy', () => {
  it('freezes the exact opaque iframe sandbox and CSP directives', () => {
    expect(PREVIEW_SANDBOX).toBe('allow-scripts');
    expect(PREVIEW_POLICY).toEqual({
      sandbox: 'allow-scripts',
      renderTarget: 'opaque-origin-iframe',
      csp: PREVIEW_CSP,
    });
    expect(Object.isFrozen(PREVIEW_POLICY)).toBe(true);

    const directives = parsePreviewCsp(PREVIEW_CSP);
    expect(Object.fromEntries(directives)).toEqual({
      'default-src': ["'none'"],
      'img-src': ['blob:', 'data:'],
      'style-src': ["'unsafe-inline'"],
      'script-src': ["'unsafe-inline'"],
      'connect-src': ["'none'"],
      'font-src': ["'none'"],
      'media-src': ["'none'"],
      'frame-src': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'none'"],
    });
  });

  it.each([
    { type: 'ready', nonce },
    { type: 'progress', nonce, progressBps: 10_000 },
    { type: 'error', nonce, code: 'RENDER_FAILED', message: 'Synthetic failure' },
    { type: 'exit', nonce },
  ])('accepts exact message $type from the expected source and nonce', (data) => {
    expect(validatePreviewMessage({ source, data }, { source, nonce })).toEqual({
      success: true,
      data,
    });
  });

  it('rejects wrong source before inspecting cyclic attacker data', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(validatePreviewMessage({ source: {}, data: cyclic }, { source, nonce })).toEqual({
      success: false,
      code: 'PREVIEW_SOURCE_MISMATCH',
    });
    expect(validatePreviewMessage({ source, data: cyclic }, { source, nonce })).toEqual({
      success: false,
      code: 'PREVIEW_MESSAGE_INVALID',
    });
  });

  it('rejects wrong nonce independently of opaque origin claims', () => {
    expect(
      validatePreviewMessage(
        { source, data: { type: 'ready', nonce: 'f'.repeat(32), origin: 'null' } },
        { source, nonce },
      ),
    ).toEqual({ success: false, code: 'PREVIEW_MESSAGE_INVALID' });
    expect(
      validatePreviewMessage(
        { source, data: { type: 'ready', nonce: 'f'.repeat(32) } },
        { source, nonce },
      ),
    ).toEqual({ success: false, code: 'PREVIEW_NONCE_MISMATCH' });
  });

  it('rejects unknown fields, URL-bearing exit, malformed bounds, and unsafe text', () => {
    const invalid = [
      { type: 'ready', nonce, extra: true },
      { type: 'exit', nonce, url: 'https://example.com/' },
      { type: 'progress', nonce, progressBps: 10_001 },
      { type: 'progress', nonce, progressBps: 1.5 },
      { type: 'error', nonce, code: 'lowercase', message: 'Safe' },
      { type: 'error', nonce, code: 'ERROR', message: 'Cafe\u0301' },
      { type: 'error', nonce, code: 'ERROR', message: 'bad\u202Etext' },
      { type: 'error', nonce, code: 'A'.repeat(81), message: 'Safe' },
      { type: 'error', nonce, code: 'ERROR', message: 'x'.repeat(501) },
      { type: 'ready', nonce: nonce.toUpperCase() },
      { type: 'unknown', nonce },
    ];

    for (const data of invalid) {
      expect(validatePreviewMessage({ source, data }, { source, nonce })).toEqual({
        success: false,
        code: 'PREVIEW_MESSAGE_INVALID',
      });
    }
  });

  it('accepts exact error code and Unicode-message boundaries', () => {
    const data = { type: 'error', nonce, code: `A${'0'.repeat(79)}`, message: 'x'.repeat(500) };

    expect(validatePreviewMessage({ source, data }, { source, nonce })).toEqual({
      success: true,
      data,
    });
  });

  it('rejects serialized data above 65,536 UTF-8 bytes with a code-only result', () => {
    const data = {
      type: 'error',
      nonce,
      code: 'ERROR',
      message: 'x'.repeat(MAX_PREVIEW_MESSAGE_BYTES),
    };

    expect(validatePreviewMessage({ source, data }, { source, nonce })).toEqual({
      success: false,
      code: 'PREVIEW_MESSAGE_OVERSIZED',
    });
  });
});
