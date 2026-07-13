import { z } from 'zod';

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;

export const ActorIdSchema = z.string().regex(opaqueIdPattern).brand<'ActorId'>();
export const WorkspaceIdSchema = z.string().regex(opaqueIdPattern).brand<'WorkspaceId'>();
export const ProjectIdSchema = z.string().regex(opaqueIdPattern).brand<'ProjectId'>();
export const RequestIdSchema = z.string().regex(requestIdPattern).brand<'RequestId'>();

export type ActorId = z.infer<typeof ActorIdSchema>;
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type RequestId = z.infer<typeof RequestIdSchema>;

export const ActorWorkspaceContextSchema = z.strictObject({
  actorId: ActorIdSchema,
  workspaceId: WorkspaceIdSchema,
  requestId: RequestIdSchema,
});

export type ActorWorkspaceContext = z.infer<typeof ActorWorkspaceContextSchema>;

export const createActorId = (input: unknown): ActorId => ActorIdSchema.parse(input);
export const createWorkspaceId = (input: unknown): WorkspaceId => WorkspaceIdSchema.parse(input);
export const createProjectId = (input: unknown): ProjectId => ProjectIdSchema.parse(input);
export const createRequestId = (input: unknown): RequestId => RequestIdSchema.parse(input);

/**
 * Validates neutral value syntax only. A host adapter remains responsible for establishing authority.
 */
export const createActorWorkspaceContext = (input: unknown): ActorWorkspaceContext =>
  ActorWorkspaceContextSchema.parse(input);
