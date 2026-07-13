import { RasterSecurityError } from '@fabrica/banner-ai';

import { analyzeBannerWithLocalFixture } from '../../../../server/banner-ai/local-fixture-analysis';
import { resolveDevelopmentActorWorkspaceContext } from '../../../../server/banner-ai/development-context';
import {
  BannerUploadFormError,
  requireSingleBannerUpload,
} from '../../../../server/banner-ai/upload-form';

export const runtime = 'nodejs';

const failure = (status: number, code: string, message: string): Response =>
  Response.json({ ok: false, error: { code, message } }, { status });

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure(400, 'INVALID_UPLOAD_FORM', 'Submit one multipart JPG or PNG file.');
  }

  try {
    const file = requireSingleBannerUpload(formData);
    const authority = resolveDevelopmentActorWorkspaceContext();
    const data = await analyzeBannerWithLocalFixture(file, authority);
    return Response.json({ ok: true, data });
  } catch (error) {
    if (error instanceof BannerUploadFormError) {
      return failure(400, error.code, error.message);
    }
    if (error instanceof RasterSecurityError) {
      return failure(400, error.code, error.message);
    }
    return failure(
      500,
      'LOCAL_FIXTURE_ANALYSIS_FAILED',
      'The local fixture analysis could not be completed.',
    );
  }
}
