import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  prepareSamTextHeavyCorpusRequestV1,
  type SamCorpusPreparedRequestV1,
} from '../src/server/sam-corpus-evaluation-catalog-v1.js';
import {
  authorizeTestOnlySamTextHeavyProductionV3Execution,
  createTestOnlySamTextHeavyProductionV3AuthorizationSources,
  mintTestOnlySamTextHeavyProductionV3Authorization,
  type SamTextHeavyProductionV3AuthorizedExecution,
} from '../src/server/sam-text-heavy-production-v3-authorization.js';
import {
  createTestOnlySamTextHeavyProductionV3Root,
  inspectSamTextHeavyProductionV3DurableReservation,
  inspectSamTextHeavyProductionV3OutputTarget,
  prepareTestOnlySamTextHeavyProductionV3OutputTarget,
  reserveSamTextHeavyProductionV3CanonicalCall,
} from '../src/server/sam-text-heavy-production-v3-reservation.js';

export interface SamTextHeavyProductionV3TestContext {
  readonly rootDirectory: string;
  readonly outputDirectory: string;
  readonly claimPath: string;
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorized: SamTextHeavyProductionV3AuthorizedExecution;
  readonly cleanup: () => Promise<void>;
}

export const createSamTextHeavyProductionV3TestContext = async (
  authorizationTail = 'f30000000001',
): Promise<SamTextHeavyProductionV3TestContext> => {
  const rootDirectory = await mkdtemp(
    join(await realpath(tmpdir()), 'fabrica-sam-text-heavy-production-v3-test-root-'),
  );
  try {
    const root = await createTestOnlySamTextHeavyProductionV3Root({ rootDirectory });
    const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
      root,
      nonce: 'f30000000001',
    });
    const outputDirectory = inspectSamTextHeavyProductionV3OutputTarget(target).outputDirectory;
    const reservation = await reserveSamTextHeavyProductionV3CanonicalCall(target);
    const claimPath = inspectSamTextHeavyProductionV3DurableReservation(reservation).claimPath;
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => Date.parse('2026-07-23T12:00:00Z'),
      authorizationId: () => `f3000000-0000-4000-8000-${authorizationTail}`,
    });
    const authorization = mintTestOnlySamTextHeavyProductionV3Authorization(
      prepared,
      reservation,
      sources,
    );
    const authorized = authorizeTestOnlySamTextHeavyProductionV3Execution({
      prepared,
      reservation,
      authorization,
      sources,
    });
    return Object.freeze({
      rootDirectory,
      outputDirectory,
      claimPath,
      prepared,
      authorized,
      cleanup: () => rm(rootDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
};
