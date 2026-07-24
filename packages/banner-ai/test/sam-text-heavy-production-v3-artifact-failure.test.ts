import { lstat, readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  SamTextHeavyProductionV3ExecutionError,
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import { createSamTextHeavyProductionV3TestContext } from './sam-text-heavy-production-v3-test-helpers.js';

describe('SAM text-heavy production V3 artifact publication race', () => {
  it('fails locally after one valid response, preserves the raced output and never retries', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000051');
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'valid-deterministic-fake-with-output-race', candidateCount: 1 },
    });
    try {
      const error = await executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
      expect(error).toMatchObject({
        reason: 'LOCAL_FAILURE',
        retryable: false,
        transportConstructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
        materializationCount: 1,
      });
      expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
        constructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
      });
      await expect(readdir(context.outputDirectory)).resolves.toEqual([]);
      await expect(lstat(context.claimPath)).resolves.toMatchObject({ mode: expect.any(Number) });
      await expect(
        executeSamTextHeavyProductionV3({
          authorized: context.authorized,
          transportFactory: factory,
        }),
      ).rejects.toThrow(/already consumed/u);
      await expect(readdir(context.outputDirectory)).resolves.toEqual([]);
    } finally {
      await context.cleanup();
    }
  });
});
