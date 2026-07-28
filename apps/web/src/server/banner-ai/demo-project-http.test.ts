import { describe, expect, it } from 'vitest';

import {
  demoProjectFailureFrom,
  readBoundedJson,
  requireExactObjectKeys,
} from './demo-project-http';

describe('provider-free demo HTTP boundary', () => {
  it('accepts one bounded JSON object and rejects unknown fields', async () => {
    const request = new Request('http://localhost/demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reopen' }),
    });
    const body = await readBoundedJson(request, 1_024);

    expect(requireExactObjectKeys(body, ['action'])).toEqual({ action: 'reopen' });
    expect(() => requireExactObjectKeys({ action: 'reopen', authority: true }, ['action'])).toThrow(
      /unsupported fields/,
    );
  });

  it('rejects wrong media type, malformed JSON, and oversized bodies safely', async () => {
    await expect(
      readBoundedJson(new Request('http://localhost/demo', { method: 'POST', body: '{}' }), 1_024),
    ).rejects.toMatchObject({ code: 'JSON_REQUEST_REQUIRED', status: 415 });
    await expect(
      readBoundedJson(
        new Request('http://localhost/demo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }),
        1_024,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_DEMO_REQUEST', status: 400 });
    await expect(
      readBoundedJson(
        new Request('http://localhost/demo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: 'x'.repeat(100) }),
        }),
        16,
      ),
    ).rejects.toMatchObject({ code: 'DEMO_REQUEST_TOO_LARGE', status: 413 });
  });

  it('maps unknown causes to one closed failure without raw cause material', async () => {
    const response = demoProjectFailureFrom(
      new Error('/Users/private/project.ts:99 secret stack'),
      'DEMO_FAILED',
    );
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).toContain('DEMO_FAILED');
    expect(text).not.toContain('/Users');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('secret');
  });
});
