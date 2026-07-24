import { lstat } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import {
  SamTextHeavyProductionV3ExecutionError,
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import { createSamTextHeavyProductionV3TestContext } from './sam-text-heavy-production-v3-test-helpers.js';

describe('SAM text-heavy production V3 timeout', () => {
  it('waits for the exact 330,000 ms wall timeout, becomes indeterminate, and never retries', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000061');
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'wait-for-timeout' },
    });
    vi.useFakeTimers();
    try {
      const pending = executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory,
      }).then(
        (result) => ({ result, error: null }),
        (error: unknown) => ({ result: null, error }),
      );
      await vi.waitFor(() => {
        expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory).dispatchCount).toBe(
          1,
        );
      });
      await vi.advanceTimersByTimeAsync(329_999);
      expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
        constructionCount: 1,
        dispatchCount: 1,
        fetchCount: 0,
      });
      await vi.advanceTimersByTimeAsync(1);
      const settled = await pending;
      expect(settled.result).toBeNull();
      const error = settled.error;
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
      vi.useRealTimers();
      await context.cleanup();
    }
  });
});
