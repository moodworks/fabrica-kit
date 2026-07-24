import { lstat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { SAM_CORPUS_FAKE_OUTPUT_LABEL } from '../src/server/sam-corpus-visual-evaluation-v2.js';
import {
  SamTextHeavyProductionV3ExecutionError,
  createTestOnlySamTextHeavyProductionV3NativeBoundaryFactory,
  executeSamTextHeavyProductionV3,
  executeTestOnlySamTextHeavyProductionV3NativeBoundary,
  inspectTestOnlySamTextHeavyProductionV3NativeBoundaryFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import { createSamTextHeavyProductionV3TestContext } from './sam-text-heavy-production-v3-test-helpers.js';

describe('SAM text-heavy production V3 test-only native boundary', () => {
  it('proves native request composition in memory without real authority or materialization', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000011');
    const factory = createTestOnlySamTextHeavyProductionV3NativeBoundaryFactory({
      candidateCount: 1,
    });
    try {
      const result = await executeTestOnlySamTextHeavyProductionV3NativeBoundary({
        authorized: context.authorized,
        transportFactory: factory,
      });
      expect(result).toEqual({
        classification: 'test-only-native-boundary-in-memory-not-sam-output',
        label: SAM_CORPUS_FAKE_OUTPUT_LABEL,
        canonicalRequestByteLength: 222_620,
        canonicalRequestSha256: 'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
        discardedSyntheticResponseSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
        discardedSyntheticCandidateCount: 1,
        requestEvidence: {
          endpoint: 'https://sawwuq4u7oiftj.api.runpod.ai/v1/masks',
          method: 'POST',
          canonicalRequestByteLength: 222_620,
          canonicalRequestSha256:
            'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
          timeoutMs: 330_000,
          redirect: 'error',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          dummyAuthorizationHeaderVerified: true,
          networkCalls: 0,
        },
        transportConstructionCount: 1,
        dispatchCount: 1,
        fetchCount: 1,
        materializationCount: 0,
        networkCalls: 0,
        retryCount: 0,
        providerCallAuthority: false,
        providerBillingGuarantee: false,
      });
      expect(inspectTestOnlySamTextHeavyProductionV3NativeBoundaryFactory(factory)).toEqual({
        constructionCount: 1,
        dispatchCount: 1,
        fetchCount: 1,
        capturedRequest: result.requestEvidence,
      });
      await expect(lstat(context.outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(context.claimPath)).resolves.toMatchObject({ mode: expect.any(Number) });
    } finally {
      await context.cleanup();
    }
  });

  it('cannot pass the separately branded test-native factory to the production executor', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000012');
    const factory = createTestOnlySamTextHeavyProductionV3NativeBoundaryFactory({
      candidateCount: 1,
    });
    try {
      const error = await executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory as never,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
      expect(error).toMatchObject({
        reason: 'LOCAL_FAILURE',
        transportConstructionCount: 0,
        dispatchCount: 0,
        fetchCount: 0,
        materializationCount: 0,
      });
      expect(inspectTestOnlySamTextHeavyProductionV3NativeBoundaryFactory(factory)).toEqual({
        constructionCount: 0,
        dispatchCount: 0,
        fetchCount: 0,
        capturedRequest: null,
      });
    } finally {
      await context.cleanup();
    }
  });
});
