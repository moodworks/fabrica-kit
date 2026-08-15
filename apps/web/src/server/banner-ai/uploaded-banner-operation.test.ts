import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  createActorId,
  createActorWorkspaceContext,
  createRequestId,
  createWorkspaceId,
} from '@fabrica/banner-ai';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from '../../../../../packages/banner-ai/src/server/sam-runpod-direct-v3-deterministic-fake-transport';
import { createSamRunPodDirectV3Adapter } from '../../../../../packages/banner-ai/src/server/sam-runpod-direct-v3-adapter';
import {
  createDeterministicUploadedBannerSamGenerator,
  generateUploadedBannerSamCandidates,
} from '../../../../../packages/banner-ai/src/server/uploaded-banner-sam-operation-v1';
import { SamReplayError } from '../../../../../packages/banner-ai/src/server/uploaded-banner-sam-replay-v4';

import {
  createUploadedBannerOperation,
  resetUploadedBannerOperationRegistryForTests,
  resolveUploadedBannerCandidate,
  openUploadedBannerProject,
  createUploadedBannerPreview,
  createUploadedBannerExport,
  composeUploadedBannerOperation,
} from './uploaded-banner-operation';

const source = new Uint8Array(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
    ),
  ),
);
const authority = (workspaceId = createWorkspaceId('uploaded_test_workspace')) =>
  createActorWorkspaceContext({
    actorId: createActorId('uploaded-test-actor'),
    workspaceId,
    requestId: createRequestId('uploaded-test-request'),
  });

describe('uploaded banner operation registry', () => {
  beforeEach(() => resetUploadedBannerOperationRegistryForTests());

  it('requires authorization before reading or dispatching an uploaded operation', async () => {
    await expect(
      createUploadedBannerOperation({
        file: new File([source], 'banner.png', { type: 'image/png' }),
        authority: authority(),
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
  });

  it('binds the operation to the creating workspace and rejects foreign access', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    expect(created.operationId).toMatch(/^[0-9a-f]{64}$/u);
    expect(transport.getCallCount()).toBe(1);
    const candidateId = created.catalog[0]!.candidateId;
    expect(() =>
      resolveUploadedBannerCandidate(
        created.operationId,
        candidateId,
        authority(createWorkspaceId('foreign_workspace')),
      ),
    ).toThrow(/foreign/u);
    expect(() => resolveUploadedBannerCandidate('0'.repeat(64), candidateId, owner)).toThrow(
      /unknown/u,
    );
  });

  it('replaces the previous single registry entry and rejects the replaced operation', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const first = await createUploadedBannerOperation({
      file: new File([source], 'one.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    const second = await createUploadedBannerOperation({
      file: new File([source], 'two.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    expect(second.operationId).not.toBe(first.operationId);
    expect(() =>
      resolveUploadedBannerCandidate(first.operationId, first.catalog[0]!.candidateId, owner),
    ).toThrow(/unknown/u);
  });

  it('opens the exact candidate and produces deterministic preview/export from its operation', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      authority: owner,
    });
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    const preview = await createUploadedBannerPreview({ ...identity, nonce: 'a'.repeat(32) });
    const exported = await createUploadedBannerExport(identity);
    expect(preview.mediaType).toBe('text/html');
    expect(exported.artifact.mediaType).toBe('application/zip');
    expect(exported.artifact.filename).toContain('uploaded-deterministic-test');
  });

  it('canonicalizes composed subjects, coalesces concurrent opens, and supports preview/export', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 2).map((candidate) => candidate.candidateId);
    const [forward, reverse] = await Promise.all([
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ids,
        authority: owner,
      }),
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ids.toReversed(),
        authority: owner,
      }),
    ]);
    expect(forward.subjectId).toBe(reverse.subjectId);
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: forward.subjectId,
      authority: owner,
    });
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: forward.subjectId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    await expect(
      createUploadedBannerPreview({ ...identity, nonce: 'c'.repeat(32) }),
    ).resolves.toMatchObject({ mediaType: 'text/html' });
    await expect(createUploadedBannerExport(identity)).resolves.toMatchObject({
      artifact: { mediaType: 'application/zip' },
    });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: Array.from({ length: 9 }, (_, index) => ids[index % ids.length]!),
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [ids[0], ids[0]],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ['samc_v1_' + 'f'.repeat(64)],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
  });

  it('replays verified candidates without network and preserves provenance through open/export', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fake = createDeterministicUploadedBannerSamGenerator();
    const replay = async (normalizedPng: Uint8Array) => {
      const generated = await generateUploadedBannerSamCandidates({
        normalizedPng,
        requestId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        jobId: '33333333-3333-4333-8333-333333333333',
        attemptId: '44444444-4444-4444-8444-444444444444',
        generator: fake,
      });
      return {
        request: generated.request,
        candidates: generated.candidates,
        provenance: 'Verified Meta SAM 2.1 cutout replay — no live call' as const,
      };
    };
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      replay,
    });
    expect(created.catalog[0]?.provenance).toBe(
      'Verified Meta SAM 2.1 cutout replay — no live call',
    );
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      authority: owner,
    });
    expect(opened.materialization.candidateId).toBe(created.catalog[0]!.candidateId);
    const resolved = resolveUploadedBannerCandidate(
      created.operationId,
      created.catalog[0]!.candidateId,
      owner,
    );
    expect(resolved.candidate.bounds).toEqual({
      xBps: created.catalog[0]!.bounds.x,
      yBps: created.catalog[0]!.bounds.y,
      widthBps: created.catalog[0]!.bounds.width,
      heightBps: created.catalog[0]!.bounds.height,
    });
    expect(resolved.candidate.materialization.cutoutPng.byteLength).toBeGreaterThan(0);
    expect(opened.materialization.assets.some((asset) => asset.bytes.byteLength > 0)).toBe(true);
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    await createUploadedBannerPreview({ ...identity, nonce: 'b'.repeat(32) });
    const exported = await createUploadedBannerExport(identity);
    expect(exported.artifact.filename).toContain('uploaded-verified-meta-sam-replay');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('maps replay source mismatch to unsupported source', async () => {
    await expect(
      createUploadedBannerOperation({
        file: new File([source], 'banner.png', { type: 'image/png' }),
        authority: authority(),
        replay: async () => {
          throw new SamReplayError('SOURCE_MISMATCH', 'source mismatch');
        },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
  });
});
