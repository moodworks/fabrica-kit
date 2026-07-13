import { randomUUID } from 'node:crypto';

import {
  createActorId,
  createActorWorkspaceContext,
  createRequestId,
  createWorkspaceId,
  type ActorWorkspaceContext,
} from '@fabrica/banner-ai';

const developmentActorId = createActorId('development_actor_local');
const developmentWorkspaceId = createWorkspaceId('development_workspace_local');

export const resolveDevelopmentActorWorkspaceContext = (): ActorWorkspaceContext =>
  createActorWorkspaceContext({
    actorId: developmentActorId,
    workspaceId: developmentWorkspaceId,
    requestId: createRequestId(`banner-ai:${randomUUID()}`),
  });
