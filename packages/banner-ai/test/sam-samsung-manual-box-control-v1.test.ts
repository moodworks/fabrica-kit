import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import { SamRunPodDirectV3Error } from '../src/server/sam-runpod-direct-v3-adapter.js';

import {
  mintSamSamsungManualBoxAuthorization,
  validateSamRunPodDirectV3BoxAuthorization,
} from '../src/server/sam-runpod-direct-v3-authorization.js';
import {
  prepareSamSamsungManualBoxRequest,
  SAM_SAMSUNG_MANUAL_BOX_BPS,
  SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
  SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256,
} from '../src/server/sam-runpod-direct-v3-request-preparation.js';
import {
  createTestOnlySamsungManualBoxHarness,
  preflightSamsungManualBox,
  runTestOnlySamsungManualBoxHarness,
  SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID,
} from '../src/server/sam-samsung-manual-box-control-v1.js';

const samsungFixturePath = resolve(
  import.meta.dirname,
  '../../../.local-data/sam-samsung/normalized.png',
);
const hasSamsungFixture = existsSync(samsungFixturePath);
const source = hasSamsungFixture
  ? new Uint8Array(readFileSync(samsungFixturePath))
  : new Uint8Array();

describe('Samsung manual-box pre-dispatch control', () => {
  it('uses an opaque temp-root harness for one dispatch and durable 0600 artifacts', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sam-samsung-manual-box-test-'));
    let calls = 0;
    try {
      const capability = createTestOnlySamsungManualBoxHarness({
        root,
        dispatch: async () => {
          calls += 1;
          return {
            status: 200,
            response: { candidateCount: 1, candidates: [{}] } as never,
            cutoutPng: new Uint8Array([1, 2, 3]),
            maskPng: new Uint8Array([4, 5, 6]),
            dispatchCount: 1,
          };
        },
      });
      const result = await runTestOnlySamsungManualBoxHarness(capability);
      expect(result.terminalClassification).toBe('success');
      expect(calls).toBe(1);
      const report = JSON.parse(
        await readFile(resolve(result.operation, 'report.json'), 'utf8'),
      ) as Record<string, unknown>;
      const claim = JSON.parse(
        await readFile(resolve(result.operation, 'claim.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(claim).toMatchObject({
        operationId: result.operation.split('/').at(-1),
        status: 'claimed-before-dispatch',
      });
      expect(report).toMatchObject({
        terminalClassification: 'success',
        dispatchCount: 1,
        retryCount: 0,
        pollCount: 0,
      });
      for (const name of [
        'claim.json',
        'response.json',
        'report.json',
        'candidate-1.cutout.png',
        'candidate-1.mask.png',
      ]) {
        const stat = statSync(resolve(result.operation, name));
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.nlink).toBe(1);
      }
      const collision = createTestOnlySamsungManualBoxHarness({
        root,
        dispatch: async () => ({ status: 200, dispatchCount: 1 }),
      });
      await expect(runTestOnlySamsungManualBoxHarness(collision)).rejects.toThrow();
      await expect(runTestOnlySamsungManualBoxHarness(capability)).rejects.toThrow();
      expect(calls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [403, 'provider_failure'],
    [500, 'indeterminate'],
  ] as const)('sanitizes terminal status %s as %s', async (status, classification) => {
    const root = await mkdtemp(resolve(tmpdir(), 'sam-samsung-manual-box-test-'));
    try {
      const capability = createTestOnlySamsungManualBoxHarness({
        root,
        dispatch: async () => ({ status, dispatchCount: 1 }),
      });
      await expect(runTestOnlySamsungManualBoxHarness(capability)).rejects.toThrow(classification);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['INDETERMINATE', 'indeterminate', 504],
    ['PROVIDER_FAILURE', 'provider_failure', 403],
  ] as const)(
    'records one dispatch when the adapter throws %s',
    async (reason, classification, status) => {
      const root = await mkdtemp(resolve(tmpdir(), 'sam-samsung-manual-box-test-'));
      try {
        const capability = createTestOnlySamsungManualBoxHarness({
          root,
          dispatch: async (accounting) => {
            accounting.dispatchCount = 1;
            accounting.status = status;
            throw new SamRunPodDirectV3Error(reason, 'terminal');
          },
        });
        await expect(runTestOnlySamsungManualBoxHarness(capability)).rejects.toThrow(
          classification,
        );
        const report = JSON.parse(
          await readFile(resolve(root, SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID, 'report.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(report).toMatchObject({
          terminalClassification: classification,
          dispatchCount: 1,
          status,
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('fails closed for malformed 200 output without retry', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sam-samsung-manual-box-test-'));
    let calls = 0;
    try {
      const capability = createTestOnlySamsungManualBoxHarness({
        root,
        dispatch: async () => {
          calls += 1;
          return { status: 200, dispatchCount: 1 };
        },
      });
      await expect(runTestOnlySamsungManualBoxHarness(capability)).rejects.toThrow(
        'response_invalid',
      );
      expect(calls).toBe(1);
      const report = JSON.parse(
        await readFile(resolve(root, SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID, 'report.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(report).toMatchObject({
        terminalClassification: 'response_invalid',
        dispatchCount: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists failed_closed with zero dispatches when the boundary fails before dispatch', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'sam-samsung-manual-box-test-'));
    try {
      const capability = createTestOnlySamsungManualBoxHarness({
        root,
        dispatch: async () => {
          throw new TypeError('foreign boundary');
        },
      });
      await expect(runTestOnlySamsungManualBoxHarness(capability)).rejects.toThrow('failed_closed');
      const report = JSON.parse(
        await readFile(resolve(root, SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID, 'report.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(report).toMatchObject({ terminalClassification: 'failed_closed', dispatchCount: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!hasSamsungFixture)(
    'prepares the exact source, worker-roundtrip box, and canonical request',
    async () => {
      const prepared = prepareSamSamsungManualBoxRequest(source);
      expect(prepared.request.segmentation).toEqual({
        mode: 'box-prompt',
        prompt: { kind: 'box', authority: 'user-interaction', box: SAM_SAMSUNG_MANUAL_BOX_BPS },
      });
      expect(prepared.request.limits).toEqual({ minMaskAreaPixels: 1, maxCandidates: 1 });
      expect(prepared.canonicalBodySha256).toBe(SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256);
      expect(prepared.canonicalBodyByteLength).toBe(
        SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
      );
      await expect(preflightSamsungManualBox()).resolves.toMatchObject({
        workerRoundtripBounds: SAM_SAMSUNG_MANUAL_BOX_BPS,
      });
    },
  );

  it.skipIf(!hasSamsungFixture)('mints and validates only the exact prepared request', () => {
    vi.setSystemTime(new Date('2026-07-18T14:00:00.000Z'));
    try {
      const prepared = prepareSamSamsungManualBoxRequest(source);
      const authorization = mintSamSamsungManualBoxAuthorization(prepared);
      expect(validateSamRunPodDirectV3BoxAuthorization({ prepared, authorization })).toEqual(
        authorization,
      );
      const mutated = prepareSamSamsungManualBoxRequest(source);
      expect(mutated).not.toBe(prepared);
    } finally {
      vi.useRealTimers();
    }
  });
});
