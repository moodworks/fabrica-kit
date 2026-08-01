import { describe, expect, it } from 'vitest';

import {
  PRODUCT_GATE_DIFFICULTY_ANCHORS_V2,
  PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2,
  ProductGateAdmissionAttestationV2Schema,
  ProductGateCaseIdV2Schema,
  ProductGateCaseOracleV2Schema,
  ProductGateContentFamilyV2Schema,
  ProductGateDuplicateDispositionV2Schema,
  ProductGateExactSolidOracleAuthorizationV2Schema,
  ProductGateHoldoutCaseV2Schema,
  ProductGateHoldoutCorpusManifestV2Schema,
  ProductGateNormalizationIdentityV2Schema,
  ProductGatePrimaryStratumV2Schema,
  ProductGateTransmissionApprovalV2Schema,
  canonicalProductGateHoldoutCorpusBytesV2,
  canonicalProductGateHoldoutCorpusJsonV2,
  createProductGateCaseAdmissionBindingV2,
  createDeterministicProductGateHoldoutCorpusStructuralFakeV2,
  deriveProductGateHoldoutCorpusIdentityV2,
  digestProductGateHoldoutCorpusV2,
} from '../src/evaluation/product-gate-corpus-v2.js';
import { PRODUCT_GATE_DEVELOPMENT_CORPUS_V1 } from '../src/evaluation/product-gate-corpus-v1.js';
import { Sha256HexSchema } from '../src/scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';

const mutableRecord = (input: unknown): Record<string, unknown> =>
  structuredClone(input) as Record<string, unknown>;

const nestedRecord = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  record[key] as Record<string, unknown>;

const candidateSetSha256 = (candidates: readonly unknown[]) =>
  sha256Hex(Buffer.from(canonicalizeJson(candidates), 'utf8'));

const withFreshAdmissionBinding = (
  input: (typeof PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases)[number],
) => {
  const entry = structuredClone(input);
  return {
    ...entry,
    admissionBinding: createProductGateCaseAdmissionBindingV2({
      corpusIdentitySha256: entry.corpusIdentitySha256,
      caseId: entry.caseId,
      contentFamily: entry.contentFamily,
      difficulty: entry.difficulty,
      difficultyAnchor: entry.difficultyAnchor,
      primaryStratum: entry.primaryStratum,
      backgroundMode: entry.backgroundMode,
      source: entry.source,
      normalization: entry.normalization,
      sourceProvenance: entry.sourceProvenance,
      rights: entry.rights,
      metadataPrivacyReview: entry.metadataPrivacyReview,
      duplicateDisposition: entry.duplicateDisposition,
      oracle: entry.oracle,
      attestation: entry.attestation,
      transmissionApproval: entry.transmissionApproval,
    }),
  };
};

const withReboundCorpusIdentity = (
  input: readonly (typeof PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases)[number][],
) => {
  const initiallyBound = input.map((entry) =>
    ProductGateHoldoutCaseV2Schema.parse(withFreshAdmissionBinding(entry)),
  );
  const corpusIdentitySha256 = Sha256HexSchema.parse(
    deriveProductGateHoldoutCorpusIdentityV2(initiallyBound),
  );
  const cases = initiallyBound.map((entry) => {
    const backgroundRequirement =
      entry.oracle.backgroundRequirement.mode === 'reconstruction-required'
        ? entry.oracle.backgroundRequirement
        : {
            ...entry.oracle.backgroundRequirement,
            exactSolidAuthorization: {
              ...entry.oracle.backgroundRequirement.exactSolidAuthorization,
              corpusIdentitySha256,
            },
          };
    const oracle = ProductGateCaseOracleV2Schema.parse({
      ...entry.oracle,
      corpusIdentitySha256,
      backgroundRequirement,
    });
    return ProductGateHoldoutCaseV2Schema.parse(
      withFreshAdmissionBinding({ ...entry, corpusIdentitySha256, oracle }),
    );
  });
  return { corpusIdentitySha256, cases };
};

describe('Phase 3B holdout corpus structure V2', () => {
  it('requires exactly eighteen cases across nine two-case family/difficulty strata', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    expect(manifest.cases).toHaveLength(18);
    expect(new Set(manifest.cases.map((entry) => entry.caseId))).toHaveLength(18);
    expect(ProductGatePrimaryStratumV2Schema.options).toHaveLength(9);

    for (const stratum of ProductGatePrimaryStratumV2Schema.options) {
      const cases = manifest.cases.filter((entry) => entry.primaryStratum === stratum);
      expect(cases).toHaveLength(2);
      expect(cases.map((entry) => entry.backgroundMode).toSorted()).toEqual([
        'exact-solid-eligible',
        'reconstruction-required',
      ]);
    }

    const familyCounts = Object.groupBy(manifest.cases, (entry) => entry.contentFamily.family);
    expect(familyCounts['subject-product-led']).toHaveLength(6);
    expect(familyCounts['text-heavy']).toHaveLength(6);
    expect(familyCounts['layered-graphic-no-text']).toHaveLength(6);

    const difficultyCounts = Object.groupBy(manifest.cases, (entry) => entry.difficulty);
    expect(difficultyCounts.easy).toHaveLength(6);
    expect(difficultyCounts.moderate).toHaveLength(6);
    expect(difficultyCounts.hard).toHaveLength(6);
    expect(
      manifest.cases.filter(
        (entry) => entry.difficultyAnchor === PRODUCT_GATE_DIFFICULTY_ANCHORS_V2[entry.difficulty],
      ),
    ).toHaveLength(18);

    expect(manifest.cases.filter((entry) => entry.contentFamily.textHeavy)).toHaveLength(6);
    expect(manifest.cases.filter((entry) => !entry.contentFamily.textHeavy)).toHaveLength(12);
    const subjectCases = manifest.cases.filter(
      (entry) => entry.contentFamily.family === 'subject-product-led',
    );
    expect(
      subjectCases.filter(
        (entry) =>
          entry.contentFamily.family === 'subject-product-led' &&
          entry.contentFamily.leadKind === 'person',
      ),
    ).toHaveLength(3);
    expect(
      subjectCases.filter(
        (entry) =>
          entry.contentFamily.family === 'subject-product-led' &&
          entry.contentFamily.leadKind === 'product',
      ),
    ).toHaveLength(3);
    expect(
      manifest.cases.filter((entry) => entry.backgroundMode === 'exact-solid-eligible'),
    ).toHaveLength(9);
    expect(
      manifest.cases.filter((entry) => entry.backgroundMode === 'reconstruction-required'),
    ).toHaveLength(9);
  });

  it('makes all three content-family definitions mutually exclusive and strict', () => {
    expect(
      ProductGateContentFamilyV2Schema.parse({
        family: 'subject-product-led',
        leadKind: 'person',
        visibleText: 'light-to-moderate-copy',
        textHeavy: false,
      }),
    ).toMatchObject({ family: 'subject-product-led', leadKind: 'person' });
    expect(
      ProductGateContentFamilyV2Schema.safeParse({
        family: 'subject-product-led',
        leadKind: 'person',
        visibleText: 'light-to-moderate-copy',
        textHeavy: true,
      }).success,
    ).toBe(false);
    expect(
      ProductGateContentFamilyV2Schema.safeParse({
        family: 'text-heavy',
        leadKind: 'product',
        visibleText: 'text-heavy-copy',
        textHeavy: true,
      }).success,
    ).toBe(false);
    expect(
      ProductGateContentFamilyV2Schema.safeParse({
        family: 'layered-graphic-no-text',
        visibleText: 'text-heavy-copy',
        textHeavy: false,
      }).success,
    ).toBe(false);
  });

  it('binds mutually exclusive family classification to authoritative oracle roles', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    const layered = manifest.cases.find(
      (entry) => entry.contentFamily.family === 'layered-graphic-no-text',
    )!;
    const textHeavy = manifest.cases.find((entry) => entry.contentFamily.family === 'text-heavy')!;
    const personLed = manifest.cases.find(
      (entry) =>
        entry.contentFamily.family === 'subject-product-led' &&
        entry.contentFamily.leadKind === 'person',
    )!;
    const semanticMutation = (
      entry: typeof layered,
      fromRole: 'foreground' | 'text' | 'subject',
      toRole: 'foreground' | 'decoration' | 'text',
    ) => {
      const oracle = ProductGateCaseOracleV2Schema.parse({
        ...entry.oracle,
        requiredLayers: entry.oracle.requiredLayers.map((layer) =>
          layer.semanticRole === fromRole ? { ...layer, semanticRole: toRole } : layer,
        ),
      });
      return withFreshAdmissionBinding({ ...entry, oracle });
    };

    expect(
      ProductGateHoldoutCaseV2Schema.safeParse(semanticMutation(layered, 'foreground', 'text'))
        .success,
    ).toBe(false);
    expect(
      ProductGateHoldoutCaseV2Schema.safeParse(semanticMutation(textHeavy, 'text', 'decoration'))
        .success,
    ).toBe(false);
    expect(
      ProductGateHoldoutCaseV2Schema.safeParse(semanticMutation(personLed, 'subject', 'foreground'))
        .success,
    ).toBe(false);
  });

  it('binds admission to full classification, source, normalization, and oracle records', () => {
    const base = createDeterministicProductGateHoldoutCorpusStructuralFakeV2().cases[0]!;
    expect(base.admissionBinding).toMatchObject({
      bindingContractIdentity: 'banner-ai-product-gate-case-admission-v2',
    });
    const sourceMutation = {
      ...base,
      source: { ...base.source, byteSize: base.source.byteSize + 1 },
    };
    const normalizationMutation = {
      ...base,
      normalization: ProductGateNormalizationIdentityV2Schema.parse({
        ...base.normalization,
        normalizationSpecificationSha256: 'f'.repeat(64),
      }),
    };
    const authorization = base.oracle.backgroundRequirement.exactSolidAuthorization!;
    const oracleMutation = {
      ...base,
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...base.oracle,
        backgroundRequirement: {
          ...base.oracle.backgroundRequirement,
          exactSolidAuthorization: { ...authorization, exactRgba: [1, 2, 3, 255] },
        },
      }),
    };
    for (const mutation of [sourceMutation, normalizationMutation, oracleMutation]) {
      expect(ProductGateHoldoutCaseV2Schema.safeParse(mutation).success).toBe(false);
    }
    expect(
      ProductGateHoldoutCaseV2Schema.parse(withFreshAdmissionBinding(sourceMutation)),
    ).toBeDefined();
    expect(
      ProductGateHoldoutCaseV2Schema.parse(withFreshAdmissionBinding(normalizationMutation)),
    ).toBeDefined();
    expect(
      ProductGateHoldoutCaseV2Schema.parse(withFreshAdmissionBinding(oracleMutation)),
    ).toBeDefined();
  });

  it('rejects committed development artifacts using metadata only', () => {
    const base = createDeterministicProductGateHoldoutCorpusStructuralFakeV2().cases.find(
      (entry) => entry.backgroundMode === 'reconstruction-required',
    )!;
    const developmentOriginalSha256 =
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0]!.original.sha256;
    const sourceDuplicate = withFreshAdmissionBinding({
      ...base,
      source: { ...base.source, sha256: developmentOriginalSha256 },
      normalization: { ...base.normalization, sourceSha256: developmentOriginalSha256 },
      sourceProvenance: { ...base.sourceProvenance, sourceSha256: developmentOriginalSha256 },
      rights: { ...base.rights, sourceSha256: developmentOriginalSha256 },
      metadataPrivacyReview: {
        ...base.metadataPrivacyReview,
        sourceSha256: developmentOriginalSha256,
      },
      duplicateDisposition: {
        ...base.duplicateDisposition,
        sourceSha256: developmentOriginalSha256,
      },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...base.oracle,
        originalSourceSha256: developmentOriginalSha256,
      }),
      transmissionApproval: {
        ...base.transmissionApproval,
        originalSourceSha256: developmentOriginalSha256,
      },
    });
    expect(ProductGateHoldoutCaseV2Schema.safeParse(sourceDuplicate).success).toBe(false);

    const developmentNormalizedSha256 =
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0]!.normalized.sha256;
    const normalizedDuplicate = withFreshAdmissionBinding({
      ...base,
      normalization: {
        ...base.normalization,
        normalizedArtifactSha256: developmentNormalizedSha256,
      },
      duplicateDisposition: {
        ...base.duplicateDisposition,
        normalizedArtifactSha256: developmentNormalizedSha256,
      },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...base.oracle,
        normalizedSourceSha256: developmentNormalizedSha256,
      }),
      transmissionApproval: {
        ...base.transmissionApproval,
        normalizedSourceSha256: developmentNormalizedSha256,
      },
    });
    expect(ProductGateHoldoutCaseV2Schema.safeParse(normalizedDuplicate).success).toBe(false);
    expect(base.duplicateDisposition.developmentCorpusManifestSha256).toBe(
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256,
    );
  });

  it('rejects missing, duplicate, development-fixture, and non-opaque case identities', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    const { manifestSha256: ignoredManifestSha256, ...core } = manifest;
    void ignoredManifestSha256;
    expect(() =>
      digestProductGateHoldoutCorpusV2({ ...core, cases: core.cases.slice(0, 17) }),
    ).toThrow();

    const duplicateIds = [...core.cases];
    const duplicateIdCase = duplicateIds[1]!;
    const duplicateCaseId = duplicateIds[0]!.caseId;
    duplicateIds[1] = withFreshAdmissionBinding({
      ...duplicateIdCase,
      caseId: duplicateCaseId,
      duplicateDisposition: {
        ...duplicateIdCase.duplicateDisposition,
        caseId: duplicateCaseId,
        humanReview: {
          ...duplicateIdCase.duplicateDisposition.humanReview,
          reviewedCaseId: duplicateCaseId,
        },
      },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...duplicateIdCase.oracle,
        caseId: duplicateCaseId,
      }),
      transmissionApproval: {
        ...duplicateIdCase.transmissionApproval,
        caseId: duplicateCaseId,
      },
    });
    const reboundDuplicateIds = withReboundCorpusIdentity(duplicateIds);
    expect(() =>
      digestProductGateHoldoutCorpusV2({
        ...core,
        corpusIdentitySha256: reboundDuplicateIds.corpusIdentitySha256,
        cases: reboundDuplicateIds.cases,
      }),
    ).toThrow(/case IDs must be unique/u);

    const missingId = mutableRecord(core.cases[0]);
    delete missingId.caseId;
    expect(ProductGateHoldoutCaseV2Schema.safeParse(missingId).success).toBe(false);
    for (const developmentId of [
      'banner-person-v1',
      'banner-product-v1',
      'banner-text-heavy-v1',
      'banner-no-text-v1',
    ]) {
      expect(ProductGateCaseIdV2Schema.safeParse(developmentId).success).toBe(false);
      expect(
        ProductGateHoldoutCaseV2Schema.safeParse({ ...core.cases[0], caseId: developmentId })
          .success,
      ).toBe(false);
    }
    expect(ProductGateCaseIdV2Schema.safeParse('easy-person-solid-case').success).toBe(false);
  });

  it('rejects exact-byte, normalized-artifact, and normalized-pixel duplicates', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    const { manifestSha256: ignoredManifestSha256, ...core } = manifest;
    void ignoredManifestSha256;

    const exactBytes = [...structuredClone(core.cases)];
    const exactCase = exactBytes[1]!;
    const exactSha256 = exactBytes[0]!.source.sha256;
    exactBytes[1] = withFreshAdmissionBinding({
      ...exactCase,
      source: { ...exactCase.source, sha256: exactSha256 },
      normalization: { ...exactCase.normalization, sourceSha256: exactSha256 },
      sourceProvenance: { ...exactCase.sourceProvenance, sourceSha256: exactSha256 },
      rights: { ...exactCase.rights, sourceSha256: exactSha256 },
      metadataPrivacyReview: { ...exactCase.metadataPrivacyReview, sourceSha256: exactSha256 },
      duplicateDisposition: { ...exactCase.duplicateDisposition, sourceSha256: exactSha256 },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...exactCase.oracle,
        originalSourceSha256: exactSha256,
      }),
      transmissionApproval: {
        ...exactCase.transmissionApproval,
        originalSourceSha256: exactSha256,
      },
    });
    const reboundExact = withReboundCorpusIdentity(exactBytes);
    expect(() =>
      digestProductGateHoldoutCorpusV2({
        ...core,
        corpusIdentitySha256: reboundExact.corpusIdentitySha256,
        cases: reboundExact.cases,
      }),
    ).toThrow(/Exact source byte identities/u);

    const normalizedArtifacts = [...structuredClone(core.cases)];
    const normalizedCase = normalizedArtifacts[3]!;
    const normalizedArtifactSha256 = normalizedArtifacts[2]!.normalization.normalizedArtifactSha256;
    normalizedArtifacts[3] = withFreshAdmissionBinding({
      ...normalizedCase,
      normalization: {
        ...normalizedCase.normalization,
        normalizedArtifactSha256,
      },
      duplicateDisposition: {
        ...normalizedCase.duplicateDisposition,
        normalizedArtifactSha256,
      },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...normalizedCase.oracle,
        normalizedSourceSha256: normalizedArtifactSha256,
      }),
      transmissionApproval: {
        ...normalizedCase.transmissionApproval,
        normalizedSourceSha256: normalizedArtifactSha256,
      },
    });
    const reboundArtifacts = withReboundCorpusIdentity(normalizedArtifacts);
    expect(() =>
      digestProductGateHoldoutCorpusV2({
        ...core,
        corpusIdentitySha256: reboundArtifacts.corpusIdentitySha256,
        cases: reboundArtifacts.cases,
      }),
    ).toThrow(/Normalized artifact identities/u);

    const normalizedPixels = [...structuredClone(core.cases)];
    const pixelCase = normalizedPixels[5]!;
    const normalizedPixelSha256 = normalizedPixels[4]!.normalization.normalizedPixelSha256;
    normalizedPixels[5] = withFreshAdmissionBinding({
      ...pixelCase,
      normalization: {
        ...pixelCase.normalization,
        normalizedPixelSha256,
      },
      duplicateDisposition: { ...pixelCase.duplicateDisposition, normalizedPixelSha256 },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...pixelCase.oracle,
        normalizedPixelSha256,
      }),
    });
    const reboundPixels = withReboundCorpusIdentity(normalizedPixels);
    expect(() =>
      digestProductGateHoldoutCorpusV2({
        ...core,
        corpusIdentitySha256: reboundPixels.corpusIdentitySha256,
        cases: reboundPixels.cases,
      }),
    ).toThrow(/Normalized pixel identities/u);

    const crossKind = [...structuredClone(core.cases)];
    const crossKindCase = crossKind[7]!;
    const crossKindSha256 = crossKind[6]!.normalization.normalizedArtifactSha256;
    crossKind[7] = withFreshAdmissionBinding({
      ...crossKindCase,
      source: { ...crossKindCase.source, sha256: crossKindSha256 },
      normalization: { ...crossKindCase.normalization, sourceSha256: crossKindSha256 },
      sourceProvenance: { ...crossKindCase.sourceProvenance, sourceSha256: crossKindSha256 },
      rights: { ...crossKindCase.rights, sourceSha256: crossKindSha256 },
      metadataPrivacyReview: {
        ...crossKindCase.metadataPrivacyReview,
        sourceSha256: crossKindSha256,
      },
      duplicateDisposition: {
        ...crossKindCase.duplicateDisposition,
        sourceSha256: crossKindSha256,
      },
      oracle: ProductGateCaseOracleV2Schema.parse({
        ...crossKindCase.oracle,
        originalSourceSha256: crossKindSha256,
      }),
      transmissionApproval: {
        ...crossKindCase.transmissionApproval,
        originalSourceSha256: crossKindSha256,
      },
    });
    const reboundCrossKind = withReboundCorpusIdentity(crossKind);
    expect(() =>
      digestProductGateHoldoutCorpusV2({
        ...core,
        corpusIdentitySha256: reboundCrossKind.corpusIdentitySha256,
        cases: reboundCrossKind.cases,
      }),
    ).toThrow(/every case artifact kind/u);
  });

  it('treats perceptual methods only as flags and requires human near-duplicate disposition', () => {
    const base = createDeterministicProductGateHoldoutCorpusStructuralFakeV2().cases[0]!;
    const candidate = {
      candidateVersion: 2,
      comparisonScope: 'development-corpus',
      opaqueComparisonIdentitySha256: '1'.repeat(64),
      candidateReason: 'same-template-creative',
      perceptualEvidenceSha256: '2'.repeat(64),
    } as const;
    expect(
      ProductGateDuplicateDispositionV2Schema.safeParse({
        ...base.duplicateDisposition,
        perceptualCandidates: [candidate],
        humanReview: {
          status: 'not-required-no-candidates',
          reviewerRole: null,
          reviewedAt: null,
          reviewEvidenceSha256: null,
          materialNearDuplicate: false,
        },
      }).success,
    ).toBe(false);
    expect(base.duplicateDisposition.humanReview).toMatchObject({
      status: 'completed',
      materialNearDuplicate: false,
    });

    const humanReviewedMaterialDuplicate = {
      ...base.duplicateDisposition,
      perceptualCandidates: [candidate],
      humanReview: {
        status: 'completed',
        reviewerRole: 'duplicate-reviewer',
        reviewerIdentitySha256: '4'.repeat(64),
        reviewedCaseId: base.caseId,
        reviewedCandidateSetSha256: candidateSetSha256([candidate]),
        reviewedAt: '2026-01-03T00:00:00.000Z',
        reviewEvidenceSha256: '3'.repeat(64),
        materialNearDuplicate: true,
      },
      disposition: 'rejected-replacement-required',
      replacementRequired: true,
    } as const;
    const parsedMaterialDuplicate = ProductGateDuplicateDispositionV2Schema.parse(
      humanReviewedMaterialDuplicate,
    );
    expect(parsedMaterialDuplicate).toMatchObject({
      disposition: 'rejected-replacement-required',
      replacementRequired: true,
    });
    expect(
      ProductGateHoldoutCaseV2Schema.safeParse({
        ...withFreshAdmissionBinding({
          ...base,
          duplicateDisposition: parsedMaterialDuplicate,
        }),
      }).success,
    ).toBe(false);

    for (const comparison of ['exactByteComparison', 'normalizedPixelComparison'] as const) {
      const rejected = {
        ...base.duplicateDisposition,
        [comparison]: {
          ...base.duplicateDisposition[comparison],
          againstDevelopmentCorpus: 'match',
        },
        disposition: 'rejected-replacement-required',
        replacementRequired: true,
      } as const;
      expect(ProductGateDuplicateDispositionV2Schema.parse(rejected)).toMatchObject({
        replacementRequired: true,
      });
    }
  });

  it('requires complete provenance, rights, privacy, attestation, oracle, and transmission records', () => {
    const base = createDeterministicProductGateHoldoutCorpusStructuralFakeV2().cases[0]!;
    const missingRecords: Array<[string, string]> = [
      ['sourceProvenance', 'acquisitionEvidenceSha256'],
      ['rights', 'permissions'],
      ['metadataPrivacyReview', 'secrets'],
      ['attestation', 'reviewerRole'],
      ['oracle', 'oracleEvidenceSha256'],
      ['transmissionApproval', 'endpoint'],
    ];
    for (const [recordName, fieldName] of missingRecords) {
      const candidate = mutableRecord(base);
      delete nestedRecord(candidate, recordName)[fieldName];
      expect(ProductGateHoldoutCaseV2Schema.safeParse(candidate).success).toBe(false);
    }

    expect(
      ProductGateAdmissionAttestationV2Schema.safeParse({
        ...base.attestation,
        expiresAt: base.attestation.attestedAt,
      }).success,
    ).toBe(false);
    expect(
      ProductGateTransmissionApprovalV2Schema.safeParse({
        ...base.transmissionApproval,
        expiresAt: base.transmissionApproval.approvedAt,
      }).success,
    ).toBe(false);
    expect(
      ProductGateHoldoutCaseV2Schema.safeParse({
        ...base,
        rights: { ...base.rights, rightsEvidenceSha256: 'f'.repeat(64) },
      }).success,
    ).toBe(false);
    const acquiredAfterApproval = withFreshAdmissionBinding({
      ...base,
      sourceProvenance: {
        ...base.sourceProvenance,
        acquiredAt: '2026-01-03T00:00:00.000Z',
      },
    });
    expect(ProductGateHoldoutCaseV2Schema.safeParse(acquiredAfterApproval).success).toBe(false);
  });

  it('binds an exact RGBA solid authorization and forbids it for reconstruction cases', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    const solid = manifest.cases.find((entry) => entry.backgroundMode === 'exact-solid-eligible')!;
    const reconstruction = manifest.cases.find(
      (entry) => entry.backgroundMode === 'reconstruction-required',
    )!;
    const authorization = solid.oracle.backgroundRequirement.exactSolidAuthorization;
    expect(ProductGateExactSolidOracleAuthorizationV2Schema.parse(authorization)).toMatchObject({
      corpusIdentitySha256: manifest.corpusIdentitySha256,
      caseId: solid.caseId,
      originalSourceSha256: solid.source.sha256,
      normalizedSourceSha256: solid.normalization.normalizedArtifactSha256,
      normalizedPixelSha256: solid.normalization.normalizedPixelSha256,
      oracleSha256: solid.oracle.oracleSha256,
      proposalId: solid.oracle.proposalId,
      authorized: true,
    });
    expect(authorization?.exactRgba).toHaveLength(4);

    expect(
      ProductGateCaseOracleV2Schema.safeParse({
        ...solid.oracle,
        backgroundRequirement: {
          ...solid.oracle.backgroundRequirement,
          exactSolidAuthorization: {
            ...authorization,
            caseId: reconstruction.caseId,
          },
        },
      }).success,
    ).toBe(false);
    expect(reconstruction.oracle.backgroundRequirement).toEqual({
      mode: 'reconstruction-required',
      solidFallbackAuthorized: false,
      exactSolidAuthorization: null,
    });
    expect(
      ProductGateCaseOracleV2Schema.safeParse({
        ...reconstruction.oracle,
        backgroundRequirement: {
          mode: 'reconstruction-required',
          solidFallbackAuthorized: true,
          exactSolidAuthorization: authorization,
        },
      }).success,
    ).toBe(false);
  });

  it('uses separate source-bound provider/model/endpoint-specific transmission metadata', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    for (const entry of manifest.cases) {
      expect(
        ProductGateTransmissionApprovalV2Schema.parse(entry.transmissionApproval),
      ).toMatchObject({
        caseId: entry.caseId,
        originalSourceSha256: entry.source.sha256,
        normalizedSourceSha256: entry.normalization.normalizedArtifactSha256,
        provider: { key: 'structural-fake-provider' },
        model: { key: 'structural-fake-model' },
        endpoint: { key: 'structural-fake-endpoint', method: 'POST' },
      });
    }
    expect(new Set(manifest.cases.map((entry) => entry.transmissionApproval.caseId))).toHaveLength(
      18,
    );
  });

  it('replays with stable canonical serialization and a bound manifest digest', () => {
    const first = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    const second = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    expect(second).toEqual(first);
    expect(canonicalProductGateHoldoutCorpusJsonV2(second)).toBe(
      canonicalProductGateHoldoutCorpusJsonV2(first),
    );
    expect(Buffer.from(canonicalProductGateHoldoutCorpusBytesV2(second))).toEqual(
      Buffer.from(canonicalProductGateHoldoutCorpusBytesV2(first)),
    );
    const { manifestSha256, ...core } = first;
    expect(digestProductGateHoldoutCorpusV2(core)).toBe(manifestSha256);
    expect(deriveProductGateHoldoutCorpusIdentityV2(first.cases)).toBe(first.corpusIdentitySha256);
    expect(ProductGateHoldoutCorpusManifestV2Schema.parse(first)).toEqual(first);
  });

  it('rejects unknown fields and grants no asset, provider, holdout, or evaluation authority', () => {
    const manifest = createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
    expect(
      ProductGateHoldoutCorpusManifestV2Schema.safeParse({ ...manifest, unexpected: true }).success,
    ).toBe(false);
    expect(
      ProductGateHoldoutCaseV2Schema.safeParse({ ...manifest.cases[0], privatePath: '/tmp/x' })
        .success,
    ).toBe(false);
    expect(
      ProductGateTransmissionApprovalV2Schema.safeParse({
        ...manifest.cases[0]!.transmissionApproval,
        endpointUrl: 'https://example.invalid',
      }).success,
    ).toBe(false);
    expect(manifest).toMatchObject({
      status: 'structural-validation-only',
      developmentFixtureCountInDenominator: 0,
      actualHoldoutAssetsPresent: false,
      holdoutAssetBytesAccessible: false,
      holdoutAdmissionAuthority: false,
      holdoutAccessAuthority: false,
      providerStackFrozen: false,
      providerTransmissionAuthority: false,
      providerCallAuthority: false,
      realEvaluationAuthority: false,
      authoritativeGdnAuthority: false,
    });
    expect(
      manifest.cases.every(
        (entry) =>
          !entry.actualAssetPresent &&
          !entry.sourceBytesAccessible &&
          !entry.holdoutAccessAuthority &&
          !entry.providerCallAuthority &&
          !entry.realEvaluationAuthority,
      ),
    ).toBe(true);
  });
});
