import { resolveDevelopmentActorWorkspaceContext } from '../../../../server/banner-ai/development-context';
import {
  createUploadedBannerOperation,
  resolveUploadedBannerOperation,
  uploadedCandidateCatalog,
  UploadedBannerOperationError,
  openUploadedBannerProject,
  saveUploadedBannerProject,
} from '../../../../server/banner-ai/uploaded-banner-operation';
import {
  BannerUploadFormError,
  requireSingleBannerUpload,
} from '../../../../server/banner-ai/upload-form';
import { loadSamsungSamV4Replay } from '@fabrica/banner-ai/server/uploaded-banner-sam-replay-v4';
import { createDeterministicUploadedBannerSamGenerator } from '@fabrica/banner-ai/server/uploaded-banner-sam-operation-v1';
import {
  readBoundedJson,
  requireExactObjectKeys,
} from '../../../../server/banner-ai/demo-project-http';

export const runtime = 'nodejs';

// Deliberately unset in production. Tests may inject a deterministic fake adapter explicitly.
let injectedGenerator: Parameters<typeof createUploadedBannerOperation>[0]['generator'] = undefined;
const e2eFakeGenerator =
  process.env.NODE_ENV !== 'production' && process.env.BANNER_AI_E2E_TEST_FAKE === '1'
    ? createDeterministicUploadedBannerSamGenerator()
    : undefined;
const injectedReplay: Parameters<typeof createUploadedBannerOperation>[0]['replay'] =
  process.env.NODE_ENV === 'production' || e2eFakeGenerator !== undefined
    ? undefined
    : loadSamsungSamV4Replay;
export const setUploadedOperationTestGenerator = (generator: typeof injectedGenerator): void => {
  injectedGenerator = generator;
};

const failure = (status: number, code: string, message: string): Response =>
  Response.json(
    { ok: false, error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );

const MAX_MULTIPART_BODY_BYTES = 21_500_000;

export const readBoundedMultipartRequest = async (request: Request): Promise<Request> => {
  const contentType = request.headers.get('content-type');
  if (contentType === null || !/^multipart\/form-data\s*;/iu.test(contentType))
    throw new Error('UPLOAD_MULTIPART_REQUIRED');
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_MULTIPART_BODY_BYTES)
  )
    throw new Error('UPLOAD_TOO_LARGE');
  if (request.body === null) throw new Error('UPLOAD_BODY_MISSING');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_MULTIPART_BODY_BYTES) {
        await reader.cancel();
        throw new Error('UPLOAD_TOO_LARGE');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: bytes,
  });
};

export async function POST(request: Request): Promise<Response> {
  try {
    const boundedRequest = await readBoundedMultipartRequest(request);
    const form = await boundedRequest.formData();
    const file = requireSingleBannerUpload(form);
    if (file.size > 20_971_520)
      return failure(413, 'UPLOAD_TOO_LARGE', 'The uploaded file exceeds the 20 MiB limit.');
    const authority = resolveDevelopmentActorWorkspaceContext();
    const created = await createUploadedBannerOperation({
      file,
      authority,
      ...(injectedGenerator !== undefined
        ? { generator: injectedGenerator }
        : e2eFakeGenerator !== undefined
          ? { generator: e2eFakeGenerator }
          : {}),
      ...(injectedGenerator === undefined &&
      e2eFakeGenerator === undefined &&
      injectedReplay !== undefined
        ? { replay: injectedReplay }
        : {}),
    });
    return Response.json(
      {
        ok: true,
        data: {
          operationId: created.operationId,
          candidates: created.catalog,
          provenance:
            created.catalog[0]?.provenance ?? 'Verified Meta SAM 2.1 cutout replay — no live call',
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UPLOAD_TOO_LARGE')
      return failure(413, 'UPLOAD_TOO_LARGE', 'The uploaded request exceeds the fixed size limit.');
    if (error instanceof Error && error.message === 'UPLOAD_MULTIPART_REQUIRED')
      return failure(415, 'UPLOAD_MULTIPART_REQUIRED', 'Submit one multipart image upload.');
    if (error instanceof BannerUploadFormError) return failure(400, error.code, error.message);
    if (error instanceof UploadedBannerOperationError) {
      return failure(
        error.code === 'AUTHORIZATION_REQUIRED' ? 503 : 400,
        error.code,
        error.message,
      );
    }
    return failure(
      400,
      'UPLOADED_OPERATION_FAILED',
      'The uploaded operation could not be created.',
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const operationId = url.searchParams.get('operation');
    const authority = resolveDevelopmentActorWorkspaceContext();
    const operation = resolveUploadedBannerOperation(operationId, authority);
    return Response.json(
      {
        ok: true,
        data: {
          operationId: operation.operationId,
          candidates: uploadedCandidateCatalog(operation),
          provenance: operation.result.provenance,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof UploadedBannerOperationError)
      return failure(400, error.code, error.message);
    return failure(
      400,
      'UPLOADED_OPERATION_LOOKUP_FAILED',
      'The uploaded operation could not be opened.',
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const bodyValue = await readBoundedJson(request, 1_048_576);
    if (bodyValue === null || typeof bodyValue !== 'object' || Array.isArray(bodyValue))
      return failure(400, 'INVALID_UPLOADED_ACTION', 'Submit one exact uploaded action.');
    const body = bodyValue as Record<string, unknown>;
    if (body.action === 'save') {
      requireExactObjectKeys(body, [
        'action',
        'candidateId',
        'operationId',
        'project',
        'scene',
        'selectedPartId',
      ] as const);
      const saved = await saveUploadedBannerProject({
        ...body,
        authority: resolveDevelopmentActorWorkspaceContext(),
      } as Parameters<typeof saveUploadedBannerProject>[0]);
      const savedOperation = resolveUploadedBannerOperation(
        body.operationId,
        resolveDevelopmentActorWorkspaceContext(),
      );
      return Response.json(
        {
          ok: true,
          data: {
            canonicalProjectJson: saved.canonicalProjectJson,
            project: saved.project,
            presentation: {
              canvas: { width: 300, height: 200 },
              fixtureLabel: savedOperation.result.provenance,
              candidateId: saved.presentation.candidateId,
              source: saved.presentation.sourceReference,
              parts: saved.presentation.presentationParts,
            },
          },
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    if (body.action !== 'select') {
      return failure(400, 'INVALID_UPLOADED_ACTION', 'Select one exact uploaded candidate.');
    }
    requireExactObjectKeys(body, ['action', 'candidateId', 'operationId'] as const);
    const opened = await openUploadedBannerProject({
      operationId: body.operationId,
      candidateId: body.candidateId,
      authority: resolveDevelopmentActorWorkspaceContext(),
    });
    const openedOperation = resolveUploadedBannerOperation(
      body.operationId,
      resolveDevelopmentActorWorkspaceContext(),
    );
    return Response.json(
      {
        ok: true,
        data: {
          canonicalProjectJson: JSON.stringify(opened.materialization.project),
          presentation: {
            canvas: { width: 300, height: 200 },
            fixtureLabel: openedOperation.result.provenance,
            candidateId: opened.materialization.candidateId,
            source: opened.materialization.sourceReference,
            parts: opened.materialization.presentationParts,
          },
          project: opened.materialization.project,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof UploadedBannerOperationError)
      return failure(400, error.code, error.message);
    return failure(400, 'UPLOADED_PROJECT_FAILED', 'The uploaded project could not be opened.');
  }
}
