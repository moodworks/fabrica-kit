import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA =
  '524a708ed95972e39a994ad711e4202238094fc2' as const;

const GitObjectIdSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const ImmutableIdentityObjectSchema = z.custom<Readonly<Record<string, unknown>>>(
  (input) =>
    typeof input === 'object' && input !== null && !Array.isArray(input) && Object.isFrozen(input),
  { error: 'Repository identity objects must be immutable.' },
);

export const SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema =
  ImmutableIdentityObjectSchema.pipe(
    z
      .strictObject({
        executingMergeSha: GitObjectIdSchema,
        executingMergeTreeSha: GitObjectIdSchema,
        firstParentSha: GitObjectIdSchema,
        reviewedImplementationSha: GitObjectIdSchema,
        reviewedImplementationTreeSha: GitObjectIdSchema,
        corpusProvenanceSha: z.literal(SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA),
      })
      .readonly(),
  );

export type SamTextHeavyProductionV3ExpectedRepositoryIdentity = z.infer<
  typeof SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema
>;

export const SamTextHeavyProductionV3ObservedRepositoryIdentitySchema =
  ImmutableIdentityObjectSchema.pipe(
    z
      .strictObject({
        headSha: GitObjectIdSchema,
        headTreeSha: GitObjectIdSchema,
        parentCount: z.int().min(0),
        firstParentSha: GitObjectIdSchema.nullable(),
        secondParentSha: GitObjectIdSchema.nullable(),
        secondParentTreeSha: GitObjectIdSchema.nullable(),
        localMainSha: GitObjectIdSchema,
        originMainSha: GitObjectIdSchema,
        headDetached: z.boolean(),
        currentBranchIsMain: z.boolean(),
        indexClean: z.boolean(),
        worktreeClean: z.boolean(),
        untrackedFilesPresent: z.boolean(),
      })
      .readonly(),
  );

export type SamTextHeavyProductionV3ObservedRepositoryIdentity = z.infer<
  typeof SamTextHeavyProductionV3ObservedRepositoryIdentitySchema
>;

export type SamTextHeavyProductionV3RepositoryObserverProvenance =
  'production-local-git' | 'test-only-injected';

const expectedObservedRepositoryIdentityMatches = (
  expected: SamTextHeavyProductionV3ExpectedRepositoryIdentity,
  observed: SamTextHeavyProductionV3ObservedRepositoryIdentity,
): boolean =>
  expected.executingMergeSha !== expected.reviewedImplementationSha &&
  expected.executingMergeSha !== expected.corpusProvenanceSha &&
  expected.reviewedImplementationSha !== expected.corpusProvenanceSha &&
  expected.executingMergeTreeSha === expected.reviewedImplementationTreeSha &&
  observed.headSha === expected.executingMergeSha &&
  observed.headTreeSha === expected.executingMergeTreeSha &&
  observed.parentCount === 2 &&
  observed.firstParentSha === expected.firstParentSha &&
  observed.secondParentSha === expected.reviewedImplementationSha &&
  observed.secondParentTreeSha === expected.reviewedImplementationTreeSha &&
  observed.headTreeSha === observed.secondParentTreeSha &&
  observed.localMainSha === expected.executingMergeSha &&
  observed.originMainSha === expected.executingMergeSha &&
  !observed.headDetached &&
  observed.currentBranchIsMain &&
  observed.indexClean &&
  observed.worktreeClean &&
  !observed.untrackedFilesPresent;

export const SamTextHeavyProductionV3RepositoryExecutionEvidenceSchema =
  ImmutableIdentityObjectSchema.pipe(
    z
      .strictObject({
        schema: z.literal('sam-text-heavy-production-v3-repository-execution-binding'),
        version: z.literal(2),
        observerProvenance: z.enum(['production-local-git', 'test-only-injected']),
        expected: SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema,
        observed: SamTextHeavyProductionV3ObservedRepositoryIdentitySchema,
      })
      .superRefine((evidence, context) => {
        if (!expectedObservedRepositoryIdentityMatches(evidence.expected, evidence.observed)) {
          context.addIssue({
            code: 'custom',
            message: 'Repository execution evidence does not prove the expected merge.',
          });
        }
      })
      .readonly(),
  );

export type SamTextHeavyProductionV3RepositoryExecutionEvidence = z.infer<
  typeof SamTextHeavyProductionV3RepositoryExecutionEvidenceSchema
>;

export interface SamTextHeavyProductionV3RepositoryObserver {
  readonly purpose: 'sam-text-heavy-production-v3-repository-observer';
}

export interface SamTextHeavyProductionV3VerifiedRepositoryBinding {
  readonly purpose: 'verified-sam-text-heavy-production-v3-repository-binding';
}

interface RepositoryObserverState {
  readonly observe: () => unknown;
  readonly provenance: SamTextHeavyProductionV3RepositoryObserverProvenance;
  observationCount: number;
  observationInProgress: boolean;
}

interface VerifiedRepositoryBindingState {
  readonly expected: SamTextHeavyProductionV3ExpectedRepositoryIdentity;
  readonly observer: SamTextHeavyProductionV3RepositoryObserver;
  readonly observerProvenance: SamTextHeavyProductionV3RepositoryObserverProvenance;
  evidence: SamTextHeavyProductionV3RepositoryExecutionEvidence | null;
}

const repositoryObservers = new WeakMap<object, RepositoryObserverState>();
const verifiedRepositoryBindings = new WeakMap<object, VerifiedRepositoryBindingState>();

const EXECUTING_MODULE_REPOSITORY_ROOT = (() => {
  try {
    const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'));
    if (root.includes('\0') || root.includes('\n')) {
      throw new TypeError('Repository root was ambiguous.');
    }
    return root;
  } catch {
    throw new TypeError('SAM text-heavy executing repository root failed closed.');
  }
})();
const GIT_EXECUTABLE = '/usr/bin/git';
const GIT_ENVIRONMENT = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  GIT_ASKPASS: '/usr/bin/false',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_LITERAL_PATHSPECS: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_PAGER: '/bin/cat',
  GIT_TERMINAL_PROMPT: '0',
  SSH_ASKPASS: '/usr/bin/false',
});
const GIT_COMMON_ARGUMENTS = Object.freeze([
  '--no-replace-objects',
  '-c',
  'protocol.allow=never',
  '-c',
  'protocol.file.allow=never',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.untrackedCache=false',
  '-c',
  'fetch.recurseSubmodules=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'maintenance.auto=false',
  '-c',
  'gc.auto=0',
] as const);
const GIT_COMMON_OPTIONS = Object.freeze({
  cwd: EXECUTING_MODULE_REPOSITORY_ROOT,
  encoding: 'utf8' as const,
  env: GIT_ENVIRONMENT,
  maxBuffer: 4_096,
  timeout: 10_000,
  windowsHide: true,
});
const GIT_INSIDE_WORK_TREE_ARGS = Object.freeze(['rev-parse', '--is-inside-work-tree'] as const);
const GIT_TOP_LEVEL_ARGS = Object.freeze(['rev-parse', '--show-toplevel'] as const);
const GIT_HEAD_ARGS = Object.freeze(['rev-parse', '--verify', 'HEAD'] as const);
const GIT_HEAD_TREE_ARGS = Object.freeze(['rev-parse', '--verify', 'HEAD^{tree}'] as const);
const GIT_HEAD_PARENTS_ARGS = Object.freeze(['rev-list', '--parents', '-n', '1', 'HEAD'] as const);
const GIT_REVIEWED_TREE_ARGS = Object.freeze(['rev-parse', '--verify', 'HEAD^2^{tree}'] as const);
const GIT_LOCAL_MAIN_ARGS = Object.freeze(['rev-parse', '--verify', 'refs/heads/main'] as const);
const GIT_ORIGIN_MAIN_ARGS = Object.freeze([
  'rev-parse',
  '--verify',
  'refs/remotes/origin/main',
] as const);
const GIT_CURRENT_BRANCH_ARGS = Object.freeze([
  'symbolic-ref',
  '--quiet',
  '--short',
  'HEAD',
] as const);
const GIT_INDEX_CLEAN_ARGS = Object.freeze([
  'diff',
  '--cached',
  '--quiet',
  '--no-ext-diff',
  '--no-textconv',
  '--',
] as const);
const GIT_WORKTREE_CLEAN_ARGS = Object.freeze([
  'diff',
  '--quiet',
  '--no-ext-diff',
  '--no-textconv',
  '--',
] as const);
const GIT_UNTRACKED_ARGS = Object.freeze(['ls-files', '--others', '--exclude-standard'] as const);
const GIT_REPLACEMENT_REFS_ARGS = Object.freeze([
  'for-each-ref',
  '--format=%(refname)',
  'refs/replace/',
] as const);
const GIT_COMMON_DIRECTORY_ARGS = Object.freeze(['rev-parse', '--git-common-dir'] as const);

const runGit = (args: readonly string[], allowedStatuses: readonly number[]) => {
  const result = spawnSync(GIT_EXECUTABLE, [...GIT_COMMON_ARGUMENTS, ...args], {
    ...GIT_COMMON_OPTIONS,
    shell: false,
  });
  if (
    result.error !== undefined ||
    result.status === null ||
    !allowedStatuses.includes(result.status) ||
    result.stderr !== ''
  ) {
    throw new TypeError('Git observation failed.');
  }
  return result;
};

const runGitText = (args: readonly string[]): string => runGit(args, [0]).stdout;

const readExactGitObjectId = (args: readonly string[]): string => {
  const output = runGitText(args);
  if (!/^[0-9a-f]{40}\n$/u.test(output)) {
    throw new TypeError('Git object identity was not one exact object ID.');
  }
  return output.slice(0, -1);
};

const runGitStatus = (args: readonly string[]): 0 | 1 => {
  const result = runGit(args, [0, 1]);
  if (result.stdout !== '') {
    throw new TypeError('Git status observation was ambiguous.');
  }
  return result.status as 0 | 1;
};

const observeCurrentBranch = (): {
  readonly headDetached: boolean;
  readonly currentBranchIsMain: boolean;
} => {
  const result = runGit(GIT_CURRENT_BRANCH_ARGS, [0, 1]);
  if (result.status === 1) {
    if (result.stdout !== '') {
      throw new TypeError('Detached Git branch observation was ambiguous.');
    }
    return Object.freeze({ headDetached: true, currentBranchIsMain: false });
  }
  if (!/^[^\n]+\n$/u.test(result.stdout)) {
    throw new TypeError('Git branch observation was ambiguous.');
  }
  return Object.freeze({
    headDetached: false,
    currentBranchIsMain: result.stdout === 'main\n',
  });
};

const assertNoLegacyGrafts = (): void => {
  const output = runGitText(GIT_COMMON_DIRECTORY_ARGS);
  if (!/^[^\0\n]+\n$/u.test(output)) {
    throw new TypeError('Git common-directory observation was ambiguous.');
  }
  const commonDirectory = resolve(EXECUTING_MODULE_REPOSITORY_ROOT, output.slice(0, -1));
  try {
    lstatSync(join(commonDirectory, 'info', 'grafts'));
    throw new TypeError('Legacy Git grafts are forbidden.');
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw new TypeError('Legacy Git graft observation failed closed.');
    }
  }
};

const observeProductionRepository = (): SamTextHeavyProductionV3ObservedRepositoryIdentity => {
  if (
    runGitText(GIT_INSIDE_WORK_TREE_ARGS) !== 'true\n' ||
    runGitText(GIT_TOP_LEVEL_ARGS) !== `${EXECUTING_MODULE_REPOSITORY_ROOT}\n`
  ) {
    throw new TypeError('Git worktree could not be resolved.');
  }
  if (runGitText(GIT_REPLACEMENT_REFS_ARGS) !== '') {
    throw new TypeError('Git replacement refs are forbidden.');
  }
  assertNoLegacyGrafts();
  const headSha = readExactGitObjectId(GIT_HEAD_ARGS);
  const headTreeSha = readExactGitObjectId(GIT_HEAD_TREE_ARGS);
  const parentsOutput = runGitText(GIT_HEAD_PARENTS_ARGS);
  if (!/^[0-9a-f]{40}(?: [0-9a-f]{40})*\n$/u.test(parentsOutput)) {
    throw new TypeError('Git parent observation was ambiguous.');
  }
  const [listedHead, ...parentShas] = parentsOutput.slice(0, -1).split(' ');
  if (listedHead !== headSha) {
    throw new TypeError('Git HEAD and parent observation disagreed.');
  }
  const branch = observeCurrentBranch();
  const untrackedOutput = runGitText(GIT_UNTRACKED_ARGS);
  return SamTextHeavyProductionV3ObservedRepositoryIdentitySchema.parse(
    Object.freeze({
      headSha,
      headTreeSha,
      parentCount: parentShas.length,
      firstParentSha: parentShas[0] ?? null,
      secondParentSha: parentShas[1] ?? null,
      secondParentTreeSha:
        parentShas.length >= 2 ? readExactGitObjectId(GIT_REVIEWED_TREE_ARGS) : null,
      localMainSha: readExactGitObjectId(GIT_LOCAL_MAIN_ARGS),
      originMainSha: readExactGitObjectId(GIT_ORIGIN_MAIN_ARGS),
      ...branch,
      indexClean: runGitStatus(GIT_INDEX_CLEAN_ARGS) === 0,
      worktreeClean: runGitStatus(GIT_WORKTREE_CLEAN_ARGS) === 0,
      untrackedFilesPresent: untrackedOutput !== '',
    }),
  );
};

const createRepositoryObserver = (
  observe: () => unknown,
  provenance: SamTextHeavyProductionV3RepositoryObserverProvenance,
) => {
  const observer = Object.freeze({
    purpose: 'sam-text-heavy-production-v3-repository-observer' as const,
  });
  repositoryObservers.set(observer, {
    observe,
    provenance,
    observationCount: 0,
    observationInProgress: false,
  });
  return observer;
};

/** Uses only fixed, read-only local Git commands. It never fetches or performs network I/O. */
export const createSamTextHeavyProductionV3ProductionRepositoryObserver =
  (): SamTextHeavyProductionV3RepositoryObserver =>
    createRepositoryObserver(observeProductionRepository, 'production-local-git');

export const createTestOnlySamTextHeavyProductionV3RepositoryObserver = (input: {
  readonly observe: () => unknown;
}): SamTextHeavyProductionV3RepositoryObserver => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input)) !== JSON.stringify(['observe']) ||
    typeof input.observe !== 'function'
  ) {
    throw new TypeError('SAM text-heavy test repository observer input is not closed.');
  }
  return createRepositoryObserver(input.observe, 'test-only-injected');
};

const parseExpectedIdentity = (
  input: unknown,
): SamTextHeavyProductionV3ExpectedRepositoryIdentity => {
  try {
    return SamTextHeavyProductionV3ExpectedRepositoryIdentitySchema.parse(input);
  } catch {
    throw new TypeError('SAM text-heavy expected repository identity failed closed.');
  }
};

const readObservedIdentity = (
  observer: SamTextHeavyProductionV3RepositoryObserver,
): SamTextHeavyProductionV3ObservedRepositoryIdentity => {
  const state = repositoryObservers.get(observer);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy repository observer is foreign.');
  }
  if (state.observationInProgress) {
    throw new TypeError('SAM text-heavy repository observation reentry is forbidden.');
  }
  state.observationInProgress = true;
  state.observationCount += 1;
  try {
    return SamTextHeavyProductionV3ObservedRepositoryIdentitySchema.parse(state.observe());
  } catch {
    throw new TypeError('SAM text-heavy Git observation failed closed.');
  } finally {
    state.observationInProgress = false;
  }
};

const assertExpectedObservedBinding = (
  expected: SamTextHeavyProductionV3ExpectedRepositoryIdentity,
  observed: SamTextHeavyProductionV3ObservedRepositoryIdentity,
): void => {
  if (!expectedObservedRepositoryIdentityMatches(expected, observed)) {
    throw new TypeError('SAM text-heavy repository execution binding failed closed.');
  }
};

const revalidateState = (
  state: VerifiedRepositoryBindingState,
): SamTextHeavyProductionV3RepositoryExecutionEvidence => {
  const observed = readObservedIdentity(state.observer);
  assertExpectedObservedBinding(state.expected, observed);
  const evidence = SamTextHeavyProductionV3RepositoryExecutionEvidenceSchema.parse(
    Object.freeze({
      schema: 'sam-text-heavy-production-v3-repository-execution-binding',
      version: 2,
      observerProvenance: state.observerProvenance,
      expected: state.expected,
      observed,
    }),
  );
  state.evidence = evidence;
  return evidence;
};

export const verifySamTextHeavyProductionV3RepositoryExecutionBinding = (input: {
  readonly expected: SamTextHeavyProductionV3ExpectedRepositoryIdentity;
  readonly observer: SamTextHeavyProductionV3RepositoryObserver;
}): SamTextHeavyProductionV3VerifiedRepositoryBinding => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !== JSON.stringify(['expected', 'observer'])
  ) {
    throw new TypeError('SAM text-heavy repository binding input is not closed.');
  }
  const observerState = repositoryObservers.get(input.observer);
  if (observerState === undefined) {
    throw new TypeError('SAM text-heavy repository observer is foreign.');
  }
  const binding = Object.freeze({
    purpose: 'verified-sam-text-heavy-production-v3-repository-binding' as const,
  });
  const state: VerifiedRepositoryBindingState = {
    expected: parseExpectedIdentity(input.expected),
    observer: input.observer,
    observerProvenance: observerState.provenance,
    evidence: null,
  };
  verifiedRepositoryBindings.set(binding, state);
  revalidateState(state);
  return binding;
};

export const revalidateSamTextHeavyProductionV3RepositoryExecutionBinding = (
  binding: SamTextHeavyProductionV3VerifiedRepositoryBinding,
): SamTextHeavyProductionV3RepositoryExecutionEvidence => {
  const state = verifiedRepositoryBindings.get(binding);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy repository binding is foreign.');
  }
  return revalidateState(state);
};

export const inspectSamTextHeavyProductionV3RepositoryExecutionBinding = (
  binding: SamTextHeavyProductionV3VerifiedRepositoryBinding,
): SamTextHeavyProductionV3RepositoryExecutionEvidence => {
  const state = verifiedRepositoryBindings.get(binding);
  if (state?.evidence === null || state === undefined) {
    throw new TypeError('SAM text-heavy repository binding is foreign or unverified.');
  }
  return state.evidence;
};

export const assertSamTextHeavyProductionV3RepositoryBindingProvenance = (
  binding: SamTextHeavyProductionV3VerifiedRepositoryBinding,
  expectedProvenance: SamTextHeavyProductionV3RepositoryObserverProvenance,
): void => {
  const state = verifiedRepositoryBindings.get(binding);
  if (state === undefined || state.observerProvenance !== expectedProvenance) {
    throw new TypeError('SAM text-heavy repository observer provenance failed closed.');
  }
};

export const inspectTestOnlySamTextHeavyProductionV3RepositoryObserver = (
  observer: SamTextHeavyProductionV3RepositoryObserver,
): Readonly<{ observationCount: number }> => {
  const state = repositoryObservers.get(observer);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy repository observer is foreign.');
  }
  return Object.freeze({ observationCount: state.observationCount });
};
