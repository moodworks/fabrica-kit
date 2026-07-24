import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareSamTextHeavyCorpusRequestV1 } from '../src/server/sam-corpus-evaluation-catalog-v1.js';
import {
  authorizeTestOnlySamTextHeavyProductionV3Execution,
  createTestOnlySamTextHeavyProductionV3AuthorizationSources,
  mintSamTextHeavyProductionV3Authorization,
  mintTestOnlySamTextHeavyProductionV3Authorization,
} from '../src/server/sam-text-heavy-production-v3-authorization.js';
import {
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import {
  createTestOnlySamTextHeavyProductionV3Root,
  deriveSamTextHeavyProductionV3CanonicalCallEvidence,
  inspectSamTextHeavyProductionV3DurableReservation,
  inspectSamTextHeavyProductionV3OutputTarget,
  prepareSamTextHeavyProductionV3OutputTarget,
  prepareTestOnlySamTextHeavyProductionV3OutputTarget,
  reserveSamTextHeavyProductionV3CanonicalCall,
} from '../src/server/sam-text-heavy-production-v3-reservation.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
  SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema,
  SamTextHeavyProductionV3ObservedRepositoryIdentitySchema,
  createSamTextHeavyProductionV3ProductionRepositoryObserver,
  createTestOnlySamTextHeavyProductionV3RepositoryObserver,
  inspectSamTextHeavyProductionV3RepositoryExecutionBinding,
  inspectTestOnlySamTextHeavyProductionV3RepositoryObserver,
  revalidateSamTextHeavyProductionV3RepositoryExecutionBinding,
  verifySamTextHeavyProductionV3RepositoryExecutionBinding,
  type SamTextHeavyProductionV3ExpectedRepositoryIdentity,
  type SamTextHeavyProductionV3ObservedRepositoryIdentity,
  type SamTextHeavyProductionV3VerifiedRepositoryBinding,
} from '../src/server/sam-text-heavy-production-v3-repository-binding.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
  SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
  SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_REFERENCE_CANONICAL_CLAIM_SHA256,
  createSamTextHeavyProductionV3TestContext,
} from './sam-text-heavy-production-v3-test-helpers.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const frozenExpected = (
  overrides: Readonly<Record<string, unknown>> = {},
): SamTextHeavyProductionV3ExpectedRepositoryIdentity =>
  Object.freeze({
    ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
    ...overrides,
  }) as SamTextHeavyProductionV3ExpectedRepositoryIdentity;

const frozenObserved = (
  overrides: Readonly<Record<string, unknown>> = {},
): SamTextHeavyProductionV3ObservedRepositoryIdentity =>
  Object.freeze({
    ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
    ...overrides,
  }) as SamTextHeavyProductionV3ObservedRepositoryIdentity;

const expectedWithoutExecutingMergeSha = Object.freeze(
  (() => {
    const remaining: Record<string, unknown> = {
      ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
    };
    delete remaining.executingMergeSha;
    return remaining;
  })(),
);

const observedWithoutHeadSha = Object.freeze(
  (() => {
    const remaining: Record<string, unknown> = {
      ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
    };
    delete remaining.headSha;
    return remaining;
  })(),
);

const createSequencedObserver = (observations: readonly unknown[]) => {
  let index = 0;
  const observer = createTestOnlySamTextHeavyProductionV3RepositoryObserver({
    observe: () => observations[Math.min(index++, observations.length - 1)],
  });
  return observer;
};

const verifyFakeBinding = (input?: {
  readonly expected?: SamTextHeavyProductionV3ExpectedRepositoryIdentity;
  readonly observations?: readonly unknown[];
}) => {
  const observer = createSequencedObserver(
    input?.observations ?? [SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY],
  );
  return {
    observer,
    binding: verifySamTextHeavyProductionV3RepositoryExecutionBinding({
      expected: input?.expected ?? SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
      observer,
    }),
  };
};

const createRoot = async () => {
  const path = await mkdtemp(
    join(await realpath(tmpdir()), 'fabrica-sam-text-heavy-production-v3-test-root-'),
  );
  roots.push(path);
  return {
    path,
    root: await createTestOnlySamTextHeavyProductionV3Root({ rootDirectory: path }),
  };
};

describe('SAM text-heavy production V3 closed repository execution binding', () => {
  it('accepts independent immutable expected and observed identities and exposes sanitized evidence', () => {
    const { binding, observer } = verifyFakeBinding();
    const evidence = inspectSamTextHeavyProductionV3RepositoryExecutionBinding(binding);
    expect(evidence).toEqual({
      schema: 'sam-text-heavy-production-v3-repository-execution-binding',
      version: 2,
      observerProvenance: 'test-only-injected',
      expected: SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
      observed: SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
    });
    expect([
      evidence.expected.corpusProvenanceSha,
      evidence.expected.reviewedImplementationSha,
      evidence.expected.executingMergeSha,
    ]).toHaveLength(
      new Set([
        evidence.expected.corpusProvenanceSha,
        evidence.expected.reviewedImplementationSha,
        evidence.expected.executingMergeSha,
      ]).size,
    );
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.expected)).toBe(true);
    expect(Object.isFrozen(evidence.observed)).toBe(true);
    expect(inspectTestOnlySamTextHeavyProductionV3RepositoryObserver(observer)).toEqual({
      observationCount: 1,
    });
    const canonicalCall = deriveSamTextHeavyProductionV3CanonicalCallEvidence(binding);
    expect(canonicalCall.claimSha256).toBe(
      SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_REFERENCE_CANONICAL_CLAIM_SHA256,
    );
    expect(canonicalCall.identity).toMatchObject({
      corpusProvenanceSha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
      repositoryExecution: evidence,
    });
  });

  it.each([
    ['executing merge', 'executingMergeSha'],
    ['executing merge tree', 'executingMergeTreeSha'],
    ['first parent', 'firstParentSha'],
    ['reviewed implementation', 'reviewedImplementationSha'],
    ['reviewed implementation tree', 'reviewedImplementationTreeSha'],
    ['corpus provenance', 'corpusProvenanceSha'],
  ] as const)('rejects a mutated expected %s object ID', (_label, field) => {
    const expected = frozenExpected({ [field]: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(() => verifyFakeBinding({ expected })).toThrow(/failed closed|expected repository/u);
  });

  it.each([
    ['HEAD', 'headSha'],
    ['HEAD tree', 'headTreeSha'],
    ['first parent', 'firstParentSha'],
    ['second parent', 'secondParentSha'],
    ['second-parent tree', 'secondParentTreeSha'],
    ['local main', 'localMainSha'],
    ['origin main', 'originMainSha'],
  ] as const)('rejects a mutated observed %s object ID', (_label, field) => {
    expect(() =>
      verifyFakeBinding({ observations: [frozenObserved({ [field]: 'a'.repeat(40) })] }),
    ).toThrow(/binding failed closed/u);
  });

  it.each([
    ['missing', expectedWithoutExecutingMergeSha],
    [
      'extra',
      Object.freeze({
        ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
        extra: true,
      }),
    ],
    [
      'legacy repositorySha',
      Object.freeze({
        ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
        repositorySha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
      }),
    ],
    ['uppercase', frozenExpected({ executingMergeSha: 'A'.repeat(40) })],
    ['short', frozenExpected({ executingMergeSha: 'a'.repeat(39) })],
    ['differently typed', frozenExpected({ executingMergeSha: 1 })],
    ['mutable', { ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY }],
    ['mutable ref', frozenExpected({ executingMergeSha: 'main' })],
  ] as const)('rejects %s expected identity input', (_label, expected) => {
    expect(
      SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema.safeParse(expected).success,
    ).toBe(false);
    const observer = createSequencedObserver([
      SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
    ]);
    expect(() =>
      verifySamTextHeavyProductionV3RepositoryExecutionBinding({
        expected: expected as SamTextHeavyProductionV3ExpectedRepositoryIdentity,
        observer,
      }),
    ).toThrow(/expected repository identity failed closed/u);
    expect(inspectTestOnlySamTextHeavyProductionV3RepositoryObserver(observer)).toEqual({
      observationCount: 0,
    });
  });

  it.each([
    ['missing', observedWithoutHeadSha],
    [
      'extra',
      Object.freeze({
        ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
        extra: true,
      }),
    ],
    ['uppercase', frozenObserved({ headSha: 'A'.repeat(40) })],
    ['short', frozenObserved({ headSha: 'a'.repeat(39) })],
    ['differently typed', frozenObserved({ headSha: 1 })],
    ['mutable', { ...SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY }],
    ['mutable ref', frozenObserved({ headSha: 'HEAD' })],
  ] as const)('rejects %s observed identity input', (_label, observed) => {
    expect(
      SamTextHeavyProductionV3ObservedRepositoryIdentitySchema.safeParse(observed).success,
    ).toBe(false);
    expect(() => verifyFakeBinding({ observations: [observed] })).toThrow(
      /Git observation failed closed/u,
    );
  });

  it.each([
    ['HEAD disagreement', { headSha: 'a'.repeat(40) }],
    ['local main disagreement', { localMainSha: 'a'.repeat(40) }],
    ['origin main disagreement', { originMainSha: 'a'.repeat(40) }],
    [
      'zero parents',
      {
        parentCount: 0,
        firstParentSha: null,
        secondParentSha: null,
        secondParentTreeSha: null,
      },
    ],
    ['one parent', { parentCount: 1, secondParentSha: null, secondParentTreeSha: null }],
    ['more than two parents', { parentCount: 3 }],
    [
      'swapped parents',
      {
        firstParentSha:
          SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY.reviewedImplementationSha,
        secondParentSha:
          SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY.firstParentSha,
      },
    ],
    ['different reviewed second parent', { secondParentSha: 'a'.repeat(40) }],
    ['merge tree differs from reviewed tree', { secondParentTreeSha: 'a'.repeat(40) }],
    ['wrong first parent', { firstParentSha: 'a'.repeat(40) }],
    ['detached HEAD', { headDetached: true, currentBranchIsMain: false }],
    ['non-main branch', { currentBranchIsMain: false }],
    ['dirty index', { indexClean: false }],
    ['dirty worktree', { worktreeClean: false }],
    ['untracked file', { untrackedFilesPresent: true }],
  ] as const)('fails closed for %s', (_label, mutation) => {
    expect(() => verifyFakeBinding({ observations: [frozenObserved(mutation)] })).toThrow(
      /binding failed closed/u,
    );
  });

  it('rejects a wrong expected first parent, reviewed tree, or corpus provenance', () => {
    for (const expected of [
      frozenExpected({ firstParentSha: 'a'.repeat(40) }),
      frozenExpected({ reviewedImplementationTreeSha: 'a'.repeat(40) }),
      frozenExpected({ corpusProvenanceSha: 'a'.repeat(40) }),
    ]) {
      expect(() => verifyFakeBinding({ expected })).toThrow(/failed closed|expected repository/u);
    }
  });

  it.each([
    [
      'executing and reviewed implementations',
      {
        reviewedImplementationSha:
          SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY.executingMergeSha,
      },
    ],
    [
      'executing implementation and corpus provenance',
      {
        executingMergeSha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
      },
    ],
    [
      'reviewed implementation and corpus provenance',
      {
        reviewedImplementationSha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
      },
    ],
  ] as const)('rejects identity collapse between %s', (_label, mutation) => {
    expect(() => verifyFakeBinding({ expected: frozenExpected(mutation) })).toThrow(
      /binding failed closed/u,
    );
  });

  it('removes the legacy ambiguous field and constant from the implementation surface', async () => {
    const sourceRoot = join(process.cwd(), 'packages', 'banner-ai', 'src', 'server');
    const source = (
      await Promise.all(
        [
          'sam-text-heavy-production-v3-repository-binding.ts',
          'sam-text-heavy-production-v3-reservation.ts',
          'sam-text-heavy-production-v3-authorization.ts',
          'sam-text-heavy-production-v3-control.ts',
        ].map((file) => readFile(join(sourceRoot, file), 'utf8')),
      )
    ).join('\n');
    expect(source).not.toMatch(/\brepositorySha\b|SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA/u);
  });

  it('anchors production Git observation and closes redirection, replacement, and lazy-fetch inputs', async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'packages',
        'banner-ai',
        'src',
        'server',
        'sam-text-heavy-production-v3-repository-binding.ts',
      ),
      'utf8',
    );
    expect(source).toContain("const GIT_EXECUTABLE = '/usr/bin/git'");
    expect(source).toContain('cwd: EXECUTING_MODULE_REPOSITORY_ROOT');
    expect(source).toContain('env: GIT_ENVIRONMENT');
    expect(source).toContain("'--no-replace-objects'");
    expect(source).toContain("'protocol.allow=never'");
    expect(source.match(/'--no-textconv'/gu)).toHaveLength(2);
    expect(source).toContain("GIT_NO_LAZY_FETCH: '1'");
    expect(source).toContain("GIT_NO_REPLACE_OBJECTS: '1'");
    expect(source).toContain("GIT_CONFIG_NOSYSTEM: '1'");
    expect(source).toContain("GIT_TERMINAL_PROMPT: '0'");
    expect(source).toContain('runGitText(GIT_TOP_LEVEL_ARGS)');
    expect(source).toContain("'refs/replace/'");
    expect(source).toContain("join(commonDirectory, 'info', 'grafts')");
    expect(source).not.toMatch(/process\.cwd|process\.env|\bGIT_DIR\b|\bGIT_WORK_TREE\b/u);
  });

  it('sanitizes observer failures and never derives expected values from observed values', () => {
    const marker = 'TEST_ONLY_RAW_GIT_ERROR_AND_PATH_MUST_NOT_ESCAPE';
    const observer = createTestOnlySamTextHeavyProductionV3RepositoryObserver({
      observe: () => {
        throw new Error(marker);
      },
    });
    const error = (() => {
      try {
        verifySamTextHeavyProductionV3RepositoryExecutionBinding({
          expected: SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
          observer,
        });
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(String(error)).toMatch(/Git observation failed closed/u);
    expect(String(error)).not.toContain(marker);
    expect(Object.hasOwn(error as object, 'cause')).toBe(false);

    const independentObserver = createSequencedObserver([
      SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY,
    ]);
    expect(() =>
      verifySamTextHeavyProductionV3RepositoryExecutionBinding({
        expected: frozenExpected({ executingMergeSha: 'a'.repeat(40) }),
        observer: independentObserver,
      }),
    ).toThrow(/binding failed closed/u);
    expect(inspectTestOnlySamTextHeavyProductionV3RepositoryObserver(independentObserver)).toEqual({
      observationCount: 1,
    });
    expect(createSamTextHeavyProductionV3ProductionRepositoryObserver).toHaveLength(0);
  });

  it('rejects repository-observer reentry without invalidating a valid outer observation', () => {
    const holder: { binding?: SamTextHeavyProductionV3VerifiedRepositoryBinding } = {};
    let reentryError = '';
    const observer = createTestOnlySamTextHeavyProductionV3RepositoryObserver({
      observe: () => {
        if (holder.binding !== undefined) {
          try {
            revalidateSamTextHeavyProductionV3RepositoryExecutionBinding(holder.binding);
          } catch (error) {
            reentryError = String(error);
          }
        }
        return SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY;
      },
    });
    holder.binding = verifySamTextHeavyProductionV3RepositoryExecutionBinding({
      expected: SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_EXPECTED_REPOSITORY_IDENTITY,
      observer,
    });
    expect(() =>
      revalidateSamTextHeavyProductionV3RepositoryExecutionBinding(holder.binding!),
    ).not.toThrow();
    expect(reentryError).toMatch(/reentry is forbidden/u);
  });
});

describe('SAM text-heavy production V3 repository-binding integration', () => {
  it('rejects test-observer provenance from production output, claim, and mint boundaries', async () => {
    const root = await createRoot();
    const { binding, observer } = verifyFakeBinding();
    const invalidProductionSentinel =
      '/private/tmp/TEST_ONLY_INVALID_SAM_TEXT_HEAVY_V3_OUTPUT_SENTINEL';
    await expect(
      prepareSamTextHeavyProductionV3OutputTarget({
        outputDirectory: invalidProductionSentinel,
        repositoryBinding: binding,
      }),
    ).rejects.toThrow(/observer provenance failed closed/u);
    expect(inspectTestOnlySamTextHeavyProductionV3RepositoryObserver(observer)).toEqual({
      observationCount: 1,
    });

    const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
      root: root.root,
      repositoryBinding: binding,
      nonce: 'abababababab',
    });
    const reservation = await reserveSamTextHeavyProductionV3CanonicalCall(target);
    const durable = inspectSamTextHeavyProductionV3DurableReservation(reservation);
    expect(durable).toMatchObject({
      rootKind: 'test-only-temporary-root',
      canonicalCallIdentity: {
        repositoryExecution: { observerProvenance: 'test-only-injected' },
      },
    });
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    expect(() => mintSamTextHeavyProductionV3Authorization(prepared, reservation)).toThrow(
      /observer provenance failed closed/u,
    );
  });

  it('stops drift before output reservation, claim, mint, transport, or dispatch', async () => {
    const root = await createRoot();
    const drift = frozenObserved({ headSha: 'a'.repeat(40) });
    const { binding } = verifyFakeBinding({
      observations: [SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY, drift],
    });
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    await expect(
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.root,
        repositoryBinding: binding,
        nonce: 'eeeeeeeeeeee',
      }),
    ).rejects.toThrow(/binding failed closed/u);
    expect(await readdir(join(root.path, 'fabrica-sam-text-heavy-production-v3-claims'))).toEqual(
      [],
    );
    await expect(
      lstat(join(root.path, 'fabrica-sam-text-heavy-production-v3-fake-eeeeeeeeeeee')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
  });

  it('leaves the attempt durably claimed and mint-consumed when drift follows claim creation', async () => {
    const root = await createRoot();
    const valid = SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY;
    const drift = frozenObserved({ originMainSha: 'a'.repeat(40) });
    const { binding } = verifyFakeBinding({ observations: [valid, valid, valid, drift] });
    const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
      root: root.root,
      repositoryBinding: binding,
      nonce: 'dddddddddddd',
    });
    const outputDirectory = inspectSamTextHeavyProductionV3OutputTarget(target).outputDirectory;
    const reservation = await reserveSamTextHeavyProductionV3CanonicalCall(target);
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    let clockCalls = 0;
    let identifierCalls = 0;
    const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => {
        clockCalls += 1;
        return Date.parse('2026-07-23T12:00:00Z');
      },
      authorizationId: () => {
        identifierCalls += 1;
        return 'f3999999-9999-4999-8999-999999999999';
      },
    });
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(prepared, reservation, sources),
    ).toThrow(/binding failed closed/u);
    expect({ clockCalls, identifierCalls }).toEqual({ clockCalls: 0, identifierCalls: 0 });
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(prepared, reservation, sources),
    ).toThrow(/already attempted authorization/u);
    const durable = inspectSamTextHeavyProductionV3DurableReservation(reservation);
    await expect(lstat(durable.claimPath)).resolves.toMatchObject({ mode: expect.any(Number) });
    await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('consumes drifted execution once and never constructs a transport or dispatches', async () => {
    const root = await createRoot();
    const valid = SAM_TEXT_HEAVY_PRODUCTION_V3_FAKE_OBSERVED_REPOSITORY_IDENTITY;
    const drift = frozenObserved({ worktreeClean: false });
    const { binding } = verifyFakeBinding({
      observations: [valid, valid, valid, valid, valid, drift],
    });
    const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
      root: root.root,
      repositoryBinding: binding,
      nonce: 'cccccccccccc',
    });
    const outputDirectory = inspectSamTextHeavyProductionV3OutputTarget(target).outputDirectory;
    const reservation = await reserveSamTextHeavyProductionV3CanonicalCall(target);
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => Date.parse('2026-07-23T12:00:00Z'),
      authorizationId: () => 'f3888888-8888-4888-8888-888888888888',
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
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'valid-deterministic-fake', candidateCount: 1 },
    });
    await expect(
      executeSamTextHeavyProductionV3({ authorized, transportFactory: factory }),
    ).rejects.toThrow(/binding failed closed/u);
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
    await expect(
      executeSamTextHeavyProductionV3({ authorized, transportFactory: factory }),
    ).rejects.toThrow(/already consumed/u);
    await expect(lstat(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows one fully bound deterministic fake transport and dispatch', async () => {
    const context = await createSamTextHeavyProductionV3TestContext('f30000000021');
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'valid-deterministic-fake', candidateCount: 1 },
    });
    try {
      const result = await executeSamTextHeavyProductionV3({
        authorized: context.authorized,
        transportFactory: factory,
      });
      expect(result).toMatchObject({
        classification: 'provider-free-deterministic-fake',
        repositoryExecutionEvidence: inspectSamTextHeavyProductionV3RepositoryExecutionBinding(
          context.repositoryBinding,
        ),
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
    } finally {
      await context.cleanup();
    }
  }, 30_000);
});
