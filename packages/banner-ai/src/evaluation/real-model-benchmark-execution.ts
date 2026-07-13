import { z } from 'zod';

import {
  CanonicalMicrosStringSchema,
  ProviderCallIdentitySchema,
  parseMicros,
} from '../jobs/cost-budget.js';
import {
  CapabilityRequestSha256Schema,
  digestValidatedCapabilityRequest,
} from '../jobs/request-digests.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { SceneAnalysisModelRequestV1Schema } from './ai-contracts.js';
import {
  AdmittedRealModelBenchmarkCorpusEntryV1Schema,
  RealModelBenchmarkCorpusManifestSha256Schema,
  RealModelBenchmarkFixtureIdSchema,
  admitRealModelBenchmarkCorpusV1,
  digestAdmittedRealModelBenchmarkCorpusV1,
} from './real-model-benchmark-corpus-manifest.js';
import {
  BenchmarkEndpointPolicyV1Schema,
  ExternalIdempotencyMechanismV1Schema,
  RealModelBenchmarkAuthorizationV1Schema,
  RealModelBenchmarkManualControlV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  digestRealModelBenchmarkAuthorizationV1,
  digestSelectedRealModelBenchmarkProfileV1,
} from './real-model-benchmark-profile.js';

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

export const RealModelBenchmarkLogicalCallKeySha256Schema =
  Sha256HexSchema.brand<'RealModelBenchmarkLogicalCallKeySha256'>();

export const deriveRealModelBenchmarkLogicalCallKeyV1 = (input: {
  readonly authorization: unknown;
  readonly admittedCorpusManifestSha256: unknown;
  readonly fixtureId: unknown;
  readonly runOrdinal: unknown;
  readonly providerRequestSha256: unknown;
}): z.infer<typeof RealModelBenchmarkLogicalCallKeySha256Schema> => {
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(input.authorization);
  const projection = {
    keyVersion: 1,
    authorizationSha256: digestRealModelBenchmarkAuthorizationV1(authorization),
    admittedCorpusManifestSha256: RealModelBenchmarkCorpusManifestSha256Schema.parse(
      input.admittedCorpusManifestSha256,
    ),
    fixtureId: RealModelBenchmarkFixtureIdSchema.parse(input.fixtureId),
    runOrdinal: z.int().min(1).max(2).parse(input.runOrdinal),
    providerRequestSha256: CapabilityRequestSha256Schema.parse(input.providerRequestSha256),
  };
  return RealModelBenchmarkLogicalCallKeySha256Schema.parse(
    sha256Hex(Buffer.from(canonicalizeJson(projection), 'utf8')),
  );
};

const PendingTimeoutRetryV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }).readonly(),
  z
    .strictObject({
      kind: z.literal('first-timeout-counted-pending-bound-review'),
      runOrdinal: z.int().min(1).max(2),
      requestSha256: CapabilityRequestSha256Schema,
      logicalCallKey: RealModelBenchmarkLogicalCallKeySha256Schema,
      mechanism: ExternalIdempotencyMechanismV1Schema,
      fullActualOrEstimatedCostMicros: CanonicalMicrosStringSchema,
      costAccounting: z.literal(
        'record-full-actual-when-known-otherwise-full-reservation-without-clipping',
      ),
      retryAuthority: z.literal(false),
      manualControl: z.literal('engaged-until-fresh-authoritative-release'),
      engagedAfterControlRevision: z.int().min(1).max(2_147_483_646),
      freshReleaseRevision: z.literal('must-be-strictly-greater-than-engaged-revision'),
    })
    .readonly(),
]);

const logicalRunProgressSchema = <const Ordinal extends 1 | 2>(ordinal: Ordinal) =>
  z
    .strictObject({
      runOrdinal: z.literal(ordinal),
      attemptedProviderCallCount: z.int().min(0).max(2),
      elapsedAttemptedProviderCallMs: z.int().min(0).max(120_000),
    })
    .superRefine((run, context) => {
      if (run.attemptedProviderCallCount === 0 && run.elapsedAttemptedProviderCallMs !== 0) {
        context.addIssue({
          code: 'custom',
          message: 'A logical run with no attempted provider call must have zero elapsed time.',
        });
      }
      if (run.elapsedAttemptedProviderCallMs > run.attemptedProviderCallCount * 60_000) {
        context.addIssue({
          code: 'custom',
          message: 'Logical-run elapsed time cannot exceed 60000 ms per attempted provider call.',
        });
      }
    })
    .readonly();

const FixtureExecutionProgressV1Schema = z
  .strictObject({
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    successfulRuns: z.int().min(0).max(2),
    providerCalls: z.int().min(0).max(3),
    retryCountAcrossBothRuns: z.int().min(0).max(1),
    failedAttemptCount: z.int().min(0).max(2),
    logicalRuns: z.tuple([logicalRunProgressSchema(1), logicalRunProgressSchema(2)]).readonly(),
    pendingTimeoutRetry: PendingTimeoutRetryV1Schema,
  })
  .superRefine((progress, context) => {
    if (progress.providerCalls !== progress.successfulRuns + progress.failedAttemptCount) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture provider calls must equal completed successes plus failures.',
      });
    }
    const logicalRunCallCount = progress.logicalRuns.reduce(
      (sum, run) => sum + run.attemptedProviderCallCount,
      0,
    );
    const logicalRunRetryCount = progress.logicalRuns.reduce(
      (sum, run) => sum + Math.max(0, run.attemptedProviderCallCount - 1),
      0,
    );
    if (
      logicalRunCallCount !== progress.providerCalls ||
      logicalRunRetryCount !== progress.retryCountAcrossBothRuns
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture call and retry counts must equal exact per-logical-run accounting.',
      });
    }
    if (
      progress.logicalRuns
        .slice(0, progress.successfulRuns)
        .some((run) => run.attemptedProviderCallCount < 1) ||
      (progress.logicalRuns[1].attemptedProviderCallCount > 0 &&
        progress.logicalRuns[0].attemptedProviderCallCount === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Successful and attempted logical runs must be recorded in exact ordinal order.',
      });
    }
  })
  .readonly();

const executionLedgerCommonShape = {
  ledgerVersion: z.literal(1),
  totalProviderCalls: z.int().min(0).max(9),
  totalRetries: z.int().min(0).max(3),
  totalFailedAttempts: z.int().min(0).max(3),
  worstCaseReservedSpendMicros: CanonicalMicrosStringSchema,
  accountedActualOrEstimatedSpend: z
    .strictObject({
      micros: CanonicalMicrosStringSchema,
      rule: z.literal(
        'actual-when-known-otherwise-full-reservation-including-failed-and-indeterminate-calls',
      ),
    })
    .readonly(),
  elapsedWallTimeMs: z.int().min(0).max(600_000),
  fixtures: z.array(FixtureExecutionProgressV1Schema).length(3).readonly(),
} as const;

type ExecutionLedgerCommonV1 = {
  readonly [Key in keyof typeof executionLedgerCommonShape]: z.output<
    (typeof executionLedgerCommonShape)[Key]
  >;
};

const addLedgerAggregateIssues = (ledger: ExecutionLedgerCommonV1, context: z.RefinementCtx) => {
  const fixtureIds = ledger.fixtures.map((fixture) => fixture.fixtureId);
  if (new Set(fixtureIds).size !== fixtureIds.length) {
    context.addIssue({ code: 'custom', message: 'Execution ledger fixture IDs must be unique.' });
  }
  const callTotal = ledger.fixtures.reduce((sum, fixture) => sum + fixture.providerCalls, 0);
  const retryTotal = ledger.fixtures.reduce(
    (sum, fixture) => sum + fixture.retryCountAcrossBothRuns,
    0,
  );
  const failureTotal = ledger.fixtures.reduce(
    (sum, fixture) => sum + fixture.failedAttemptCount,
    0,
  );
  if (
    callTotal !== ledger.totalProviderCalls ||
    retryTotal !== ledger.totalRetries ||
    failureTotal !== ledger.totalFailedAttempts
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Execution ledger aggregate counts must equal exact fixture progress sums.',
    });
  }
  const exactReservation = BigInt(ledger.totalProviderCalls) * 100_000n;
  if (parseMicros(ledger.worstCaseReservedSpendMicros) !== exactReservation) {
    context.addIssue({
      code: 'custom',
      message: 'Ledger reservation must equal exact call count times 100000 micro-USD.',
      path: ['worstCaseReservedSpendMicros'],
    });
  }
  const providerElapsed = ledger.fixtures.reduce(
    (fixtureTotal, fixture) =>
      fixtureTotal +
      fixture.logicalRuns.reduce(
        (runTotal, run) => runTotal + run.elapsedAttemptedProviderCallMs,
        0,
      ),
    0,
  );
  if (providerElapsed > ledger.elapsedWallTimeMs) {
    context.addIssue({
      code: 'custom',
      message: 'Total wall-clock time cannot be less than recorded provider-call elapsed time.',
      path: ['elapsedWallTimeMs'],
    });
  }
};

const RunningRealModelBenchmarkExecutionLedgerV1Schema = z
  .strictObject({
    ...executionLedgerCommonShape,
    status: z.literal('running-authorized-benchmark'),
  })
  .superRefine((ledger, context) => {
    addLedgerAggregateIssues(ledger, context);
    const reserved = parseMicros(ledger.worstCaseReservedSpendMicros);
    const accounted = parseMicros(ledger.accountedActualOrEstimatedSpend.micros);
    if (accounted > reserved) {
      context.addIssue({
        code: 'custom',
        message: 'A running ledger cannot carry an overrun that requires a terminal state.',
        path: ['accountedActualOrEstimatedSpend', 'micros'],
      });
    }
    for (const fixture of ledger.fixtures) {
      if (fixture.pendingTimeoutRetry.kind === 'none') {
        if (fixture.failedAttemptCount !== fixture.retryCountAcrossBothRuns) {
          context.addIssue({
            code: 'custom',
            message:
              'A running fixture without pending timeout review must account for each recovered failure as its retry.',
          });
        }
        const nextRun = fixture.logicalRuns[fixture.successfulRuns];
        if (nextRun !== undefined && nextRun.attemptedProviderCallCount !== 0) {
          context.addIssue({
            code: 'custom',
            message: 'The next running logical run cannot already contain an attempted call.',
          });
        }
      } else {
        const pendingRun = fixture.logicalRuns[fixture.pendingTimeoutRetry.runOrdinal - 1];
        if (
          fixture.retryCountAcrossBothRuns !== 0 ||
          fixture.failedAttemptCount !== 1 ||
          fixture.pendingTimeoutRetry.runOrdinal !== fixture.successfulRuns + 1 ||
          pendingRun === undefined ||
          pendingRun.attemptedProviderCallCount !== 1
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Only the first counted timeout of the current logical run can await bound retry review.',
          });
        }
        if (
          parseMicros(fixture.pendingTimeoutRetry.fullActualOrEstimatedCostMicros) > 100_000n ||
          parseMicros(ledger.accountedActualOrEstimatedSpend.micros) <
            parseMicros(fixture.pendingTimeoutRetry.fullActualOrEstimatedCostMicros)
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Pending timeout review must preserve a fully accounted non-overrun attempt cost.',
          });
        }
      }
    }
  })
  .readonly();

export const RealModelBenchmarkTerminalFailureClassV1Schema = z.enum([
  'malformed-output',
  'timeout-terminal',
  'provider-permanent-rejection',
  'policy-rejection',
  'rate-limited',
  'transient-transport',
  'indeterminate-result',
  'worker-loss',
]);

const terminalAttemptAccountingShape = {
  attemptRecorded: z.literal(true),
  fixtureId: RealModelBenchmarkFixtureIdSchema,
  runOrdinal: z.int().min(1).max(2),
  callOrdinal: z.int().min(1).max(9),
  previousAccountedActualOrEstimatedSpendMicros: CanonicalMicrosStringSchema,
  fullActualOrEstimatedCostMicros: CanonicalMicrosStringSchema,
  costAccounting: z.literal(
    'record-full-actual-when-known-otherwise-full-reservation-without-clipping',
  ),
} as const;

const TerminalAttemptV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      ...terminalAttemptAccountingShape,
      kind: z.literal('terminal-non-retryable-failure'),
      failureClass: RealModelBenchmarkTerminalFailureClassV1Schema,
    })
    .readonly(),
  z
    .strictObject({
      ...terminalAttemptAccountingShape,
      kind: z.literal('terminal-actual-cost-overrun'),
      failureClass: z.literal('actual-cost-overrun'),
    })
    .readonly(),
]);

const TerminalRealModelBenchmarkExecutionLedgerV1Schema = z
  .strictObject({
    ...executionLedgerCommonShape,
    status: z.literal('terminal-inconclusive'),
    retryAuthority: z.literal(false),
    manualControl: z.literal('engaged'),
    terminalAttempt: TerminalAttemptV1Schema,
  })
  .superRefine((ledger, context) => {
    addLedgerAggregateIssues(ledger, context);
    const targetFixture = ledger.fixtures.find(
      (fixture) => fixture.fixtureId === ledger.terminalAttempt.fixtureId,
    );
    const targetRun = targetFixture?.logicalRuns[ledger.terminalAttempt.runOrdinal - 1];
    if (
      ledger.totalProviderCalls < 1 ||
      ledger.totalFailedAttempts < 1 ||
      ledger.terminalAttempt.callOrdinal !== ledger.totalProviderCalls ||
      targetFixture === undefined ||
      targetRun === undefined ||
      targetRun.attemptedProviderCallCount < 1 ||
      ledger.terminalAttempt.runOrdinal !== targetFixture.successfulRuns + 1 ||
      targetFixture.failedAttemptCount !== targetFixture.retryCountAcrossBothRuns + 1 ||
      ledger.fixtures.some(
        (fixture) =>
          fixture.fixtureId !== ledger.terminalAttempt.fixtureId &&
          fixture.failedAttemptCount !== fixture.retryCountAcrossBothRuns,
      ) ||
      ledger.fixtures.some((fixture) => fixture.pendingTimeoutRetry.kind !== 'none')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal attempt must bind the exact last recorded failed provider call.',
        path: ['terminalAttempt'],
      });
    }
    const reserved = parseMicros(ledger.worstCaseReservedSpendMicros);
    const accounted = parseMicros(ledger.accountedActualOrEstimatedSpend.micros);
    const previousAccounted = parseMicros(
      ledger.terminalAttempt.previousAccountedActualOrEstimatedSpendMicros,
    );
    const terminalCost = parseMicros(ledger.terminalAttempt.fullActualOrEstimatedCostMicros);
    const exactPriorReservation = BigInt(ledger.totalProviderCalls - 1) * 100_000n;
    if (
      previousAccounted > exactPriorReservation ||
      accounted !== previousAccounted + terminalCost
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Terminal aggregate must equal exact prior accounting plus the full terminal-attempt amount within prior-call reservation.',
        path: ['accountedActualOrEstimatedSpend', 'micros'],
      });
    }
    if (ledger.terminalAttempt.kind === 'terminal-actual-cost-overrun') {
      if (terminalCost <= 100_000n) {
        context.addIssue({
          code: 'custom',
          message:
            'Actual-cost-overrun state requires the terminal attempted provider call itself to exceed 100000 micro-USD.',
          path: ['terminalAttempt', 'fullActualOrEstimatedCostMicros'],
        });
      }
    } else if (terminalCost > 100_000n || accounted > reserved) {
      context.addIssue({
        code: 'custom',
        message:
          'A non-overrun terminal attempt cannot exceed 100000 micro-USD or total reservation.',
        path: ['terminalAttempt', 'fullActualOrEstimatedCostMicros'],
      });
    }
    if (
      ledger.terminalAttempt.failureClass === 'timeout-terminal' &&
      !(
        targetRun?.attemptedProviderCallCount === 2 ||
        (targetRun?.attemptedProviderCallCount === 1 &&
          targetFixture?.successfulRuns === 1 &&
          targetFixture.retryCountAcrossBothRuns === 1 &&
          targetFixture.logicalRuns[0].attemptedProviderCallCount === 2 &&
          ledger.terminalAttempt.runOrdinal === 2)
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Terminal timeout must be a second timeout attempt in the run or follow a retry already consumed by the prior successful run.',
        path: ['terminalAttempt', 'failureClass'],
      });
    }
  })
  .readonly();

export const RealModelBenchmarkExecutionLedgerV1Schema = z.union([
  RunningRealModelBenchmarkExecutionLedgerV1Schema,
  TerminalRealModelBenchmarkExecutionLedgerV1Schema,
]);

const BenchmarkCallOrdinalV1Schema = z
  .strictObject({
    fixtureOrdinal: z.int().min(1).max(3),
    runOrdinal: z.int().min(1).max(2),
    retryOrdinal: z.int().min(0).max(1),
    callOrdinal: z.int().min(1).max(9),
  })
  .readonly();

const BenchmarkCallTargetV1Schema = z
  .strictObject({
    endpoint: BenchmarkEndpointPolicyV1Schema,
    serverSideSecretName: z.literal('BANNER_AI_REAL_MODEL_BENCHMARK_API_KEY'),
    logicalCall: z
      .strictObject({
        key: RealModelBenchmarkLogicalCallKeySha256Schema,
        mechanism: ExternalIdempotencyMechanismV1Schema,
      })
      .readonly(),
  })
  .readonly();

const RealModelBenchmarkCallSourceV1Schema = z
  .strictObject({
    contentType: z.literal('image/png'),
    sha256: Sha256HexSchema,
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
    bytes: z.instanceof(Uint8Array),
  })
  .superRefine((source, context) => {
    if (source.pixelWidth * source.pixelHeight > 4_194_304) {
      context.addIssue({
        code: 'custom',
        message: 'Normalized benchmark call source exceeds the exact pixel cap.',
      });
    }
  })
  .readonly();

export const prepareRealModelBenchmarkCallIntentV1 = (input: {
  readonly profile: unknown;
  readonly authorization: unknown;
  readonly admittedManifest: unknown;
  readonly admittedEntry: unknown;
  readonly normalizedSource: unknown;
  readonly request: unknown;
  readonly providerCallIdentity: unknown;
  readonly providerRequestSha256: unknown;
  readonly callTarget: unknown;
  readonly ordinals: unknown;
  readonly ledger: unknown;
  readonly manualControl: unknown;
  readonly estimatedCostMicros: unknown;
  readonly attemptedProviderCallTimeoutMs: unknown;
}) => {
  const profile = SelectedRealModelBenchmarkProfileV1Schema.parse(input.profile);
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(input.authorization);
  const manifest = admitRealModelBenchmarkCorpusV1(input.admittedManifest);
  const entry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(input.admittedEntry);
  const normalizedSource = RealModelBenchmarkCallSourceV1Schema.parse(input.normalizedSource);
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const providerCallIdentity = ProviderCallIdentitySchema.parse(input.providerCallIdentity);
  const providerRequestSha256 = CapabilityRequestSha256Schema.parse(input.providerRequestSha256);
  const callTarget = BenchmarkCallTargetV1Schema.parse(input.callTarget);
  const ordinals = BenchmarkCallOrdinalV1Schema.parse(input.ordinals);
  const ledger = RealModelBenchmarkExecutionLedgerV1Schema.parse(input.ledger);
  if (ledger.status !== 'running-authorized-benchmark') {
    throw new RangeError('A terminal benchmark ledger cannot prepare another provider call.');
  }
  const manualControl = RealModelBenchmarkManualControlV1Schema.parse(input.manualControl);
  const estimatedCostMicros = CanonicalMicrosStringSchema.parse(input.estimatedCostMicros);
  const attemptedProviderCallTimeoutMs = z
    .literal(60_000)
    .parse(input.attemptedProviderCallTimeoutMs);

  if (
    authorization.profileSha256 !== digestSelectedRealModelBenchmarkProfileV1(profile) ||
    authorization.admittedCorpusManifestSha256 !==
      digestAdmittedRealModelBenchmarkCorpusV1(manifest) ||
    !exactCanonicalEquality(authorization.candidate, profile.candidateSelection) ||
    !exactCanonicalEquality(authorization.prompt, profile.prompt) ||
    !exactCanonicalEquality(authorization.contentPolicy, profile.contentPolicy) ||
    !exactCanonicalEquality(authorization.workflow, profile.workflow) ||
    !exactCanonicalEquality(authorization.caps, profile.caps)
  ) {
    throw new TypeError('Authorization is missing, stale, substituted, or foreign to the profile.');
  }
  const authorizationSha256 = digestRealModelBenchmarkAuthorizationV1(authorization);
  if (
    manualControl.state !== 'released-for-one-bounded-benchmark' ||
    manualControl.authorizationId !== authorization.authorizationId ||
    manualControl.authorizationSha256 !== authorizationSha256 ||
    manualControl.profileId !== profile.profileId ||
    manualControl.profileSha256 !== authorization.profileSha256 ||
    manualControl.admittedCorpusManifestSha256 !== authorization.admittedCorpusManifestSha256
  ) {
    throw new TypeError(
      'Fresh authoritative manual control is engaged, re-engaged, stale, or foreign.',
    );
  }

  const manifestEntry = manifest.entries[ordinals.fixtureOrdinal - 1];
  const fixtureProgress = ledger.fixtures[ordinals.fixtureOrdinal - 1];
  if (
    manifestEntry === undefined ||
    fixtureProgress === undefined ||
    !exactCanonicalEquality(manifestEntry, entry) ||
    fixtureProgress.fixtureId !== entry.fixtureId ||
    !exactCanonicalEquality(
      ledger.fixtures.map((fixture) => fixture.fixtureId),
      manifest.entries.map((fixture) => fixture.fixtureId),
    )
  ) {
    throw new TypeError('Call fixture is missing, stale, substituted, or out of manifest order.');
  }

  const { bytes: normalizedBytes, ...normalizedMetadata } = normalizedSource;
  const inspectedSource = assertCanonicalNormalizedPng(normalizedBytes);
  if (
    !exactCanonicalEquality(normalizedMetadata, entry.normalizedTransmission) ||
    normalizedBytes.byteLength !== normalizedMetadata.byteSize ||
    sha256Hex(Buffer.from(normalizedBytes)) !== normalizedMetadata.sha256 ||
    inspectedSource.mediaType !== normalizedMetadata.contentType ||
    inspectedSource.width !== normalizedMetadata.pixelWidth ||
    inspectedSource.height !== normalizedMetadata.pixelHeight
  ) {
    throw new TypeError('Normalized source metadata differs from the admitted corpus entry.');
  }
  const candidate = profile.candidateSelection;
  if (
    !exactCanonicalEquality(request.input.fixture, entry.requestFixtureBinding) ||
    request.input.sourceAsset.sha256 !== normalizedSource.sha256 ||
    request.input.sourceAsset.mediaType !== normalizedSource.contentType ||
    request.input.sourceAsset.byteSize !== normalizedSource.byteSize ||
    request.input.sourceAsset.pixelWidth !== normalizedSource.pixelWidth ||
    request.input.sourceAsset.pixelHeight !== normalizedSource.pixelHeight ||
    !exactCanonicalEquality(request.input.model, candidate.model) ||
    !exactCanonicalEquality(request.input.prompt, profile.prompt) ||
    !exactCanonicalEquality(request.input.workflow, profile.workflow) ||
    !exactCanonicalEquality(request.input.options, profile.requestOptions) ||
    request.contentPolicy.definition.definitionSha256 !== profile.contentPolicy.definitionSha256
  ) {
    throw new TypeError('Scene-analysis request differs from the authorized profile or source.');
  }

  const expectedProviderRequestSha256 = digestValidatedCapabilityRequest(request);
  if (providerRequestSha256 !== expectedProviderRequestSha256) {
    throw new TypeError(
      'Provider request digest differs from the validated scene-analysis request.',
    );
  }
  if (
    providerCallIdentity.capability !== 'vision_analysis' ||
    providerCallIdentity.external !== true ||
    providerCallIdentity.providerKey !== candidate.model.identity.providerKey ||
    providerCallIdentity.modelKey !== candidate.model.identity.modelKey ||
    providerCallIdentity.workflowVersionId !== profile.workflow.workflowVersionId
  ) {
    throw new TypeError(
      'Provider-call identity differs from the authorized candidate or workflow.',
    );
  }
  if (
    !exactCanonicalEquality(callTarget.endpoint, candidate.endpointAllowlist[0]) ||
    callTarget.serverSideSecretName !== candidate.serverSideSecret.name ||
    !exactCanonicalEquality(
      callTarget.logicalCall.mechanism,
      candidate.timeoutReplayContract.mechanism,
    )
  ) {
    throw new TypeError(
      'Call target differs from the sole authorized endpoint, secret name, or idempotency mechanism.',
    );
  }

  const expectedLogicalCallKey = deriveRealModelBenchmarkLogicalCallKeyV1({
    authorization,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
    fixtureId: entry.fixtureId,
    runOrdinal: ordinals.runOrdinal,
    providerRequestSha256,
  });
  if (callTarget.logicalCall.key !== expectedLogicalCallKey) {
    throw new TypeError(
      'External logical-call/idempotency key differs from the exact run identity.',
    );
  }

  if (ordinals.callOrdinal !== ledger.totalProviderCalls + 1) {
    throw new RangeError('Provider call ordinal must be the exact next bounded call.');
  }
  const logicalRunProgress = fixtureProgress.logicalRuns[ordinals.runOrdinal - 1];
  if (logicalRunProgress === undefined) {
    throw new RangeError('Logical-run latency accounting is missing.');
  }
  if (fixtureProgress.pendingTimeoutRetry.kind === 'none') {
    if (
      ordinals.retryOrdinal !== 0 ||
      ordinals.runOrdinal !== fixtureProgress.successfulRuns + 1 ||
      fixtureProgress.successfulRuns >= profile.caps.requiredSuccessfulRunsPerFixture.value ||
      logicalRunProgress.attemptedProviderCallCount !== 0 ||
      logicalRunProgress.elapsedAttemptedProviderCallMs !== 0
    ) {
      throw new RangeError(
        'Initial call ordinal does not name an unattempted exact next logical run.',
      );
    }
  } else if (
    ordinals.retryOrdinal !== 1 ||
    ordinals.runOrdinal !== fixtureProgress.pendingTimeoutRetry.runOrdinal ||
    providerRequestSha256 !== fixtureProgress.pendingTimeoutRetry.requestSha256 ||
    callTarget.logicalCall.key !== fixtureProgress.pendingTimeoutRetry.logicalCallKey ||
    !exactCanonicalEquality(
      callTarget.logicalCall.mechanism,
      fixtureProgress.pendingTimeoutRetry.mechanism,
    ) ||
    manualControl.revision <= fixtureProgress.pendingTimeoutRetry.engagedAfterControlRevision ||
    fixtureProgress.retryCountAcrossBothRuns >=
      profile.caps.maxRetriesPerFixtureAcrossBothRuns.value ||
    ledger.totalRetries >= profile.caps.maxRetriesTotal.value
  ) {
    throw new RangeError('Timeout replay is not the sole identical bound fixture retry.');
  }

  const perCallCeiling = parseMicros(profile.caps.perCallCostCeiling.value);
  const totalSpendCeiling = parseMicros(profile.caps.totalBenchmarkSpendCeiling.value);
  const estimate = parseMicros(estimatedCostMicros);
  const reserved = parseMicros(ledger.worstCaseReservedSpendMicros);
  if (
    estimatedCostMicros !==
      candidate.worstCaseReservationConfig.rates.modelInferenceMicrosPerUnit ||
    estimate > perCallCeiling ||
    ledger.totalProviderCalls >= profile.caps.maxTotalProviderCalls.value ||
    ledger.totalFailedAttempts >= profile.caps.maxFailedAttempts.value ||
    fixtureProgress.failedAttemptCount >= profile.caps.maxFailedAttemptsPerFixture.value ||
    reserved + estimate > totalSpendCeiling ||
    ledger.elapsedWallTimeMs + attemptedProviderCallTimeoutMs >
      profile.caps.maxTotalWallClock.value ||
    logicalRunProgress.elapsedAttemptedProviderCallMs + attemptedProviderCallTimeoutMs >
      profile.caps.maxLatencyPerLogicalRun.value
  ) {
    throw new RangeError(
      'Remaining exact call, cost, failure, attempted-call, logical-run, or wall-time caps cannot fit the call.',
    );
  }

  return Object.freeze({
    intentVersion: 1 as const,
    kind: 'validated-future-real-model-call-intent' as const,
    profileId: profile.profileId,
    profileSha256: authorization.profileSha256,
    authorizationId: authorization.authorizationId,
    authorizationSha256,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
    fixtureId: entry.fixtureId,
    sourceSha256: normalizedSource.sha256,
    requestIdentity: request.requestIdentity,
    providerRequestSha256,
    providerCallIdentity,
    providerKey: candidate.model.identity.providerKey,
    providerModelIdentifier: candidate.providerModelIdentifier,
    immutableProviderModelVersion: candidate.immutableProviderModelVersion,
    responseIdentityRequirement: candidate.responseIdentityRequirement,
    logicalRunIdentity: {
      fixtureId: entry.fixtureId,
      runOrdinal: ordinals.runOrdinal,
      logicalCallKey: expectedLogicalCallKey,
    },
    callTarget,
    ordinals,
    estimatedCostMicros,
    attemptedProviderCallTimeoutMs,
    logicalRunElapsedBeforeAttemptMs: logicalRunProgress.elapsedAttemptedProviderCallMs,
    logicalRunMaximumElapsedMs: profile.caps.maxLatencyPerLogicalRun.value,
    manualControl: {
      controlId: manualControl.controlId,
      revision: manualControl.revision,
      state: manualControl.state,
    },
    retryAuthority: false as const,
    dispatchAuthority: false as const,
    sourceAuthority: 'plain-caller-bytes-and-metadata-are-not-authoritative' as const,
    networkDispatch: 'not-implemented-in-this-milestone' as const,
    futureExecutorRequirements: {
      freshManualControlRead: 'required-before-every-call' as const,
      trustedCorpusLoader:
        'package-owned-admitted-corpus-allowlist-with-full-normalize-decode-verification' as const,
      sourceCapability: 'unforgeable-server-side-branded-source-authority' as const,
      dispatchCapability: 'unforgeable-server-side-provider-call-capability' as const,
    },
  });
};

const attemptAccountingShape = {
  attemptRecorded: z.literal(true),
  fullActualOrEstimatedCostMicros: CanonicalMicrosStringSchema,
  costAccounting: z.literal(
    'record-full-actual-when-known-otherwise-full-reservation-without-clipping',
  ),
} as const;

export const decideRealModelBenchmarkAttemptOutcomeV1 = (input: unknown) => {
  const parsed = z
    .discriminatedUnion('kind', [
      z
        .strictObject({
          kind: z.literal('success'),
          strictOutputValid: z.literal(true),
          actualCostWithinCaps: z.literal(true),
          ...attemptAccountingShape,
        })
        .readonly(),
      z
        .strictObject({
          kind: z.literal('timeout'),
          priorFixtureRetryCount: z.int().min(0).max(1),
          ...attemptAccountingShape,
        })
        .readonly(),
      z.strictObject({ kind: z.literal('malformed-output'), ...attemptAccountingShape }).readonly(),
      z
        .strictObject({ kind: z.literal('actual-cost-overrun'), ...attemptAccountingShape })
        .readonly(),
      z
        .strictObject({
          kind: z.literal('provider-permanent-rejection'),
          ...attemptAccountingShape,
        })
        .readonly(),
      z.strictObject({ kind: z.literal('policy-rejection'), ...attemptAccountingShape }).readonly(),
      z.strictObject({ kind: z.literal('rate-limited'), ...attemptAccountingShape }).readonly(),
      z
        .strictObject({ kind: z.literal('transient-transport'), ...attemptAccountingShape })
        .readonly(),
      z
        .strictObject({ kind: z.literal('indeterminate-result'), ...attemptAccountingShape })
        .readonly(),
      z.strictObject({ kind: z.literal('worker-loss'), ...attemptAccountingShape }).readonly(),
    ])
    .parse(input);
  const attemptCost = parseMicros(parsed.fullActualOrEstimatedCostMicros);
  if (
    (parsed.kind === 'actual-cost-overrun' && attemptCost <= 100_000n) ||
    (parsed.kind !== 'actual-cost-overrun' && attemptCost > 100_000n)
  ) {
    throw new RangeError(
      'Attempt cost must use the exact actual-cost-overrun class when it exceeds 100000 micro-USD.',
    );
  }
  const exactAccounting = {
    authority: 'non-authoritative-classification-only' as const,
    recordAttempt: parsed.attemptRecorded,
    fullActualOrEstimatedCostMicros: parsed.fullActualOrEstimatedCostMicros,
    costAccounting: parsed.costAccounting,
    retryAuthority: false as const,
  };
  if (parsed.kind === 'success') {
    return Object.freeze({
      action: 'record-success-for-bound-ledger-transition' as const,
      ...exactAccounting,
    });
  }
  if (parsed.kind === 'timeout' && parsed.priorFixtureRetryCount === 0) {
    return Object.freeze({
      action: 'record-timeout-pending-bound-prepare-review' as const,
      pendingRetryReviewRequired: true as const,
      manualControl: 'engage-until-fresh-authoritative-release' as const,
      ...exactAccounting,
    });
  }
  return Object.freeze({
    action: 'record-terminal-inconclusive' as const,
    failureClass: parsed.kind === 'timeout' ? ('timeout-terminal' as const) : parsed.kind,
    manualControl: 'engaged' as const,
    ...exactAccounting,
  });
};

// This module intentionally contains no dispatcher or network client. Outcome classifications are
// explicitly non-authoritative, and every returned object has retryAuthority:false. Prepared
// intents also have dispatchAuthority:false; only a later, separately authorized executor could
// turn one into an unforgeable server-side capability.
