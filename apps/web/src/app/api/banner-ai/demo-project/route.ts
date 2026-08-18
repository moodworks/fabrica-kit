import {
  openInitialDemoProject,
  openCandidateDemoProject,
  providerFreeCandidateCatalog,
  projectOpenData,
  saveDemoProject,
  validateDemoProject,
} from '../../../../server/banner-ai/provider-free-demo-project';
import {
  DemoProjectHttpError,
  demoProjectFailure,
  demoProjectFailureFrom,
  readBoundedJson,
  requireExactObjectKeys,
} from '../../../../server/banner-ai/demo-project-http';

export const runtime = 'nodejs';

const success = (data: unknown): Response =>
  Response.json({ ok: true, data }, { headers: { 'cache-control': 'no-store, max-age=0' } });

export async function GET(request: Request): Promise<Response> {
  if (new URL(request.url).search !== '') {
    return demoProjectFailure(
      400,
      'DEMO_QUERY_NOT_ALLOWED',
      'The approved demo project accepts no client-controlled query fields.',
    );
  }
  try {
    return success(await openInitialDemoProject());
  } catch (error) {
    return demoProjectFailureFrom(error, 'DEMO_PROJECT_OPEN_FAILED');
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readBoundedJson(request, 1_048_576);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new DemoProjectHttpError(
        400,
        'INVALID_DEMO_REQUEST',
        'The demo request must be one exact JSON object.',
      );
    }
    const action = (body as Record<string, unknown>)['action'];
    if (action === 'open-candidate') {
      const exact = requireExactObjectKeys(body, ['action', 'candidateId']);
      return success(await openCandidateDemoProject(exact.candidateId));
    }
    if (action === 'catalog') {
      requireExactObjectKeys(body, ['action']);
      return success({ candidates: await providerFreeCandidateCatalog() });
    }
    if (action === 'reopen') {
      const exact = requireExactObjectKeys(body, ['action', 'project']);
      const { fixed, project } = await validateDemoProject(exact.project);
      return success(projectOpenData(fixed, project));
    }
    if (action === 'save') {
      const exact = requireExactObjectKeys(body, ['action', 'project', 'scene', 'selectedPartId']);
      return success(
        await saveDemoProject({
          project: exact.project,
          scene: exact.scene,
          selectedPartId: exact.selectedPartId,
        }),
      );
    }
    throw new DemoProjectHttpError(
      400,
      'INVALID_DEMO_ACTION',
      'Use only the fixed reopen or save demo action.',
    );
  } catch (error) {
    return demoProjectFailureFrom(error, 'DEMO_PROJECT_SAVE_FAILED');
  }
}
