import { describe, expect, it } from 'vitest';

import {
  ActorWorkspaceContextSchema,
  ProjectIdSchema,
  createActorId,
  createActorWorkspaceContext,
  createProjectId,
  createRequestId,
  createWorkspaceId,
  issue,
  runPureUpcasterHarness,
  validationFailure,
  validationSuccess,
  type JsonVersionedDocument,
  type ValidationResult,
} from '../src/index.js';

interface TargetDocument extends JsonVersionedDocument {
  readonly label: string;
  readonly schemaVersion: 2;
}

const parseTarget = (input: unknown): ValidationResult<TargetDocument> => {
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>)['schemaVersion'] === 2 &&
    typeof (input as Record<string, unknown>)['label'] === 'string' &&
    Object.keys(input).length === 2
  ) {
    return validationSuccess(input as TargetDocument);
  }
  return validationFailure([issue('SCENE_INVALID', [], 'Invalid generic target fixture.')]);
};

const source: JsonVersionedDocument = { schemaVersion: 1, title: 'Angel' };

describe('pure upcaster harness', () => {
  it('accepts a deterministic one-version upcaster and runtime-validates its output', () => {
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: (value) => ({ schemaVersion: 2, label: String(value['title']) }),
      },
      parseTarget,
    );

    expect(result).toEqual({ success: true, data: { schemaVersion: 2, label: 'Angel' } });
    expect(source).toEqual({ schemaVersion: 1, title: 'Angel' });
  });

  it('rejects skipped versions and a mismatched source dispatcher version', () => {
    const skipped = runPureUpcasterHarness(
      source,
      { fromVersion: 1, toVersion: 3, upcast: () => ({ schemaVersion: 3 }) },
      parseTarget,
    );
    const mismatched = runPureUpcasterHarness(
      source,
      { fromVersion: 2, toVersion: 3, upcast: () => ({ schemaVersion: 3 }) },
      parseTarget,
    );

    for (const result of [skipped, mismatched]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.issues[0]?.code).toBe('UPCASTER_INVALID');
    }
  });

  it('detects source mutation', () => {
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: (value) => {
          (value as Record<string, unknown>)['title'] = 'Mutated';
          return { schemaVersion: 2, label: 'Angel' };
        },
      },
      parseTarget,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.code).toBe('UPCASTER_MUTATED_SOURCE');
  });

  it('detects non-deterministic canonical output', () => {
    let call = 0;
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: () => ({ schemaVersion: 2, label: `Angel ${String((call += 1))}` }),
      },
      parseTarget,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.code).toBe('UPCASTER_NON_DETERMINISTIC');
  });

  it('snapshots a shared first output before the second upcaster call mutates it', () => {
    let call = 0;
    const sharedOutput: JsonVersionedDocument = { schemaVersion: 2, label: 'unset' };
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: () => {
          call += 1;
          sharedOutput['label'] = `Angel ${String(call)}`;
          return sharedOutput;
        },
      },
      parseTarget,
    );

    expect(result).toEqual({
      success: false,
      issues: [
        {
          code: 'UPCASTER_NON_DETERMINISTIC',
          path: '',
          message: 'Upcaster returned different canonical outputs.',
        },
      ],
    });
    expect(result).not.toEqual({ success: true, data: { schemaVersion: 2, label: 'Angel 2' } });
  });

  it('rechecks a retained first input after the second upcaster call', () => {
    let call = 0;
    let retainedFirstInput: Readonly<JsonVersionedDocument> | undefined;
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: (value) => {
          call += 1;
          if (call === 1) {
            retainedFirstInput = value;
          } else if (retainedFirstInput !== undefined) {
            (retainedFirstInput as Record<string, unknown>)['title'] = 'Mutated later';
          }
          return { schemaVersion: 2, label: 'Angel' };
        },
      },
      parseTarget,
    );

    expect(result).toEqual({
      success: false,
      issues: [
        {
          code: 'UPCASTER_MUTATED_SOURCE',
          path: '',
          message: 'Upcaster mutated its source document.',
        },
      ],
    });
  });

  it('rejects output that fails the target runtime parser', () => {
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: () => ({ schemaVersion: 2, unexpected: true }),
      },
      parseTarget,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.code).toBe('UPCASTER_INVALID');
  });

  it('fails closed when an upcaster throws instead of being total', () => {
    const result = runPureUpcasterHarness(
      source,
      {
        fromVersion: 1,
        toVersion: 2,
        upcast: () => {
          throw new Error('fixture failure');
        },
      },
      parseTarget,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0]?.code).toBe('UPCASTER_INVALID');
  });
});

describe('ActorWorkspaceContext', () => {
  it('constructs branded, provider-neutral context values', () => {
    const context = createActorWorkspaceContext({
      actorId: createActorId('actor_local_01'),
      workspaceId: createWorkspaceId('workspace_local_01'),
      requestId: createRequestId('request:local:01'),
    });

    expect(context).toEqual({
      actorId: 'actor_local_01',
      workspaceId: 'workspace_local_01',
      requestId: 'request:local:01',
    });
    expect(createProjectId('project_local_01')).toBe(ProjectIdSchema.parse('project_local_01'));
  });

  it('rejects malformed identifiers, missing values, null, and unknown keys', () => {
    expect(() => createActorId('short')).toThrow();
    expect(() => createRequestId('bad space')).toThrow();
    expect(() => ActorWorkspaceContextSchema.parse(null)).toThrow();
    expect(() =>
      ActorWorkspaceContextSchema.parse({
        actorId: 'actor_local_01',
        workspaceId: 'workspace_local_01',
        requestId: 'request:local:01',
        authProvider: 'none',
      }),
    ).toThrow();
  });
});
