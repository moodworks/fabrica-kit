import { z } from 'zod';

import { byteSourceFrom, normalizeRasterUpload } from '../security/raster-upload.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  AdmittedRealModelBenchmarkCorpusEntryV1Schema,
  RealModelBenchmarkFixtureIdSchema,
  admitRealModelBenchmarkCorpusV1,
  digestAdmittedRealModelBenchmarkCorpusV1,
  type AdmittedRealModelBenchmarkCorpusEntryV1,
  type AdmittedRealModelBenchmarkCorpusManifestV1,
} from '../evaluation/real-model-benchmark-corpus-manifest.js';
import {
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  RealModelBenchmarkAuthorizationV1Schema,
  digestSelectedRealModelBenchmarkProfileV1,
  type RealModelBenchmarkAuthorizationV1,
} from '../evaluation/real-model-benchmark-profile.js';
import { RepositoryFixtureInputRefV1Schema } from '../evaluation/ai-contracts.js';
import {
  REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1,
  type RealModelBenchmarkStaticCorpusSourceV1,
} from './real-model-benchmark-corpus-source-registry.js';

export interface TrustedRealModelBenchmarkCorpusCapabilityV1 {
  readonly capabilityVersion: 1;
  readonly capabilityId: 'runtime-whole-corpus-capability-v1';
  readonly fixtureCount: 3;
  readonly sourceAuthority: 'whole-corpus-package-owned-static-registry';
}

interface VerifiedCorpusSourceV1 {
  readonly entry: AdmittedRealModelBenchmarkCorpusEntryV1;
  readonly normalizedBytes: Uint8Array;
}

interface TrustedCorpusPrivateStateV1 {
  readonly authorization: RealModelBenchmarkAuthorizationV1;
  readonly manifest: AdmittedRealModelBenchmarkCorpusManifestV1;
  readonly sources: ReadonlyMap<string, VerifiedCorpusSourceV1>;
  readonly freshnessWindows: readonly {
    readonly label: string;
    readonly reviewedAt: string;
    readonly expiresAt: string;
  }[];
  readonly earliestFreshnessExpiryMs: number;
  readonly preparedPlanKeys: Set<string>;
}

const trustedCorpusCapabilities = new WeakSet<object>();
const trustedCorpusPrivateState = new WeakMap<object, TrustedCorpusPrivateStateV1>();

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const assertFresh = (input: {
  readonly label: string;
  readonly reviewedAt: string;
  readonly expiresAt: string;
  readonly nowMs: number;
}): void => {
  const reviewedAtMs = Date.parse(input.reviewedAt);
  const expiresAtMs = Date.parse(input.expiresAt);
  if (reviewedAtMs > input.nowMs || input.nowMs >= expiresAtMs) {
    throw new TypeError(`${input.label} is not fresh at authoritative server time.`);
  }
};

const staticSourceMetadataSchema = z
  .strictObject({
    sourceVersion: z.literal(1),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    requestFixtureBinding: RepositoryFixtureInputRefV1Schema,
    filename: z.string().min(5).max(120),
    declaredContentType: z.enum(['image/jpeg', 'image/png']),
  })
  .readonly();

const validateRegistryMetadataAtomically = (
  registry: readonly RealModelBenchmarkStaticCorpusSourceV1[],
  manifestEntries: readonly AdmittedRealModelBenchmarkCorpusEntryV1[],
): readonly z.infer<typeof staticSourceMetadataSchema>[] => {
  if (registry.length !== 3) {
    throw new TypeError(
      'Trusted corpus source registry must contain exactly three package-owned local sources.',
    );
  }

  const metadata = registry.map((source) =>
    staticSourceMetadataSchema.parse({
      sourceVersion: source.sourceVersion,
      fixtureId: source.fixtureId,
      requestFixtureBinding: source.requestFixtureBinding,
      filename: source.filename,
      declaredContentType: source.declaredContentType,
    }),
  );
  const fixtureIds = metadata.map((source) => source.fixtureId);
  const fixtureBindings = metadata.map((source) => canonicalizeJson(source.requestFixtureBinding));
  if (
    new Set(fixtureIds).size !== metadata.length ||
    new Set(fixtureBindings).size !== metadata.length
  ) {
    throw new TypeError('Trusted corpus source registry contains duplicate identities.');
  }
  if (
    metadata.some((source, index) => {
      const entry = manifestEntries[index];
      return (
        entry === undefined ||
        source.fixtureId !== entry.fixtureId ||
        !exactCanonicalEquality(source.requestFixtureBinding, entry.requestFixtureBinding) ||
        source.filename !== entry.originalIngress.filename ||
        source.declaredContentType !== entry.originalIngress.declaredContentType
      );
    })
  ) {
    throw new TypeError('Trusted corpus source registry differs from the exact admitted manifest.');
  }
  return metadata;
};

export const loadTrustedRealModelBenchmarkCorpusV1 = async (input: {
  readonly manifest: unknown;
  readonly authorizationContext: unknown;
}): Promise<TrustedRealModelBenchmarkCorpusCapabilityV1> => {
  const manifest = admitRealModelBenchmarkCorpusV1(input.manifest);
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(input.authorizationContext);
  const manifestSha256 = digestAdmittedRealModelBenchmarkCorpusV1(manifest);
  if (
    authorization.profileSha256 !==
      digestSelectedRealModelBenchmarkProfileV1(OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1) ||
    authorization.admittedCorpusManifestSha256 !== manifestSha256
  ) {
    throw new TypeError('Corpus authorization profile or manifest binding is stale or foreign.');
  }

  const nowMs = Date.now();
  assertFresh({
    label: 'Benchmark authorization',
    reviewedAt: authorization.issuedAt,
    expiresAt: authorization.expiresAt,
    nowMs,
  });
  assertFresh({
    label: 'Official model/API evidence',
    reviewedAt: authorization.authorizedObservedIdentityEvidence.officialEvidenceCapturedAt,
    expiresAt: authorization.authorizedObservedIdentityEvidence.officialEvidenceExpiresAt,
    nowMs,
  });
  assertFresh({
    label: 'Worst-case request-cost proof',
    reviewedAt: authorization.worstCaseRequestCostProof.capturedAt,
    expiresAt: authorization.worstCaseRequestCostProof.expiresAt,
    nowMs,
  });
  if (authorization.retryPolicy.mode === 'one-timeout-replay-with-exact-provider-evidence') {
    assertFresh({
      label: 'Timeout-replay provider evidence',
      reviewedAt: authorization.retryPolicy.evidenceCapturedAt,
      expiresAt: authorization.retryPolicy.evidenceExpiresAt,
      nowMs,
    });
  }

  // Length is checked before any registry entry or byte source is inspected. Production therefore
  // fails here while its registry remains empty and cannot mint partial source authority.
  validateRegistryMetadataAtomically(
    REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1,
    manifest.entries,
  );

  for (const entry of manifest.entries) {
    const approval = entry.admissionReview.providerTransmissionApproval;
    assertFresh({
      label: `Admission review for ${entry.fixtureId}`,
      reviewedAt: entry.admissionReview.reviewedAt,
      expiresAt: entry.admissionReview.expiresAt,
      nowMs,
    });
    assertFresh({
      label: `Oracle review for ${entry.fixtureId}`,
      reviewedAt: entry.expectedOracle.reviewedAt,
      expiresAt: entry.expectedOracle.expiresAt,
      nowMs,
    });
    assertFresh({
      label: `Transmission approval for ${entry.fixtureId}`,
      reviewedAt: approval.reviewedAt,
      expiresAt: approval.expiresAt,
      nowMs,
    });
    if (
      approval.authorizationId !== authorization.authorizationId ||
      approval.authorizationRevision !== authorization.authorizationRevision ||
      approval.authorizationRevisionEvidenceSha256 !==
        authorization.authorizationRevisionEvidenceSha256 ||
      approval.authorizationIssuedAt !== authorization.issuedAt ||
      approval.authorizationExpiresAt !== authorization.expiresAt ||
      approval.normalizedSourceSha256 !== entry.normalizedTransmission.sha256
    ) {
      throw new TypeError(
        `Transmission approval for ${entry.fixtureId} is unapproved, stale, or authorization-bound to another run.`,
      );
    }
  }

  const verifiedSources = new Map<string, VerifiedCorpusSourceV1>();
  for (const [
    index,
    registrySource,
  ] of REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1.entries()) {
    const entry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(manifest.entries[index]);
    const originalBytes = Uint8Array.from(registrySource.originalBytes);
    if (
      originalBytes.byteLength !== entry.originalIngress.byteSize ||
      sha256Hex(originalBytes) !== entry.originalIngress.sha256
    ) {
      throw new TypeError(`Original source bytes drifted for ${entry.fixtureId}.`);
    }

    const normalized = await normalizeRasterUpload({
      bytes: byteSourceFrom(originalBytes),
      declaredMediaType: registrySource.declaredContentType,
      filename: registrySource.filename,
    });
    if (
      normalized.sourceMediaType !== entry.originalIngress.declaredContentType ||
      normalized.sourceWidth !== entry.originalIngress.pixelWidth ||
      normalized.sourceHeight !== entry.originalIngress.pixelHeight ||
      normalized.mediaType !== entry.normalizedTransmission.contentType ||
      normalized.byteSize !== entry.normalizedTransmission.byteSize ||
      normalized.width !== entry.normalizedTransmission.pixelWidth ||
      normalized.height !== entry.normalizedTransmission.pixelHeight ||
      normalized.sha256 !== entry.normalizedTransmission.sha256 ||
      normalized.bytes.byteLength !== entry.normalizedTransmission.byteSize
    ) {
      throw new TypeError(
        `Re-normalized bytes, type, dimensions, or digest drifted for ${entry.fixtureId}.`,
      );
    }
    verifiedSources.set(entry.fixtureId, {
      entry,
      normalizedBytes: Uint8Array.from(normalized.bytes),
    });
  }

  if (verifiedSources.size !== 3) {
    throw new TypeError(
      'Whole-corpus verification did not atomically validate exactly three sources.',
    );
  }

  const freshnessWindows = [
    {
      label: 'Benchmark authorization',
      reviewedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt,
    },
    {
      label: 'Official model/API evidence',
      reviewedAt: authorization.authorizedObservedIdentityEvidence.officialEvidenceCapturedAt,
      expiresAt: authorization.authorizedObservedIdentityEvidence.officialEvidenceExpiresAt,
    },
    {
      label: 'Worst-case request-cost proof',
      reviewedAt: authorization.worstCaseRequestCostProof.capturedAt,
      expiresAt: authorization.worstCaseRequestCostProof.expiresAt,
    },
    ...(authorization.retryPolicy.mode === 'one-timeout-replay-with-exact-provider-evidence'
      ? [
          {
            label: 'Timeout-replay provider evidence',
            reviewedAt: authorization.retryPolicy.evidenceCapturedAt,
            expiresAt: authorization.retryPolicy.evidenceExpiresAt,
          },
        ]
      : []),
    ...manifest.entries.flatMap((entry) => [
      {
        label: `Admission review for ${entry.fixtureId}`,
        reviewedAt: entry.admissionReview.reviewedAt,
        expiresAt: entry.admissionReview.expiresAt,
      },
      {
        label: `Oracle review for ${entry.fixtureId}`,
        reviewedAt: entry.expectedOracle.reviewedAt,
        expiresAt: entry.expectedOracle.expiresAt,
      },
      {
        label: `Transmission approval for ${entry.fixtureId}`,
        reviewedAt: entry.admissionReview.providerTransmissionApproval.reviewedAt,
        expiresAt: entry.admissionReview.providerTransmissionApproval.expiresAt,
      },
      {
        label: `Transmission-bound authorization for ${entry.fixtureId}`,
        reviewedAt: entry.admissionReview.providerTransmissionApproval.authorizationIssuedAt,
        expiresAt: entry.admissionReview.providerTransmissionApproval.authorizationExpiresAt,
      },
    ]),
  ] as const;
  const earliestFreshnessExpiryMs = Math.min(
    ...freshnessWindows.map((window) => Date.parse(window.expiresAt)),
  );

  const capability = Object.freeze({
    capabilityVersion: 1 as const,
    capabilityId: 'runtime-whole-corpus-capability-v1' as const,
    fixtureCount: 3 as const,
    sourceAuthority: 'whole-corpus-package-owned-static-registry' as const,
  });
  trustedCorpusCapabilities.add(capability);
  trustedCorpusPrivateState.set(capability, {
    authorization,
    manifest,
    sources: verifiedSources,
    freshnessWindows,
    earliestFreshnessExpiryMs,
    preparedPlanKeys: new Set<string>(),
  });
  return capability;
};

export const requireTrustedRealModelBenchmarkCorpusStateV1 = (
  capability: TrustedRealModelBenchmarkCorpusCapabilityV1,
  fixtureIdInput: unknown,
): {
  readonly authorization: RealModelBenchmarkAuthorizationV1;
  readonly entry: AdmittedRealModelBenchmarkCorpusEntryV1;
  readonly manifest: AdmittedRealModelBenchmarkCorpusManifestV1;
  readonly normalizedBytes: Uint8Array;
} => {
  const fixtureId = RealModelBenchmarkFixtureIdSchema.parse(fixtureIdInput);
  if (!trustedCorpusCapabilities.has(capability)) {
    throw new TypeError('Trusted corpus capability is absent, cloned, or structurally forged.');
  }
  const state = trustedCorpusPrivateState.get(capability);
  const source = state?.sources.get(fixtureId);
  if (state === undefined || source === undefined || state.sources.size !== 3) {
    throw new TypeError('Trusted whole-corpus private state is missing or incomplete.');
  }
  const nowMs = Date.now();
  if (nowMs >= state.earliestFreshnessExpiryMs) {
    throw new TypeError('Trusted corpus capability evidence expired after admission.');
  }
  for (const window of state.freshnessWindows) {
    assertFresh({ ...window, nowMs });
  }
  return {
    authorization: state.authorization,
    entry: source.entry,
    manifest: state.manifest,
    normalizedBytes: Uint8Array.from(source.normalizedBytes),
  };
};

export const claimTrustedRealModelBenchmarkPlanKeyV1 = (
  capability: TrustedRealModelBenchmarkCorpusCapabilityV1,
  privatePlanKey: string,
): void => {
  if (!trustedCorpusCapabilities.has(capability)) {
    throw new TypeError('Trusted corpus capability is absent, cloned, or structurally forged.');
  }
  const state = trustedCorpusPrivateState.get(capability);
  if (state === undefined || state.preparedPlanKeys.has(privatePlanKey)) {
    throw new TypeError('This exact bounded call already minted a non-dispatching request plan.');
  }
  state.preparedPlanKeys.add(privatePlanKey);
};
