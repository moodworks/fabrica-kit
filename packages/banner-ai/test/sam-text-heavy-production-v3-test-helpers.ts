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
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
  createTestOnlySamTextHeavyProductionV3RepositoryObserver,
  verifySamTextHeavyProductionV3RepositoryExecutionBinding,
  type SamTextHeavyProductionV3ObservedRepositoryIdentity,
  type SamTextHeavyProductionV3VerifiedRepositoryBinding,
} from '../src/server/sam-text-heavy-production-v3-repository-binding.js';

export const SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY = Object.freeze({
  executingMergeSha: '1111111111111111111111111111111111111111',
  executingMergeTreeSha: '2222222222222222222222222222222222222222',
  firstParentSha: '3333333333333333333333333333333333333333',
  reviewedImplementationSha: '4444444444444444444444444444444444444444',
  reviewedImplementationTreeSha: '2222222222222222222222222222222222222222',
  corpusProvenanceSha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
});

export const SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY: SamTextHeavyProductionV3ObservedRepositoryIdentity =
  Object.freeze({
    headSha: '1111111111111111111111111111111111111111',
    headTreeSha: '2222222222222222222222222222222222222222',
    parentCount: 2,
    firstParentSha: '3333333333333333333333333333333333333333',
    secondParentSha: '4444444444444444444444444444444444444444',
    secondParentTreeSha: '2222222222222222222222222222222222222222',
    localMainSha: '1111111111111111111111111111111111111111',
    originMainSha: '1111111111111111111111111111111111111111',
    headDetached: false,
    currentBranchIsMain: true,
    indexClean: true,
    worktreeClean: true,
    untrackedFilesPresent: false,
  });

export const SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_REFERENCE_CANONICAL_CLAIM_SHA256 =
  '48d8bfaa9f376b278cbdf033c36678dcb282b20c4dc6670a154746075caca75c' as const;

export const createValidTestOnlySamTextHeavyProductionV3RepositoryBinding = (
  observe: () => unknown = () => SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
): SamTextHeavyProductionV3VerifiedRepositoryBinding => {
  const observer = createTestOnlySamTextHeavyProductionV3RepositoryObserver({ observe });
  return verifySamTextHeavyProductionV3RepositoryExecutionBinding({
    expected: SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
    observer,
  });
};

export interface SamTextHeavyProductionV3TestContext {
  readonly rootDirectory: string;
  readonly outputDirectory: string;
  readonly claimPath: string;
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly repositoryBinding: SamTextHeavyProductionV3VerifiedRepositoryBinding;
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
    const repositoryBinding = createValidTestOnlySamTextHeavyProductionV3RepositoryBinding();
    const root = await createTestOnlySamTextHeavyProductionV3Root({ rootDirectory });
    const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
      root,
      repositoryBinding,
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
      repositoryBinding,
      authorized,
      cleanup: () => rm(rootDirectory, { recursive: true, force: true }),
    });
  } catch (error) {
    await rm(rootDirectory, { recursive: true, force: true });
    throw error;
  }
};
