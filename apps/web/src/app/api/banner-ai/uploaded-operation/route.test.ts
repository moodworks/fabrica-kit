import { describe, expect, it } from 'vitest';

import { readBoundedMultipartRequest } from './route';

describe('uploaded operation multipart boundary', () => {
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
