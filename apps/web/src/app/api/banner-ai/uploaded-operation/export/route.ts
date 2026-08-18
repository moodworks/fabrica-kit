import {
  createUploadedBannerExport,
  UploadedBannerOperationError,
} from '../../../../../server/banner-ai/uploaded-banner-operation';
import { resolveDevelopmentActorWorkspaceContext } from '../../../../../server/banner-ai/development-context';
import {
  demoProjectFailureFrom,
  readBoundedJson,
  requireExactObjectKeys,
} from '../../../../../server/banner-ai/demo-project-http';

export const runtime = 'nodejs';
export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireExactObjectKeys(await readBoundedJson(request, 1_048_576), [
      'candidateId',
      'operationId',
      'project',
      'revision',
      'sceneSha256',
      'sceneVersionId',
    ] as const);
    const data = await createUploadedBannerExport({
      ...body,
      authority: resolveDevelopmentActorWorkspaceContext(),
    });
    return Response.json({ ok: true, data }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof UploadedBannerOperationError)
      return Response.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: 400 },
      );
    return demoProjectFailureFrom(error, 'UPLOADED_EXPORT_FAILED');
  }
}
