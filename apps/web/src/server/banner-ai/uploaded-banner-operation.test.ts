import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

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
  createUploadedBannerOperation,
  resetUploadedBannerOperationRegistryForTests,
  resolveUploadedBannerCandidate,
  openUploadedBannerProject,
  createUploadedBannerPreview,
  createUploadedBannerExport,
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
});
