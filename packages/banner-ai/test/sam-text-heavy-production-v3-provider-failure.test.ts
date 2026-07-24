import { lstat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  SamTextHeavyProductionV3ExecutionError,
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import { createSamTextHeavyProductionV3TestContext } from './sam-text-heavy-production-v3-test-helpers.js';

describe('SAM text-heavy production V3 known provider failure', () => {
  it('classifies one 4xx result without parsing or exposing its body and never retries', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000041');
    const rawMarker = 'TEST_ONLY_PROVIDER_BODY_MUST_NOT_ESCAPE';
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'known-provider-failure' },
    });
    try {
      const error = await executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
      expect(error).toMatchObject({
        reason: 'PROVIDER_FAILURE',
        retryable: false,
        transportConstructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
        materializationCount: 0,
      });
      expect(Object.hasOwn(error as object, 'cause')).toBe(false);
      expect(String(error)).not.toContain(rawMarker);
      expect(JSON.stringify(error)).not.toContain(rawMarker);
      expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
        constructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
      });
      await expect(lstat(context.outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(context.claimPath)).resolves.toMatchObject({ mode: expect.any(Number) });
      await expect(
        executeSamTextHeavyProductionV3({
          authorized: context.authorized,
          transportFactory: factory,
        }),
      ).rejects.toThrow(/already consumed/u);
    } finally {
      await context.cleanup();
    }
  });
});
