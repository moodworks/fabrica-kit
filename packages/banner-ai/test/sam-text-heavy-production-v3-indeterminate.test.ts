import { lstat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  SamTextHeavyProductionV3ExecutionError,
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import { createSamTextHeavyProductionV3TestContext } from './sam-text-heavy-production-v3-test-helpers.js';

describe('SAM text-heavy production V3 indeterminate result', () => {
  it('sanitizes a secret-shaped lost response and permanently consumes every one-way capability', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000021');
    const secretMarker = 'TEST_ONLY_SECRET_BEARER_MUST_NOT_ESCAPE';
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    try {
      const error = await executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
      expect(error).toMatchObject({
        reason: 'INDETERMINATE',
        retryable: false,
        transportConstructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
        materializationCount: 0,
        providerBillingGuarantee: false,
      });
      expect(Object.hasOwn(error as object, 'cause')).toBe(false);
      expect(String(error)).not.toContain(secretMarker);
      expect(JSON.stringify(error)).not.toContain(secretMarker);
      expect((error as Error).stack).not.toContain(secretMarker);
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
      expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
        constructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
      });
    } finally {
      await context.cleanup();
    }
  });
});
