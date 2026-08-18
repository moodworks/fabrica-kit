import { describe, expect, it } from 'vitest';

import {
  readBoundedMultipartRequest,
  PUT,
  setUploadedOperationTestPromptedGenerator,
} from './route';
import {
  createUploadedBannerOperation,
  resetUploadedBannerOperationRegistryForTests,
} from '../../../../server/banner-ai/uploaded-banner-operation';
import { resolveDevelopmentActorWorkspaceContext } from '../../../../server/banner-ai/development-context';
import { createDeterministicUploadedBannerSamGenerator } from '@fabrica/banner-ai/server/uploaded-banner-sam-operation-v1';
import { createDeterministicNonRectangularSamBoxPromptAdapter } from '@fabrica/banner-ai/server/sam-box-prompt-layer-extraction';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = new Uint8Array(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../../../packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
    ),
  ),
);

describe('uploaded operation multipart boundary', () => {
  it('requires prompted authorization without dispatch and returns a strict public fake envelope', async () => {
    resetUploadedBannerOperationRegistryForTests();
    setUploadedOperationTestPromptedGenerator(undefined);
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: resolveDevelopmentActorWorkspaceContext(),
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const request = (body: unknown) =>
      PUT(
        new Request('http://localhost/api/banner-ai/uploaded-operation', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    await expect(
      request({
        action: 'prompt-cutout',
        operationId: created.operationId,
        crop: { left: 0, top: 0, width: 10, height: 10 },
      }),
    ).resolves.toMatchObject({ status: 400 });
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    setUploadedOperationTestPromptedGenerator({
      generator: fake.adapter,
      expectedExecutionKind: 'deterministic-fake',
      provenance: 'Deterministic test output — NOT SAM OUTPUT',
    });
    resetUploadedBannerOperationRegistryForTests();
    const promptedCreated = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: resolveDevelopmentActorWorkspaceContext(),
      generator: createDeterministicUploadedBannerSamGenerator(),
      promptedExecution: {
        generator: fake.adapter,
        expectedExecutionKind: 'deterministic-fake',
        provenance: 'Deterministic test output — NOT SAM OUTPUT',
      },
    });
    const response = await request({
      action: 'prompt-cutout',
      operationId: promptedCreated.operationId,
      crop: { left: 0, top: 0, width: 10, height: 10 },
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toMatchObject({
      promptedId: expect.stringMatching(/^samp_v1_[0-9a-f]{64}$/u),
      provenance: 'Deterministic test output — NOT SAM OUTPUT',
    });
    expect(payload.data).not.toHaveProperty('bytes');
    await request({
      action: 'prompt-cutout',
      operationId: created.operationId,
      crop: { left: 0, top: 0, width: 10, height: 10 },
      extra: true,
    });
    expect(fake.getCallCount()).toBe(1);
    for (const crop of [
      { left: 0, top: 0, width: 10, height: 10, extra: 1 },
      { left: 0.5, top: 0, width: 10, height: 10 },
      { left: 99999, top: 0, width: 10, height: 10 },
    ]) {
      const invalid = await request({
        action: 'prompt-cutout',
        operationId: promptedCreated.operationId,
        crop,
      });
      expect(invalid.status).toBe(400);
    }
    setUploadedOperationTestPromptedGenerator(undefined);
  });
  it('accepts exact compose action and rejects extra keys/unknown IDs', async () => {
    resetUploadedBannerOperationRegistryForTests();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: resolveDevelopmentActorWorkspaceContext(),
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const good = await PUT(
      new Request('http://localhost/api/banner-ai/uploaded-operation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'compose',
          operationId: created.operationId,
          candidateIds: [created.catalog[0]!.candidateId],
        }),
      }),
    );
    expect(good.status).toBe(200);
    const mixed = await PUT(
      new Request('http://localhost/api/banner-ai/uploaded-operation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'compose',
          operationId: created.operationId,
          layers: [
            { kind: 'sam-candidate-group-v1', candidateIds: [created.catalog[0]!.candidateId] },
            { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 10, height: 10 } },
          ],
        }),
      }),
    );
    expect(mixed.status).toBe(200);
    await expect(
      PUT(
        new Request('http://localhost/api/banner-ai/uploaded-operation', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'compose',
            operationId: created.operationId,
            layers: [{ kind: 'source-region-v1', crop: { left: -1, top: 0, width: 1, height: 1 } }],
          }),
        }),
      ),
    ).resolves.toMatchObject({ status: 400 });
    const extra = await PUT(
      new Request('http://localhost/api/banner-ai/uploaded-operation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'compose',
          operationId: created.operationId,
          candidateIds: [created.catalog[0]!.candidateId],
          extra: true,
        }),
      }),
    );
    expect(extra.status).toBe(400);
    const unknown = await PUT(
      new Request('http://localhost/api/banner-ai/uploaded-operation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'compose',
          operationId: created.operationId,
          candidateIds: ['samc_v1_' + 'f'.repeat(64)],
        }),
      }),
    );
    expect(unknown.status).toBe(400);
    const grouped = await PUT(
      new Request('http://localhost/api/banner-ai/uploaded-operation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'compose',
          operationId: created.operationId,
          candidateGroups: [[created.catalog[0]!.candidateId], [created.catalog[1]!.candidateId]],
        }),
      }),
    );
    expect(grouped.status).toBe(200);
    expect((await grouped.json()).data.subjectId).toMatch(/^sams_v1_[0-9a-f]{64}$/u);
    for (const candidateGroups of [
      [],
      [[created.catalog[0]!.candidateId, created.catalog[0]!.candidateId]],
      [['samc_v1_' + 'f'.repeat(64)]],
      Array.from({ length: 9 }, () => [created.catalog[0]!.candidateId]),
    ]) {
      const response = await PUT(
        new Request('http://localhost/api/banner-ai/uploaded-operation', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'compose',
            operationId: created.operationId,
            candidateGroups,
          }),
        }),
      );
      expect(response.status).toBe(400);
    }
  });
  it('rejects an oversized chunked body before form parsing', async () => {
    const oversized = new Uint8Array(21_500_001);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/banner-ai/uploaded-operation', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
      body,
      // Deliberately no Content-Length: the stream itself must be bounded.
      duplex: 'half',
    } as RequestInit);
    await expect(readBoundedMultipartRequest(request)).rejects.toThrow('UPLOAD_TOO_LARGE');
  });

  it('rejects a lying undersized declared length when streamed bytes exceed the cap', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(21_500_001));
        controller.close();
      },
    });
    const request = new Request('http://localhost/api/banner-ai/uploaded-operation', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=test',
        'content-length': '1',
      },
      body,
      duplex: 'half',
    } as RequestInit);
    await expect(readBoundedMultipartRequest(request)).rejects.toThrow('UPLOAD_TOO_LARGE');
  });
});
