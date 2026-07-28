import { createDemoPreview } from '../../../../../server/banner-ai/provider-free-demo-project';
import {
  demoProjectFailureFrom,
  readBoundedJson,
  requireExactObjectKeys,
} from '../../../../../server/banner-ai/demo-project-http';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = requireExactObjectKeys(await readBoundedJson(request, 1_048_576), [
      'nonce',
      'project',
      'revision',
      'sceneSha256',
      'sceneVersionId',
    ]);
    const data = await createDemoPreview({
      nonce: body.nonce,
      project: body.project,
      revision: body.revision,
      sceneSha256: body.sceneSha256,
      sceneVersionId: body.sceneVersionId,
    });
    return Response.json(
      { ok: true, data },
      { headers: { 'cache-control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return demoProjectFailureFrom(error, 'DEMO_PREVIEW_FAILED');
  }
}
