import { z } from 'zod';

import { FixtureUsageReservationIdentitySchema } from '../jobs/cost-budget.js';
import { createStructuredJobError, type StructuredJobError } from '../jobs/error-policy.js';
import { CurrencyCodeSchema, StepKeySchema, type CurrencyCode } from '../jobs/syntax.js';
import { EpochMillisecondsSchema } from '../jobs/timing.js';
import {
  CompositionAnalysisRequestV1Schema,
  compositionAnalysisRequestSha256,
  parseCapabilityCallContext,
  validateCompositionAnalysisResponseV1,
  type BannerCompositionAnalysisPort,
  type CapabilityCallContext,
  type CompositionAnalysisRequestV1,
} from '../ports/banner-capability-ports.js';
import { CompositionAnalysisResultV1Schema } from './composition-contracts.js';

export const ProviderFreeCompositionPolicySchema = z
  .strictObject({
    policyVersion: z.literal(1),
    externalCallsAllowed: z.literal(false),
    activation: z.literal('code-reviewed-composition-only'),
  })
  .readonly();

export type ProviderFreeCompositionPolicy = z.infer<typeof ProviderFreeCompositionPolicySchema>;

export const PROVIDER_FREE_COMPOSITION_POLICY = ProviderFreeCompositionPolicySchema.parse({
  policyVersion: 1,
  externalCallsAllowed: false,
  activation: 'code-reviewed-composition-only',
});

const enforceProviderFreePolicy = (input: unknown): ProviderFreeCompositionPolicy => {
  if (
    typeof input === 'object' &&
    input !== null &&
    (input as { readonly externalCallsAllowed?: unknown }).externalCallsAllowed === true
  ) {
    throw new ProviderFreePolicyError(
      'EXTERNAL_CALLS_DISABLED',
      'External capability calls are disabled by the provider-free composition.',
    );
  }
  return ProviderFreeCompositionPolicySchema.parse(input);
};

export class ProviderFreePolicyError extends Error {
  readonly structuredError: StructuredJobError;

  constructor(code: 'EXTERNAL_CALLS_DISABLED' | 'EXTERNAL_USAGE_REJECTED', message: string) {
    super(message);
    this.name = 'ProviderFreePolicyError';
    this.structuredError = createStructuredJobError(code, message);
  }
}

export const ProviderFreeDispatchDescriptorSchema = z
  .strictObject({
    adapter: z
      .strictObject({
        capability: z.literal('fixture_replay'),
        providerKey: z.literal('fixture'),
        modelKey: z.literal('phase1a-fixture-v1'),
        external: z.literal(false),
      })
      .readonly(),
    usage: FixtureUsageReservationIdentitySchema,
  })
  .superRefine((descriptor, context) => {
    if (
      descriptor.adapter.capability !== descriptor.usage.capability ||
      descriptor.adapter.providerKey !== descriptor.usage.providerKey ||
      descriptor.adapter.modelKey !== descriptor.usage.modelKey ||
      descriptor.adapter.external !== descriptor.usage.external
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Provider-free adapter and usage identities must match exactly.',
      });
    }
  })
  .readonly();

const trustedFixtureExecutions = new WeakSet<object>();
const trustedFixtureResults = new WeakMap<object, unknown>();

export interface TrustedProviderFreeFixtureExecution<T> {
  readonly kind: 'trusted-provider-free-fixture-execution';
  readonly descriptor: z.infer<typeof ProviderFreeDispatchDescriptorSchema>;
  readonly resultType: 'materialized-clone';
  readonly __resultType?: T;
}

export const materializeProviderFreeFixtureExecution = <T>(input: {
  readonly descriptor: z.input<typeof ProviderFreeDispatchDescriptorSchema>;
  readonly result: T;
}): TrustedProviderFreeFixtureExecution<T> => {
  const descriptor = ProviderFreeDispatchDescriptorSchema.parse(input.descriptor);
  let result: T;
  try {
    result = structuredClone(input.result);
  } catch {
    throw new TypeError('Provider-free fixture results must be materialized cloneable data.');
  }
  const execution = Object.freeze({
    kind: 'trusted-provider-free-fixture-execution' as const,
    descriptor,
    resultType: 'materialized-clone' as const,
  });
  trustedFixtureExecutions.add(execution);
  trustedFixtureResults.set(execution, result);
  return execution;
};

export const dispatchProviderFreeCapability = async <T>(input: {
  readonly policy: ProviderFreeCompositionPolicy;
  readonly execution: TrustedProviderFreeFixtureExecution<T>;
}): Promise<T> => {
  enforceProviderFreePolicy(input.policy);
  if (
    typeof input.execution !== 'object' ||
    input.execution === null ||
    !trustedFixtureExecutions.has(input.execution)
  ) {
    throw new ProviderFreePolicyError(
      'EXTERNAL_USAGE_REJECTED',
      'Capability execution was not materialized by the trusted provider-free fixture boundary.',
    );
  }
  ProviderFreeDispatchDescriptorSchema.parse(input.execution.descriptor);
  return structuredClone(trustedFixtureResults.get(input.execution)) as T;
};

const ProviderFreeCompositionAnalysisFixtureSchema = z
  .strictObject({
    request: CompositionAnalysisRequestV1Schema,
    outcomes: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .strictObject({
              kind: z.literal('success'),
              result: CompositionAnalysisResultV1Schema,
            })
            .readonly(),
          z
            .strictObject({
              kind: z.literal('failure'),
              code: z.enum([
                'PROVIDER_RATE_LIMITED',
                'PROVIDER_TEMPORARILY_UNAVAILABLE',
                'PROVIDER_REQUEST_REJECTED',
                'CAPABILITY_TIMEOUT',
                'INTERNAL_TRANSIENT',
                'INTERNAL_INVARIANT',
              ]),
            })
            .readonly(),
          z
            .strictObject({
              kind: z.literal('held-success'),
              gateKey: StepKeySchema,
              result: CompositionAnalysisResultV1Schema,
            })
            .readonly(),
          z
            .strictObject({
              kind: z.literal('held-failure'),
              gateKey: StepKeySchema,
              code: z.enum([
                'PROVIDER_RATE_LIMITED',
                'PROVIDER_TEMPORARILY_UNAVAILABLE',
                'PROVIDER_REQUEST_REJECTED',
                'CAPABILITY_TIMEOUT',
                'INTERNAL_TRANSIENT',
                'INTERNAL_INVARIANT',
              ]),
            })
            .readonly(),
        ]),
      )
      .min(1)
      .max(3)
      .readonly(),
  })
  .superRefine((fixture, context) => {
    for (const [index, outcome] of fixture.outcomes.entries()) {
      if (outcome.kind === 'success' || outcome.kind === 'held-success') {
        try {
          validateCompositionAnalysisResponseV1({
            request: fixture.request,
            result: outcome.result,
          });
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'Provider-free analysis fixture result must match its exact request.',
            path: ['outcomes', index],
          });
        }
      }
    }
  })
  .readonly();

const ProviderFreeCompositionAnalysisFixtureSetSchema = z
  .strictObject({
    initialNowMs: EpochMillisecondsSchema,
    currency: CurrencyCodeSchema,
    fixtures: z.array(ProviderFreeCompositionAnalysisFixtureSchema).min(1).max(64).readonly(),
  })
  .superRefine((fixtureSet, context) => {
    const gateKeys = new Set<string>();
    for (const [fixtureIndex, fixture] of fixtureSet.fixtures.entries()) {
      for (const [outcomeIndex, outcome] of fixture.outcomes.entries()) {
        if (outcome.kind !== 'held-success' && outcome.kind !== 'held-failure') continue;
        if (gateKeys.has(outcome.gateKey)) {
          context.addIssue({
            code: 'custom',
            message: 'Provider-free held fixture gate keys must be globally unique.',
            path: ['fixtures', fixtureIndex, 'outcomes', outcomeIndex, 'gateKey'],
          });
        }
        gateKeys.add(outcome.gateKey);
      }
    }
  })
  .readonly();

export interface TrustedProviderFreeCompositionAnalysisPort extends BannerCompositionAnalysisPort {
  readonly kind: 'trusted-provider-free-composition-analysis-fixtures';
}

export interface ProviderFreeCompositionFixtureController {
  advanceTo(nowMs: number): void;
  release(gateKey: string): void;
  pendingGateKeys(): readonly string[];
}

export interface ProviderFreeCompositionAnalysisFixtureHarness {
  readonly port: TrustedProviderFreeCompositionAnalysisPort;
  readonly controller: ProviderFreeCompositionFixtureController;
}

const trustedCompositionAnalysisPorts = new WeakSet<object>();

const scriptedFailureMessages = Object.freeze({
  PROVIDER_RATE_LIMITED: 'Synthetic fixture analysis rate limit.',
  PROVIDER_TEMPORARILY_UNAVAILABLE: 'Synthetic fixture analysis temporary outage.',
  PROVIDER_REQUEST_REJECTED: 'Synthetic fixture analysis request rejection.',
  CAPABILITY_TIMEOUT: 'Synthetic fixture analysis timeout.',
  INTERNAL_TRANSIENT: 'Synthetic fixture analysis transient internal failure.',
  INTERNAL_INVARIANT: 'Synthetic fixture analysis invariant failure.',
});

export class ProviderFreeFixtureAnalysisError extends Error {
  readonly structuredError: StructuredJobError;

  constructor(code: keyof typeof scriptedFailureMessages) {
    const message = scriptedFailureMessages[code];
    super(message);
    this.name = 'ProviderFreeFixtureAnalysisError';
    this.structuredError = createStructuredJobError(code, message);
  }
}

export const createProviderFreeCompositionAnalysisFixturePort = (
  input: unknown,
): ProviderFreeCompositionAnalysisFixtureHarness => {
  const parsed = ProviderFreeCompositionAnalysisFixtureSetSchema.parse(input);
  const fixtures = new Map<
    string,
    {
      readonly request: CompositionAnalysisRequestV1;
      readonly outcomes: z.infer<typeof ProviderFreeCompositionAnalysisFixtureSchema>['outcomes'];
      nextOutcomeIndex: number;
    }
  >();
  const gateKeys = new Set<string>();
  for (const fixture of parsed.fixtures) {
    const digest = compositionAnalysisRequestSha256(fixture.request);
    if (fixtures.has(digest)) {
      throw new TypeError('Provider-free composition fixture requests must be unique.');
    }
    fixtures.set(digest, {
      request: structuredClone(fixture.request),
      outcomes: structuredClone(fixture.outcomes),
      nextOutcomeIndex: 0,
    });
    for (const outcome of fixture.outcomes) {
      if (outcome.kind === 'held-success' || outcome.kind === 'held-failure') {
        gateKeys.add(outcome.gateKey);
      }
    }
  }

  let nowMs = parsed.initialNowMs;
  const releasedGateKeys = new Set<string>();
  const pendingGateWaiters = new Map<string, Set<() => void>>();
  const awaitGate = async (gateKey: string): Promise<void> => {
    if (releasedGateKeys.has(gateKey)) return;
    await new Promise<void>((resolve) => {
      const waiters = pendingGateWaiters.get(gateKey) ?? new Set<() => void>();
      waiters.add(resolve);
      pendingGateWaiters.set(gateKey, waiters);
    });
  };

  const controller: ProviderFreeCompositionFixtureController = Object.freeze({
    advanceTo(nowMsInput: number): void {
      const next = EpochMillisecondsSchema.parse(nowMsInput);
      if (next < nowMs) throw new RangeError('Provider-free fixture time cannot move backward.');
      nowMs = next;
    },
    release(gateKeyInput: string): void {
      const gateKey = StepKeySchema.parse(gateKeyInput);
      if (!gateKeys.has(gateKey)) {
        throw new TypeError('Provider-free fixture gate is not declared by the outcome script.');
      }
      releasedGateKeys.add(gateKey);
      for (const resolve of pendingGateWaiters.get(gateKey) ?? []) resolve();
      pendingGateWaiters.delete(gateKey);
    },
    pendingGateKeys(): readonly string[] {
      return Object.freeze([...pendingGateWaiters.keys()].sort());
    },
  });

  const findFixture = (requestInput: unknown) => {
    const request = CompositionAnalysisRequestV1Schema.parse(requestInput);
    const fixture = fixtures.get(compositionAnalysisRequestSha256(request));
    if (fixture === undefined) {
      throw new ProviderFreePolicyError(
        'EXTERNAL_USAGE_REJECTED',
        'No exact materialized provider-free composition fixture exists for this request.',
      );
    }
    return { request, fixture } as const;
  };

  const port: TrustedProviderFreeCompositionAnalysisPort = Object.freeze({
    kind: 'trusted-provider-free-composition-analysis-fixtures' as const,
    async estimate(request: CompositionAnalysisRequestV1) {
      findFixture(request);
      return Object.freeze({ micros: 0n, currency: parsed.currency });
    },
    async analyze(request: CompositionAnalysisRequestV1, context: CapabilityCallContext) {
      const call = parseCapabilityCallContext(context);
      call.cancellation.throwIfCancelled();
      if (nowMs >= call.deadlineAtMs)
        throw new ProviderFreeFixtureAnalysisError('CAPABILITY_TIMEOUT');
      const resolved = findFixture(request);
      const outcome = resolved.fixture.outcomes[resolved.fixture.nextOutcomeIndex];
      if (outcome === undefined) {
        throw new ProviderFreePolicyError(
          'EXTERNAL_USAGE_REJECTED',
          'Provider-free composition fixture outcome script is exhausted.',
        );
      }
      resolved.fixture.nextOutcomeIndex += 1;
      if (outcome.kind === 'held-success' || outcome.kind === 'held-failure') {
        await awaitGate(outcome.gateKey);
      }
      call.cancellation.throwIfCancelled();
      if (nowMs >= call.deadlineAtMs)
        throw new ProviderFreeFixtureAnalysisError('CAPABILITY_TIMEOUT');
      if (outcome.kind === 'failure' || outcome.kind === 'held-failure') {
        throw new ProviderFreeFixtureAnalysisError(outcome.code);
      }
      const result = validateCompositionAnalysisResponseV1({
        request: resolved.request,
        result: structuredClone(outcome.result),
      });
      return result;
    },
  });
  trustedCompositionAnalysisPorts.add(port);
  return Object.freeze({ port, controller });
};

const assertTrustedCompositionAnalysisPort = (
  port: BannerCompositionAnalysisPort,
): TrustedProviderFreeCompositionAnalysisPort => {
  if (typeof port !== 'object' || port === null || !trustedCompositionAnalysisPorts.has(port)) {
    throw new ProviderFreePolicyError(
      'EXTERNAL_USAGE_REJECTED',
      'Composition analysis was not created from strict materialized provider-free fixtures.',
    );
  }
  return port as TrustedProviderFreeCompositionAnalysisPort;
};

export const estimateProviderFreeCompositionAnalysis = async (input: {
  readonly policy: ProviderFreeCompositionPolicy;
  readonly port: BannerCompositionAnalysisPort;
  readonly request: CompositionAnalysisRequestV1;
}): Promise<{ readonly micros: 0n; readonly currency: CurrencyCode }> => {
  enforceProviderFreePolicy(input.policy);
  const port = assertTrustedCompositionAnalysisPort(input.port);
  const estimate = await port.estimate(CompositionAnalysisRequestV1Schema.parse(input.request));
  if (estimate.micros !== 0n) {
    throw new ProviderFreePolicyError(
      'EXTERNAL_USAGE_REJECTED',
      'Provider-free fixture analysis must estimate exactly zero micros.',
    );
  }
  return Object.freeze({ micros: 0n, currency: CurrencyCodeSchema.parse(estimate.currency) });
};

export const dispatchProviderFreeCompositionAnalysis = async (input: {
  readonly policy: ProviderFreeCompositionPolicy;
  readonly port: BannerCompositionAnalysisPort;
  readonly descriptor: z.input<typeof ProviderFreeDispatchDescriptorSchema>;
  readonly request: CompositionAnalysisRequestV1;
  readonly context: CapabilityCallContext;
}): Promise<z.infer<typeof CompositionAnalysisResultV1Schema>> => {
  enforceProviderFreePolicy(input.policy);
  const port = assertTrustedCompositionAnalysisPort(input.port);
  const request = CompositionAnalysisRequestV1Schema.parse(input.request);
  const context = parseCapabilityCallContext(input.context);
  const descriptor = ProviderFreeDispatchDescriptorSchema.parse(input.descriptor);
  const result = validateCompositionAnalysisResponseV1({
    request,
    result: await port.analyze(request, context),
  });
  return dispatchProviderFreeCapability({
    policy: input.policy,
    execution: materializeProviderFreeFixtureExecution({ descriptor, result }),
  });
};
