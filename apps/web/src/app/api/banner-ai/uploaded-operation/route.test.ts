import { describe, expect, it } from 'vitest';

import { readBoundedMultipartRequest, PUT } from './route';
import {
  createUploadedBannerOperation,
  resetUploadedBannerOperationRegistryForTests,
} from '../../../../server/banner-ai/uploaded-banner-operation';
import { resolveDevelopmentActorWorkspaceContext } from '../../../../server/banner-ai/development-context';
import { createDeterministicUploadedBannerSamGenerator } from '@fabrica/banner-ai/server/uploaded-banner-sam-operation-v1';
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
