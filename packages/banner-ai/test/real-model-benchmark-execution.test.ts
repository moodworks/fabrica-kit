import { beforeAll, describe, expect, it } from 'vitest';

import {
  BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1,
  DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1,
  REAL_MODEL_BENCHMARK_CAPS_V1,
  ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
  RealModelBenchmarkExecutionLedgerV1Schema,
  decideRealModelBenchmarkAttemptOutcomeV1,
  deriveRealModelBenchmarkLogicalCallKeyV1,
  digestRealModelBenchmarkAuthorizationV1,
  digestValidatedCapabilityRequest,
  parseMicros,
  prepareRealModelBenchmarkCallIntentV1,
} from '../src/index.js';
import {
  admittedManifest,
  authorizationFor,
  getSyntheticBenchmarkTestSources,
  mutableClone,
  prepareSyntheticBenchmarkTestSources,
  releasedManualControlFor,
  requestFor,
  selectedProfile,
  validGateInput,
  type Mutable,
} from './support/real-model-benchmark-test-support.js';

beforeAll(prepareSyntheticBenchmarkTestSources);

const pendingRetryInput = () => {
  const input = validGateInput();
  const fixture = input.ledger.fixtures[0]!;
  return {
    ...input,
    ledger: {
      ...input.ledger,
      totalProviderCalls: 1,
      totalFailedAttempts: 1,
      worstCaseReservedSpendMicros: '100000',
      accountedActualOrEstimatedSpend: {
        ...input.ledger.accountedActualOrEstimatedSpend,
        micros: '100000',
      },
      elapsedWallTimeMs: 60_000,
      fixtures: [
        {
          ...fixture,
          providerCalls: 1,
          failedAttemptCount: 1,
          logicalRuns: [
            {
              ...fixture.logicalRuns[0]!,
              attemptedProviderCallCount: 1,
              elapsedAttemptedProviderCallMs: 60_000,
            },
            fixture.logicalRuns[1]!,
          ],
          pendingTimeoutRetry: {
            kind: 'first-timeout-counted-pending-bound-review' as const,
            runOrdinal: 1 as const,
            requestSha256: input.providerRequestSha256,
            logicalCallKey: input.callTarget.logicalCall.key,
            mechanism: input.callTarget.logicalCall.mechanism,
            fullActualOrEstimatedCostMicros: '100000',
            costAccounting:
              'record-full-actual-when-known-otherwise-full-reservation-without-clipping' as const,
            retryAuthority: false as const,
            manualControl: 'engaged-until-fresh-authoritative-release' as const,
            engagedAfterControlRevision: 10,
            freshReleaseRevision: 'must-be-strictly-greater-than-engaged-revision' as const,
          },
        },
        ...input.ledger.fixtures.slice(1),
      ],
    },
    ordinals: {
      fixtureOrdinal: 1 as const,
      runOrdinal: 1 as const,
      retryOrdinal: 1 as const,
      callOrdinal: 2,
    },
    manualControl: releasedManualControlFor(input.authorization),
  };
};

const nearLimitLedger = (manifest = admittedManifest()) => ({
  ledgerVersion: 1 as const,
  status: 'running-authorized-benchmark' as const,
  totalProviderCalls: 7,
  totalRetries: 2,
  totalFailedAttempts: 2,
  worstCaseReservedSpendMicros: '700000',
  accountedActualOrEstimatedSpend: {
    micros: '700000',
    rule: 'actual-when-known-otherwise-full-reservation-including-failed-and-indeterminate-calls' as const,
  },
  elapsedWallTimeMs: 540_000,
  fixtures: [
    {
      fixtureId: manifest.entries[0]!.fixtureId,
      successfulRuns: 2,
      providerCalls: 3,
      retryCountAcrossBothRuns: 1,
      failedAttemptCount: 1,
      logicalRuns: [
        {
          runOrdinal: 1 as const,
          attemptedProviderCallCount: 2,
          elapsedAttemptedProviderCallMs: 120_000,
        },
        {
          runOrdinal: 2 as const,
          attemptedProviderCallCount: 1,
          elapsedAttemptedProviderCallMs: 60_000,
        },
      ],
      pendingTimeoutRetry: { kind: 'none' as const },
    },
    {
      fixtureId: manifest.entries[1]!.fixtureId,
      successfulRuns: 2,
      providerCalls: 3,
      retryCountAcrossBothRuns: 1,
      failedAttemptCount: 1,
      logicalRuns: [
        {
          runOrdinal: 1 as const,
          attemptedProviderCallCount: 2,
          elapsedAttemptedProviderCallMs: 120_000,
        },
        {
          runOrdinal: 2 as const,
          attemptedProviderCallCount: 1,
          elapsedAttemptedProviderCallMs: 60_000,
        },
      ],
      pendingTimeoutRetry: { kind: 'none' as const },
    },
    {
      fixtureId: manifest.entries[2]!.fixtureId,
      successfulRuns: 1,
      providerCalls: 1,
      retryCountAcrossBothRuns: 0,
      failedAttemptCount: 0,
      logicalRuns: [
        {
          runOrdinal: 1 as const,
          attemptedProviderCallCount: 1,
          elapsedAttemptedProviderCallMs: 60_000,
        },
        {
          runOrdinal: 2 as const,
          attemptedProviderCallCount: 0,
          elapsedAttemptedProviderCallMs: 0,
        },
      ],
      pendingTimeoutRetry: { kind: 'none' as const },
    },
  ],
});

const nearLimitInput = () => {
  const profile = selectedProfile();
  const manifest = admittedManifest();
  const entry = manifest.entries[2]!;
  const request = requestFor(profile, entry, 2);
  const authorization = authorizationFor(profile, manifest);
  const base = validGateInput();
  const canonicalRequestDigest = digestValidatedCapabilityRequest(request);
  const logicalCallKey = deriveRealModelBenchmarkLogicalCallKeyV1({
    authorization,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
    fixtureId: entry.fixtureId,
    runOrdinal: 2,
    providerRequestSha256: canonicalRequestDigest,
  });
  return {
    ...base,
    profile,
    authorization,
    admittedManifest: manifest,
    admittedEntry: entry,
    normalizedSource: getSyntheticBenchmarkTestSources()[2]!.callSource,
    request,
    providerRequestSha256: canonicalRequestDigest,
    providerCallIdentity: {
      capability: 'vision_analysis',
      providerKey: profile.candidateSelection.model.identity.providerKey,
      modelKey: profile.candidateSelection.model.identity.modelKey,
      workflowVersionId: profile.workflow.workflowVersionId,
      external: true,
    },
    callTarget: {
      endpoint: profile.candidateSelection.endpointAllowlist[0],
      serverSideSecretName: profile.candidateSelection.serverSideSecret.name,
      logicalCall: {
        kind: 'evidenced-timeout-replay' as const,
        key: logicalCallKey,
        mechanism:
          authorization.retryPolicy.mode === 'one-timeout-replay-with-exact-provider-evidence'
            ? authorization.retryPolicy.mechanism
            : (() => {
                throw new TypeError('Expected test-only evidenced replay policy.');
              })(),
      },
    },
    ordinals: {
      fixtureOrdinal: 3 as const,
      runOrdinal: 2 as const,
      retryOrdinal: 0 as const,
      callOrdinal: 8,
    },
    ledger: nearLimitLedger(manifest),
    manualControl: releasedManualControlFor(authorization),
  };
};

type TerminalFailureClass =
  | 'malformed-output'
  | 'timeout-terminal'
  | 'provider-permanent-rejection'
  | 'policy-rejection'
  | 'rate-limited'
  | 'transient-transport'
  | 'indeterminate-result'
  | 'worker-loss';

const terminalLedger = (
  failureClass: TerminalFailureClass | 'actual-cost-overrun',
  fullActualOrEstimatedCostMicros = '100000',
) => {
  const manifest = admittedManifest();
  const base = mutableClone(validGateInput().ledger);
  const fixture = base.fixtures[0]!;
  fixture.providerCalls = 1;
  fixture.failedAttemptCount = 1;
  fixture.logicalRuns[0]!.attemptedProviderCallCount = 1;
  fixture.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 1_000;
  fixture.pendingTimeoutRetry = { kind: 'none' };
  base.totalProviderCalls = 1;
  base.totalFailedAttempts = 1;
  base.worstCaseReservedSpendMicros = '100000';
  base.accountedActualOrEstimatedSpend.micros = fullActualOrEstimatedCostMicros;
  base.elapsedWallTimeMs = 1_000;
  return {
    ...base,
    status: 'terminal-inconclusive' as const,
    retryAuthority: false as const,
    manualControl: 'engaged' as const,
    terminalAttempt: {
      kind:
        failureClass === 'actual-cost-overrun'
          ? ('terminal-actual-cost-overrun' as const)
          : ('terminal-non-retryable-failure' as const),
      failureClass,
      attemptRecorded: true as const,
      fixtureId: manifest.entries[0]!.fixtureId,
      runOrdinal: 1 as const,
      callOrdinal: 1,
      previousAccountedActualOrEstimatedSpendMicros: '0',
      fullActualOrEstimatedCostMicros,
      costAccounting:
        'record-full-actual-when-known-otherwise-full-reservation-without-clipping' as const,
    },
  };
};

const consistentSecondTimeoutTerminalLedger = () => {
  const ledger = terminalLedger('timeout-terminal');
  const fixture = ledger.fixtures[0]!;
  fixture.providerCalls = 2;
  fixture.failedAttemptCount = 2;
  fixture.retryCountAcrossBothRuns = 1;
  fixture.logicalRuns[0]!.attemptedProviderCallCount = 2;
  fixture.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 120_000;
  ledger.totalProviderCalls = 2;
  ledger.totalRetries = 1;
  ledger.totalFailedAttempts = 2;
  ledger.worstCaseReservedSpendMicros = '200000';
  ledger.accountedActualOrEstimatedSpend.micros = '200000';
  ledger.elapsedWallTimeMs = 120_000;
  ledger.terminalAttempt.callOrdinal = 2;
  ledger.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '100000';
  return ledger;
};

const consistentSecondRunTerminalLedger = () => {
  const ledger = terminalLedger('malformed-output');
  const fixture = ledger.fixtures[0]!;
  fixture.successfulRuns = 1;
  fixture.providerCalls = 2;
  fixture.logicalRuns[0]!.attemptedProviderCallCount = 1;
  fixture.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 1_000;
  fixture.logicalRuns[1]!.attemptedProviderCallCount = 1;
  fixture.logicalRuns[1]!.elapsedAttemptedProviderCallMs = 1_000;
  ledger.totalProviderCalls = 2;
  ledger.worstCaseReservedSpendMicros = '200000';
  ledger.accountedActualOrEstimatedSpend.micros = '200000';
  ledger.elapsedWallTimeMs = 2_000;
  return {
    ...ledger,
    terminalAttempt: {
      ...ledger.terminalAttempt,
      runOrdinal: 2 as const,
      callOrdinal: 2,
      previousAccountedActualOrEstimatedSpendMicros: '100000',
    },
  };
};

const consistentPriorRetryThenTimeoutTerminalLedger = () => {
  const ledger = consistentSecondRunTerminalLedger();
  const fixture = ledger.fixtures[0]!;
  fixture.providerCalls = 3;
  fixture.failedAttemptCount = 2;
  fixture.retryCountAcrossBothRuns = 1;
  fixture.logicalRuns[0]!.attemptedProviderCallCount = 2;
  fixture.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 2_000;
  ledger.totalProviderCalls = 3;
  ledger.totalRetries = 1;
  ledger.totalFailedAttempts = 2;
  ledger.worstCaseReservedSpendMicros = '300000';
  ledger.accountedActualOrEstimatedSpend.micros = '300000';
  ledger.elapsedWallTimeMs = 3_000;
  ledger.terminalAttempt.failureClass = 'timeout-terminal';
  ledger.terminalAttempt.callOrdinal = 3;
  ledger.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '200000';
  return ledger;
};

describe('bound execution preparation', () => {
  it('uses the exact inactive OpenAI profile and returns no retry or dispatch authority', () => {
    const input = validGateInput();
    expect(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1).toEqual(input.profile);
    expect(prepareRealModelBenchmarkCallIntentV1(input)).toMatchObject({
      kind: 'validated-future-real-model-call-intent',
      authorizationId: input.authorization.authorizationId,
      authorizationSha256: digestRealModelBenchmarkAuthorizationV1(input.authorization),
      providerKey: input.profile.candidateSelection.model.identity.providerKey,
      providerModelIdentifier: input.profile.candidateSelection.providerModelIdentifier,
      providerModelAliasStatus: 'proposed-unverified-provider-alias',
      immutableSnapshotClaim: false,
      responseIdentityRequirement: input.profile.candidateSelection.responseIdentityRequirement,
      dispatchAuthority: false,
      retryAuthority: false,
      networkDispatch: 'not-implemented-in-this-milestone',
      attemptedProviderCallTimeoutMs: 60_000,
      logicalRunMaximumElapsedMs: 120_000,
    });
  });

  it('fails closed on every missing provider/model/prompt/policy/request/workflow identity field', () => {
    const deletionCases = [
      ['provider', ['profile', 'candidateSelection', 'model', 'identity', 'providerKey']],
      ['model', ['profile', 'candidateSelection', 'model', 'identity', 'modelKey']],
      [
        'model evidence status',
        ['profile', 'candidateSelection', 'providerModelVersionEvidenceStatus'],
      ],
      ['endpoint', ['profile', 'candidateSelection', 'endpointAllowlist', '0', 'url']],
      ['request prompt', ['request', 'input', 'prompt']],
      ['request content policy', ['request', 'contentPolicy']],
      ['request identity', ['request', 'requestIdentity']],
      ['request workflow', ['request', 'input', 'workflow']],
      ['provider-call identity', ['providerCallIdentity', 'providerKey']],
      ['provider request digest', ['providerRequestSha256']],
    ] as const;
    for (const [label, path] of deletionCases) {
      const missing = mutableClone(validGateInput()) as unknown as Record<string, unknown>;
      let target = missing;
      for (const segment of path.slice(0, -1)) {
        target = target[segment] as Record<string, unknown>;
      }
      delete target[path.at(-1)!];
      expect(() => prepareRealModelBenchmarkCallIntentV1(missing as never), label).toThrow();
    }
  });

  it('requires fresh released manual control and exact source bytes and metadata', () => {
    const input = validGateInput();
    expect(() =>
      prepareRealModelBenchmarkCallIntentV1({
        ...input,
        manualControl: DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1,
      }),
    ).toThrow(/manual-control/i);
    for (const [mutate, label] of [
      [(changed: Mutable<typeof input>) => void (changed.normalizedSource.bytes[0] = 0), 'bytes'],
      [
        (changed: Mutable<typeof input>) => void (changed.normalizedSource.sha256 = 'e'.repeat(64)),
        'digest',
      ],
      [(changed: Mutable<typeof input>) => void (changed.normalizedSource.byteSize += 1), 'size'],
      [
        (changed: Mutable<typeof input>) => void (changed.normalizedSource.pixelWidth += 1),
        'dimensions',
      ],
    ] as const) {
      const changed = mutableClone(input);
      mutate(changed);
      expect(() => prepareRealModelBenchmarkCallIntentV1(changed), label).toThrow();
    }
  });

  it('validates every pending timeout replay binding and remaining cap before returning an inert intent', () => {
    const retry = pendingRetryInput();
    expect(prepareRealModelBenchmarkCallIntentV1(retry)).toMatchObject({
      retryAuthority: false,
      dispatchAuthority: false,
      logicalRunElapsedBeforeAttemptMs: 60_000,
      logicalRunMaximumElapsedMs: 120_000,
    });
    const substitutions: readonly [string, (input: Mutable<typeof retry>) => void][] = [
      [
        'candidate',
        (input) =>
          void (input.profile.candidateSelection.providerModelIdentifier =
            'other.invalid/model' as never),
      ],
      [
        'authorization',
        (input) =>
          void (input.authorization.authorizationId = 'other.test-only.authorization.invalid'),
      ],
      ['request digest', (input) => void (input.providerRequestSha256 = 'c'.repeat(64) as never)],
      ['logical key', (input) => void (input.callTarget.logicalCall.key = 'd'.repeat(64) as never)],
      [
        'mechanism',
        (input) => void (input.callTarget.logicalCall.mechanism.exactHeaderName = 'Other-Key'),
      ],
      ['stale release', (input) => void (input.manualControl.revision = 10)],
      ['remaining caps', (input) => void (input.ledger.elapsedWallTimeMs = 540_001)],
    ];
    for (const [label, mutate] of substitutions) {
      const changed = mutableClone(retry);
      mutate(changed);
      expect(() => prepareRealModelBenchmarkCallIntentV1(changed), label).toThrow();
    }
  });

  it('derives one logical key for initial/replay and another for run two', () => {
    const retry = pendingRetryInput();
    const retryIntent = prepareRealModelBenchmarkCallIntentV1(retry);
    expect(retryIntent.logicalRunIdentity.logicalCallKey).toBe(retry.callTarget.logicalCall.key);
    expect(
      deriveRealModelBenchmarkLogicalCallKeyV1({
        authorization: retry.authorization,
        admittedCorpusManifestSha256: retry.authorization.admittedCorpusManifestSha256,
        fixtureId: retry.admittedEntry.fixtureId,
        runOrdinal: 2,
        providerRequestSha256: retry.providerRequestSha256,
      }),
    ).not.toBe(retryIntent.logicalRunIdentity.logicalCallKey);
  });
});

describe('exact call, failure, spend, and latency caps', () => {
  it('uses bigint micro-USD arithmetic and exact running reservations', () => {
    const perCall = parseMicros(REAL_MODEL_BENCHMARK_CAPS_V1.perCallCostCeiling.value);
    const total = parseMicros(REAL_MODEL_BENCHMARK_CAPS_V1.totalBenchmarkSpendCeiling.value);
    expect(perCall * BigInt(REAL_MODEL_BENCHMARK_CAPS_V1.maxTotalProviderCalls.value)).toBe(total);
    expect(prepareRealModelBenchmarkCallIntentV1(nearLimitInput()).ordinals.callOrdinal).toBe(8);

    const mismatch = mutableClone(nearLimitInput());
    mismatch.ledger.worstCaseReservedSpendMicros = '700001';
    expect(() => prepareRealModelBenchmarkCallIntentV1(mismatch)).toThrow(/reservation/i);
    const oneMillisecondOver = mutableClone(nearLimitInput());
    oneMillisecondOver.ledger.elapsedWallTimeMs = 540_001;
    expect(() => prepareRealModelBenchmarkCallIntentV1(oneMillisecondOver)).toThrow(
      /caps cannot fit/i,
    );
    const oneMicroOver = mutableClone(validGateInput());
    oneMicroOver.estimatedCostMicros = '100001';
    expect(() => prepareRealModelBenchmarkCallIntentV1(oneMicroOver)).toThrow(/caps cannot fit/i);
  });

  it('accounts each attempted call inside its logical run and rejects ambiguous latency state', () => {
    expect(
      RealModelBenchmarkExecutionLedgerV1Schema.parse(pendingRetryInput().ledger).fixtures[0]!
        .logicalRuns[0],
    ).toEqual({
      runOrdinal: 1,
      attemptedProviderCallCount: 1,
      elapsedAttemptedProviderCallMs: 60_000,
    });
    const impossibleAttempt = mutableClone(pendingRetryInput());
    impossibleAttempt.ledger.fixtures[0]!.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 60_001;
    expect(() => prepareRealModelBenchmarkCallIntentV1(impossibleAttempt)).toThrow(/60000 ms/i);
    const alreadyAttemptedInitial = mutableClone(validGateInput());
    alreadyAttemptedInitial.ledger.fixtures[0]!.logicalRuns[0]!.attemptedProviderCallCount = 1;
    alreadyAttemptedInitial.ledger.fixtures[0]!.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 1;
    alreadyAttemptedInitial.ledger.fixtures[0]!.providerCalls = 1;
    alreadyAttemptedInitial.ledger.fixtures[0]!.failedAttemptCount = 1;
    alreadyAttemptedInitial.ledger.totalProviderCalls = 1;
    alreadyAttemptedInitial.ledger.totalFailedAttempts = 1;
    alreadyAttemptedInitial.ledger.worstCaseReservedSpendMicros = '100000';
    alreadyAttemptedInitial.ledger.accountedActualOrEstimatedSpend.micros = '100000';
    alreadyAttemptedInitial.ledger.elapsedWallTimeMs = 1;
    expect(() => prepareRealModelBenchmarkCallIntentV1(alreadyAttemptedInitial)).toThrow();
  });

  it('rejects before a call when global or per-fixture failure exposure is exhausted', () => {
    const base = nearLimitInput();
    const fixture = base.ledger.fixtures[2]!;
    const globalCap = {
      ...base,
      ledger: {
        ...base.ledger,
        totalProviderCalls: 8,
        totalFailedAttempts: 3,
        worstCaseReservedSpendMicros: '800000',
        accountedActualOrEstimatedSpend: {
          ...base.ledger.accountedActualOrEstimatedSpend,
          micros: '800000',
        },
        fixtures: [
          base.ledger.fixtures[0]!,
          base.ledger.fixtures[1]!,
          {
            ...fixture,
            providerCalls: 2,
            failedAttemptCount: 1,
            logicalRuns: [
              fixture.logicalRuns[0]!,
              {
                ...fixture.logicalRuns[1]!,
                attemptedProviderCallCount: 1,
                elapsedAttemptedProviderCallMs: 60_000,
              },
            ],
            pendingTimeoutRetry: {
              kind: 'first-timeout-counted-pending-bound-review' as const,
              runOrdinal: 2 as const,
              requestSha256: base.providerRequestSha256,
              logicalCallKey: base.callTarget.logicalCall.key,
              mechanism: base.callTarget.logicalCall.mechanism,
              fullActualOrEstimatedCostMicros: '100000',
              costAccounting:
                'record-full-actual-when-known-otherwise-full-reservation-without-clipping' as const,
              retryAuthority: false as const,
              manualControl: 'engaged-until-fresh-authoritative-release' as const,
              engagedAfterControlRevision: 10,
              freshReleaseRevision: 'must-be-strictly-greater-than-engaged-revision' as const,
            },
          },
        ],
      },
      ordinals: {
        ...base.ordinals,
        retryOrdinal: 1 as const,
        callOrdinal: 9,
      },
      manualControl: releasedManualControlFor(base.authorization),
    };
    expect(() => prepareRealModelBenchmarkCallIntentV1(globalCap)).toThrow(/caps cannot fit/i);

    const perFixtureCap = consistentSecondTimeoutTerminalLedger();
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(perFixtureCap).success).toBe(true);
    expect(() =>
      prepareRealModelBenchmarkCallIntentV1({ ...validGateInput(), ledger: perFixtureCap }),
    ).toThrow(/terminal benchmark ledger/i);
  });
});

describe('non-authoritative outcome classification and terminal accounting', () => {
  const accounting = {
    attemptRecorded: true as const,
    fullActualOrEstimatedCostMicros: '100000',
    costAccounting:
      'record-full-actual-when-known-otherwise-full-reservation-without-clipping' as const,
  };

  it('never grants retry authority, including for a first timeout', () => {
    const pending = decideRealModelBenchmarkAttemptOutcomeV1({
      kind: 'timeout',
      priorFixtureRetryCount: 0,
      retryPolicy: validGateInput().authorization.retryPolicy,
      ...accounting,
    });
    expect(pending).toEqual({
      action: 'record-timeout-pending-bound-prepare-review',
      pendingRetryReviewRequired: true,
      manualControl: 'engage-until-fresh-authoritative-release',
      authority: 'non-authoritative-classification-only',
      recordAttempt: true,
      fullActualOrEstimatedCostMicros: '100000',
      costAccounting: accounting.costAccounting,
      retryAuthority: false,
    });
    expect(pending.action).not.toContain('permit');
    expect(() =>
      decideRealModelBenchmarkAttemptOutcomeV1({
        kind: 'timeout',
        priorFixtureRetryCount: 0,
        retryPolicy: validGateInput().authorization.retryPolicy,
        providerAtMostOnceExecutionAndBillingContractVerified: true,
        identicalLogicalCallKeyAndMechanism: true,
        ...accounting,
      }),
    ).toThrow();
  });

  it('validates every closed terminal class and preserves its exact accounting', () => {
    const outcomeKinds = [
      'malformed-output',
      'provider-permanent-rejection',
      'policy-rejection',
      'rate-limited',
      'transient-transport',
      'indeterminate-result',
      'worker-loss',
    ] as const;
    for (const kind of outcomeKinds) {
      expect(decideRealModelBenchmarkAttemptOutcomeV1({ kind, ...accounting })).toMatchObject({
        action: 'record-terminal-inconclusive',
        failureClass: kind,
        retryAuthority: false,
        fullActualOrEstimatedCostMicros: '100000',
      });
      const ledger = RealModelBenchmarkExecutionLedgerV1Schema.parse(terminalLedger(kind));
      expect(ledger.status).toBe('terminal-inconclusive');
      if (ledger.status === 'terminal-inconclusive') {
        expect(ledger.terminalAttempt.fullActualOrEstimatedCostMicros).toBe('100000');
      }
    }
    const timeout = decideRealModelBenchmarkAttemptOutcomeV1({
      kind: 'timeout',
      priorFixtureRetryCount: 1,
      retryPolicy: validGateInput().authorization.retryPolicy,
      ...accounting,
    });
    expect(timeout).toMatchObject({
      action: 'record-terminal-inconclusive',
      failureClass: 'timeout-terminal',
      retryAuthority: false,
    });
    expect(
      decideRealModelBenchmarkAttemptOutcomeV1({
        kind: 'timeout',
        priorFixtureRetryCount: 0,
        retryPolicy: ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
        ...accounting,
      }),
    ).toMatchObject({
      action: 'record-terminal-inconclusive',
      failureClass: 'timeout-terminal',
      retryAuthority: false,
    });
    expect(
      RealModelBenchmarkExecutionLedgerV1Schema.safeParse(consistentSecondTimeoutTerminalLedger())
        .success,
    ).toBe(true);
  });

  it('binds terminal aggregate accounting to the exact prior amount and last call', () => {
    const missingPrior = consistentSecondTimeoutTerminalLedger() as unknown as {
      terminalAttempt: Record<string, unknown>;
    };
    delete missingPrior.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros;
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(missingPrior).success).toBe(false);

    const underAccounted = consistentSecondTimeoutTerminalLedger();
    underAccounted.accountedActualOrEstimatedSpend.micros = '100000';
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(underAccounted).success).toBe(false);

    const priorMismatch = consistentSecondTimeoutTerminalLedger();
    priorMismatch.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '0';
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(priorMismatch).success).toBe(false);

    const substitutedPrior = consistentSecondTimeoutTerminalLedger();
    substitutedPrior.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '100001';
    substitutedPrior.accountedActualOrEstimatedSpend.micros = '200001';
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(substitutedPrior).success).toBe(
      false,
    );
  });

  it('rejects impossible terminal chronology and an extra unrecovered non-target failure', () => {
    const secondRunTerminal = consistentSecondRunTerminalLedger();
    const alreadySuccessfulRun = {
      ...secondRunTerminal,
      terminalAttempt: {
        ...secondRunTerminal.terminalAttempt,
        runOrdinal: 1 as const,
      },
    };
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(alreadySuccessfulRun).success).toBe(
      false,
    );

    const extraNonTargetFailure = consistentSecondRunTerminalLedger();
    const nonTarget = extraNonTargetFailure.fixtures[1]!;
    nonTarget.providerCalls = 1;
    nonTarget.failedAttemptCount = 1;
    nonTarget.logicalRuns[0]!.attemptedProviderCallCount = 1;
    nonTarget.logicalRuns[0]!.elapsedAttemptedProviderCallMs = 1_000;
    extraNonTargetFailure.totalProviderCalls = 3;
    extraNonTargetFailure.totalFailedAttempts = 2;
    extraNonTargetFailure.worstCaseReservedSpendMicros = '300000';
    extraNonTargetFailure.accountedActualOrEstimatedSpend.micros = '300000';
    extraNonTargetFailure.elapsedWallTimeMs = 3_000;
    extraNonTargetFailure.terminalAttempt.callOrdinal = 3;
    extraNonTargetFailure.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '200000';
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(extraNonTargetFailure).success).toBe(
      false,
    );
  });

  it('accepts a chronologically consistent second-timeout terminal transition', () => {
    const ledger = RealModelBenchmarkExecutionLedgerV1Schema.parse(
      consistentSecondTimeoutTerminalLedger(),
    );
    expect(ledger).toMatchObject({
      status: 'terminal-inconclusive',
      totalProviderCalls: 2,
      totalRetries: 1,
      totalFailedAttempts: 2,
      accountedActualOrEstimatedSpend: { micros: '200000' },
      terminalAttempt: {
        failureClass: 'timeout-terminal',
        callOrdinal: 2,
        previousAccountedActualOrEstimatedSpendMicros: '100000',
        fullActualOrEstimatedCostMicros: '100000',
      },
    });
    expect(
      RealModelBenchmarkExecutionLedgerV1Schema.safeParse(
        consistentPriorRetryThenTimeoutTerminalLedger(),
      ).success,
    ).toBe(true);
  });

  it('preserves an actual 900001 micro-USD overrun without clipping and refuses later calls', () => {
    const decision = decideRealModelBenchmarkAttemptOutcomeV1({
      kind: 'actual-cost-overrun',
      ...accounting,
      fullActualOrEstimatedCostMicros: '900001',
    });
    expect(decision).toMatchObject({
      action: 'record-terminal-inconclusive',
      failureClass: 'actual-cost-overrun',
      fullActualOrEstimatedCostMicros: '900001',
      retryAuthority: false,
    });
    expect(() =>
      decideRealModelBenchmarkAttemptOutcomeV1({
        kind: 'malformed-output',
        ...accounting,
        fullActualOrEstimatedCostMicros: '900001',
      }),
    ).toThrow(/actual-cost-overrun class/i);
    const mislabeledOverrun = consistentSecondTimeoutTerminalLedger();
    mislabeledOverrun.terminalAttempt.kind = 'terminal-actual-cost-overrun';
    mislabeledOverrun.terminalAttempt.failureClass = 'actual-cost-overrun';
    mislabeledOverrun.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros = '100001';
    mislabeledOverrun.accountedActualOrEstimatedSpend.micros = '200001';
    const mislabeledResult = RealModelBenchmarkExecutionLedgerV1Schema.safeParse(mislabeledOverrun);
    expect(mislabeledResult.success).toBe(false);
    if (!mislabeledResult.success) {
      expect(
        mislabeledResult.error.issues.some((issue) =>
          issue.message.includes('attempted provider call itself'),
        ),
      ).toBe(true);
    }
    const ledger = RealModelBenchmarkExecutionLedgerV1Schema.parse(
      terminalLedger('actual-cost-overrun', '900001'),
    );
    expect(ledger.accountedActualOrEstimatedSpend.micros).toBe('900001');
    if (ledger.status === 'terminal-inconclusive') {
      expect(ledger.terminalAttempt.fullActualOrEstimatedCostMicros).toBe('900001');
    }
    expect(() => prepareRealModelBenchmarkCallIntentV1({ ...validGateInput(), ledger })).toThrow(
      /terminal benchmark ledger/i,
    );
    const runningOverrun = mutableClone(pendingRetryInput().ledger);
    runningOverrun.accountedActualOrEstimatedSpend.micros = '900001';
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(runningOverrun).success).toBe(false);
  });

  it('fails closed on unknown outcome classes', () => {
    expect(() =>
      decideRealModelBenchmarkAttemptOutcomeV1({ kind: 'unknown-provider-failure', ...accounting }),
    ).toThrow();
  });
});
