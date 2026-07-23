import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SAM_CORPUS_CAPABILITY_SEPARATION_V1,
  SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1,
} from '../src/evaluation/sam-corpus-visual-quality-v1.js';
import { createTestOnlySamCorpusAuthorizationSourcesV1 } from '../src/server/sam-corpus-evaluation-authorization-v1.js';
import {
  createSamCorpusProviderFreeTransportFactoryV1,
  executeSamNoTextCorpusProviderFreeV1,
  executeSamTextHeavyCorpusProviderFreeV1,
} from '../src/server/sam-corpus-evaluation-control-v1.js';
import {
  bindSamCorpusVisualReviewEvidenceV1,
  createSamCorpusVisualReviewV1,
  verifySamCorpusVisualArtifactSetV2,
  type SamCorpusVisualReviewEvidenceV1,
} from '../src/server/sam-corpus-visual-evaluation-v2.js';

let temporaryRoot = '';
let textHeavyOutput = '';
let noTextOutput = '';
let authorizationOrdinal = 0;

const authorizationSources = () => {
  authorizationOrdinal += 1;
  const suffix = authorizationOrdinal.toString(16).padStart(12, '0');
  return createTestOnlySamCorpusAuthorizationSourcesV1({
    nowMs: () => Date.parse('2026-07-23T12:00:00Z'),
    authorizationId: () => `eeeeeeee-eeee-4eee-8eee-${suffix}`,
  });
};

beforeAll(async () => {
  temporaryRoot = await mkdtemp(
    join(await realpath(tmpdir()), 'fabrica-sam-corpus-quality-fake-test-'),
  );
  textHeavyOutput = join(temporaryRoot, 'text-heavy-review-fake-output');
  noTextOutput = join(temporaryRoot, 'no-text-review-fake-output');
  await executeSamTextHeavyCorpusProviderFreeV1({
    outputDirectory: textHeavyOutput,
    authorizationSources: authorizationSources(),
    transportFactory: createSamCorpusProviderFreeTransportFactoryV1({ candidateCount: 1 }),
  });
  await executeSamNoTextCorpusProviderFreeV1({
    outputDirectory: noTextOutput,
    authorizationSources: authorizationSources(),
    transportFactory: createSamCorpusProviderFreeTransportFactoryV1({ candidateCount: 0 }),
  });
}, 30_000);

afterAll(async () => {
  if (temporaryRoot !== '') await rm(temporaryRoot, { recursive: true, force: true });
});

const evidenceFor = async (outputDirectory: string): Promise<SamCorpusVisualReviewEvidenceV1> =>
  bindSamCorpusVisualReviewEvidenceV1(await verifySamCorpusVisualArtifactSetV2(outputDirectory));

const candidate = (proposedLayerId: string | null) => ({
  artifactInspection: {
    mask: { inspected: true, findings: 'mask inspected' },
    cutout: { inspected: true, findings: 'cutout inspected' },
    overlay: { inspected: true, findings: 'overlay inspected' },
  },
  proposedLayerId,
  rationale: 'candidate rationale',
  usability: 'repairable' as const,
  scores: {
    semanticUsefulness: 3,
    completeness: 3,
    edgeMatteQuality: 2,
    backgroundCleanliness: 2,
    granularityIntegrity: 3,
    repairReadiness: 2,
  },
  duplicateOfCandidateOrders: [] as number[],
  mergeWithCandidateOrders: [] as number[],
});

const base = () => ({
  duplicateObservations: [],
  mergeObservations: [],
  candidates: [candidate('text-heavy.layer.stand')],
  missingLayerObservations: [
    { layerId: 'text-heavy.layer.background', rationale: 'not represented' },
    { layerId: 'text-heavy.layer.header', rationale: 'not represented' },
    { layerId: 'text-heavy.layer.options', rationale: 'not represented' },
    { layerId: 'text-heavy.layer.lower-accent', rationale: 'not represented' },
  ],
  fixtureUsability: 'repairable',
  fixtureRationale: 'One proposed layer requires repair; the remaining layers are missing.',
});

const noTextZeroCandidate = () => ({
  duplicateObservations: [],
  mergeObservations: [],
  candidates: [],
  missingLayerObservations: [
    { layerId: 'no-text.layer.background-composite', rationale: 'no candidate returned' },
    { layerId: 'no-text.layer.cyan-decorations', rationale: 'no candidate returned' },
    { layerId: 'no-text.layer.coral-sunbursts', rationale: 'no candidate returned' },
  ],
  fixtureUsability: 'unusable',
  fixtureRationale: 'No candidates were returned, so every expected layer is missing.',
});

describe('SAM corpus provider-neutral visual-quality V1', () => {
  it('derives every evidence and candidate identity from one verified artifact capability', async () => {
    const verified = await verifySamCorpusVisualArtifactSetV2(textHeavyOutput);
    const evidence = bindSamCorpusVisualReviewEvidenceV1(verified);
    const review = createSamCorpusVisualReviewV1(evidence, base());
    expect(review.bindings).toEqual({
      sourceSha256: verified.manifest.fixture.sha256,
      humanOracleSha256: verified.manifest.fixture.humanOracleSha256,
      canonicalRequestSha256: verified.manifest.canonicalRequest.sha256,
      validatedResponseSha256: verified.manifest.validatedResponseSha256,
      sanitizedResponseSha256: verified.sanitizedResponseSha256,
      manifestSha256: verified.manifestSha256,
      inventorySha256: verified.inventorySha256,
    });
    expect(review.candidates[0]?.candidateId).toBe(verified.manifest.candidates[0]?.candidateId);
    expect(review.candidates[0]?.candidateOrder).toBe(1);
    expect(review.candidates[0]?.artifactInspection).toEqual({
      mask: { inspected: true, findings: 'mask inspected' },
      cutout: { inspected: true, findings: 'cutout inspected' },
      overlay: { inspected: true, findings: 'overlay inspected' },
    });
    expect(Object.keys(review.candidates[0]!.scores).toSorted()).toEqual([
      'backgroundCleanliness',
      'completeness',
      'edgeMatteQuality',
      'granularityIntegrity',
      'repairReadiness',
      'semanticUsefulness',
    ]);
    expect(SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1.backgroundCleanliness[4]).toContain('no-or-trace');
    expect(SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1.granularityIntegrity[4]).toContain('unique');
    expect(SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1.repairReadiness[4]).toBe('no-repair-required');
    expect(review.capabilitySeparation).toEqual(SAM_CORPUS_CAPABILITY_SEPARATION_V1);
    expect(review).not.toHaveProperty('averageScore');
    expect(() => createSamCorpusVisualReviewV1(evidence, base())).toThrow(/already consumed/u);
  });

  it('rejects reconstructed results, forged evidence, and caller-authored bindings', async () => {
    const verified = await verifySamCorpusVisualArtifactSetV2(textHeavyOutput);
    expect(() => bindSamCorpusVisualReviewEvidenceV1(structuredClone(verified))).toThrow(
      /verified artifact result/u,
    );
    expect(() =>
      createSamCorpusVisualReviewV1(
        { purpose: 'verified-sam-corpus-visual-review-evidence-v1' },
        base(),
      ),
    ).toThrow(/foreign/u);
    const evidence = await evidenceFor(textHeavyOutput);
    expect(() =>
      createSamCorpusVisualReviewV1(evidence, {
        ...base(),
        bindings: { canonicalRequestSha256: 'caller-authored' },
      }),
    ).toThrow();
  });

  it('classifies zero candidates as unusable and records every approved layer missing', async () => {
    const review = createSamCorpusVisualReviewV1(
      await evidenceFor(noTextOutput),
      noTextZeroCandidate(),
    );
    expect(review.fixtureId).toBe('banner-no-text-v1');
    expect(review.candidateCount).toBe(0);
    expect(review.fixtureUsability).toBe('unusable');
    expect(review.missingLayerObservations).toHaveLength(3);
  });

  it.each([
    [
      'uninspected mask',
      (input: ReturnType<typeof base>) => {
        input.candidates[0]!.artifactInspection.mask.inspected = false as true;
      },
    ],
    [
      'score outside 0..4',
      (input: ReturnType<typeof base>) => {
        input.candidates[0]!.scores.repairReadiness = 5;
      },
    ],
    [
      'unapproved layer',
      (input: ReturnType<typeof base>) => {
        input.candidates[0]!.proposedLayerId = 'foreign.layer';
      },
    ],
    [
      'incomplete missing layers',
      (input: ReturnType<typeof base>) => {
        input.missingLayerObservations.pop();
      },
    ],
    [
      'self duplicate',
      (input: ReturnType<typeof base>) => {
        input.candidates[0]!.duplicateOfCandidateOrders = [1];
      },
    ],
    [
      'aggregate score',
      (input: ReturnType<typeof base>) => {
        Object.assign(input, { averageScore: 3 });
      },
    ],
    [
      'candidate count outside bound evidence',
      (input: ReturnType<typeof base>) => {
        input.candidates.push(candidate('text-heavy.layer.stand'));
      },
    ],
    [
      'unusable proposed layer suppressing a missing-layer observation',
      (input: ReturnType<typeof base>) => {
        input.candidates[0]!.scores.semanticUsefulness = 0;
        Object.assign(input.candidates[0]!, { usability: 'unusable' });
      },
    ],
    [
      'candidate usability contradicting its scores',
      (input: ReturnType<typeof base>) => {
        Object.assign(input.candidates[0]!, { usability: 'usable' });
      },
    ],
  ])('fails closed on %s', async (_label, mutate) => {
    const input = structuredClone(base());
    mutate(input);
    const evidence = await evidenceFor(textHeavyOutput);
    expect(() => createSamCorpusVisualReviewV1(evidence, input)).toThrow();
  });

  it('rejects a usable zero-candidate result', async () => {
    const input = { ...noTextZeroCandidate(), fixtureUsability: 'usable' };
    const evidence = await evidenceFor(noTextOutput);
    expect(() => createSamCorpusVisualReviewV1(evidence, input)).toThrow(/zero-candidate fixture/u);
  });
});
