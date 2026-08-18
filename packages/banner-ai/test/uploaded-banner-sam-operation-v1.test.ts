import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSamRunPodDirectV3Adapter } from '../src/server/sam-runpod-direct-v3-adapter.js';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from '../src/server/sam-runpod-direct-v3-deterministic-fake-transport.js';
import {
  createDeterministicUploadedBannerSamGenerator,
  generateUploadedBannerSamCandidates,
  UPLOADED_BANNER_SAM_FAKE_IDENTITY,
  composeUploadedBannerSamCandidates,
  composeUploadedBannerSamCandidateGroups,
} from '../src/server/uploaded-banner-sam-operation-v1.js';

const source = new Uint8Array(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
    ),
  ),
);

describe('uploaded banner automatic SAM operation helper', () => {
  it('groups canonical members and preserves outer ordering', async () => {
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = result.candidates.slice(0, 3).map((candidate) => candidate.candidateId);
    const first = await composeUploadedBannerSamCandidateGroups({
      operation: result,
      candidateGroups: [[ids[0]!, ids[1]!], [ids[2]!]],
    });
    const singleton = await composeUploadedBannerSamCandidateGroups({
      operation: result,
      candidateGroups: [[ids[0]!]],
    });
    expect(singleton.groups[0]!.candidate.materialization.cutoutPng).toEqual(
      result.candidates[0]!.materialization.cutoutPng,
    );
    const innerReverse = await composeUploadedBannerSamCandidateGroups({
      operation: result,
      candidateGroups: [[ids[1]!, ids[0]!], [ids[2]!]],
    });
    const outerReverse = await composeUploadedBannerSamCandidateGroups({
      operation: result,
      candidateGroups: [[ids[2]!], [ids[0]!, ids[1]!]],
    });
    expect(innerReverse.subjectId).toBe(first.subjectId);
    expect(outerReverse.subjectId).not.toBe(first.subjectId);
    expect(first.groups[0]!.candidate.materialization.cutoutPng).not.toEqual(
      result.candidates[0]!.materialization.cutoutPng,
    );
    await expect(
      composeUploadedBannerSamCandidateGroups({ operation: result, candidateGroups: [] }),
    ).rejects.toThrow();
    await expect(
      composeUploadedBannerSamCandidateGroups({ operation: result, candidateGroups: [[]] }),
    ).rejects.toThrow();
    await expect(
      composeUploadedBannerSamCandidateGroups({
        operation: result,
        candidateGroups: [[ids[0]!, ids[0]!]],
      }),
    ).rejects.toThrow();
    await expect(
      composeUploadedBannerSamCandidateGroups({
        operation: result,
        candidateGroups: [[ids[0]!], [ids[0]!]],
      }),
    ).rejects.toThrow();
    await expect(
      composeUploadedBannerSamCandidateGroups({
        operation: result,
        candidateGroups: [['samc_v1_' + 'f'.repeat(64)]],
      }),
    ).rejects.toThrow();
  });
  it('has an isolated zero-network deterministic generator with one-call evidence', async () => {
    const generator = createDeterministicUploadedBannerSamGenerator();
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator,
    });
    expect(generator.getCallCount()).toBe(1);
    expect(generator.networkCalls).toBe(0);
    expect(result.provenance).toBe('Deterministic test output — NOT SAM OUTPUT');
    if (result.provenance !== 'Deterministic test output — NOT SAM OUTPUT')
      throw new Error('expected fake result');
    expect(result.response.executionIdentity).toEqual(UPLOADED_BANNER_SAM_FAKE_IDENTITY);
  });

  it('strictly binds one deterministic fake dispatch and materializes bounded candidates', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const adapter = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator: adapter,
    });
    expect(transport.getCallCount()).toBe(1);
    expect(transport.networkCalls).toBe(0);
    expect(result.provenance).toBe('Deterministic test output — NOT SAM OUTPUT');
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(8);
    expect(result.candidates.every((candidate) => candidate.preview.byteSize <= 524_288)).toBe(
      true,
    );
    if (result.provenance !== 'Deterministic test output — NOT SAM OUTPUT')
      throw new Error('expected fake result');
    expect(result.request.source.sha256).toBe(result.response.sourceSha256);
    expect(result.candidates[0]?.materialization.metadata.sourceSha256).toBe(
      result.request.source.sha256,
    );
  });

  it('composes canonically and preserves a single candidate materialization', async () => {
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const first = result.candidates[0]!;
    const single = await composeUploadedBannerSamCandidates({
      operation: result,
      candidateIds: [first.candidateId],
    });
    expect(single.candidates[0]!.materialization.cutoutPng).toEqual(
      first.materialization.cutoutPng,
    );
    if (result.candidates[1]) {
      const ids = [first.candidateId, result.candidates[1].candidateId];
      const forward = await composeUploadedBannerSamCandidates({
        operation: result,
        candidateIds: ids,
      });
      const reverse = await composeUploadedBannerSamCandidates({
        operation: result,
        candidateIds: ids.toReversed(),
      });
      expect(reverse.subjectId).toBe(forward.subjectId);
      expect(reverse.candidates[0]!.materialization.cutoutPng).toEqual(
        forward.candidates[0]!.materialization.cutoutPng,
      );
    }
  });
});
