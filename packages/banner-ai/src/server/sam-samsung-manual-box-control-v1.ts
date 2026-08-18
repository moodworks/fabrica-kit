import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, realpath, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import type { SamMaskResponse } from '../sam/sam-mask-contracts.js';
import {
  createSamRunPodDirectV3Adapter,
  SamRunPodDirectV3Error,
} from './sam-runpod-direct-v3-adapter.js';
import { createSamRunPodDirectV3NativeFetchTransport } from './sam-runpod-direct-v3-native-fetch-transport.js';
import { mintSamSamsungManualBoxAuthorization } from './sam-runpod-direct-v3-authorization.js';
import {
  prepareSamSamsungManualBoxRequest,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  SAM_SAMSUNG_MANUAL_BOX_BPS,
  SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
  SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256,
  SAM_SAMSUNG_MANUAL_BOX_CROP,
  SAM_SAMSUNG_MANUAL_BOX_SOURCE,
  SAM_SAMSUNG_MANUAL_BOX_REQUEST_IDENTIFIERS,
} from './sam-runpod-direct-v3-request-preparation.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sourcePath = resolve(repositoryRoot, '.local-data/sam-samsung/normalized.png');
const reservationRoot = resolve(
  repositoryRoot,
  '.local-data/banner-ai/sam-samsung-manual-box-live-v1',
);
const operationId = createHash('sha256')
  .update(
    canonicalizeJson({
      endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
      source: SAM_SAMSUNG_MANUAL_BOX_SOURCE,
      crop: SAM_SAMSUNG_MANUAL_BOX_CROP,
      bounds: SAM_SAMSUNG_MANUAL_BOX_BPS,
      requestIdentifiers: SAM_SAMSUNG_MANUAL_BOX_REQUEST_IDENTIFIERS,
      canonicalRequestSha256: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256,
      canonicalRequestByteLength: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
      timeoutMs: 330_000,
      costMaximumMicroUsd: 250_000,
      dispatchMaximum: 1,
      executionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
      workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
      limits: { minMaskAreaPixels: 1, maxCandidates: 1 },
      output: { maskEncoding: 'fabrica-binary-rle-v1' },
    }),
  )
  .digest('hex');
export const SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID = `sam-samsung-manual-box-live-v1-${operationId}`;

export interface SamsungManualBoxPreflight {
  readonly operationId: string;
  readonly sourcePath: string;
  readonly source: typeof SAM_SAMSUNG_MANUAL_BOX_SOURCE;
  readonly crop: typeof SAM_SAMSUNG_MANUAL_BOX_CROP;
  readonly workerRoundtripBounds: typeof SAM_SAMSUNG_MANUAL_BOX_BPS;
  readonly endpointId: typeof SAM_FIRST_INFERENCE_ENDPOINT_ID;
  readonly canonicalRequestSha256: typeof SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256;
  readonly canonicalRequestByteLength: typeof SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH;
}

export const preflightSamsungManualBox = async (): Promise<SamsungManualBoxPreflight> => {
  const prepared = prepareSamSamsungManualBoxRequest(new Uint8Array(await readFile(sourcePath)));
  if (
    prepared.canonicalBodySha256 !== SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256 ||
    prepared.canonicalBodyByteLength !== SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH
  )
    throw new TypeError('Samsung manual-box canonical request evidence drifted.');
  return Object.freeze({
    operationId: SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID,
    sourcePath,
    source: SAM_SAMSUNG_MANUAL_BOX_SOURCE,
    crop: SAM_SAMSUNG_MANUAL_BOX_CROP,
    workerRoundtripBounds: SAM_SAMSUNG_MANUAL_BOX_BPS,
    endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    canonicalRequestSha256: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256,
    canonicalRequestByteLength: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
  });
};

const retained = new WeakMap<object, { dev: number; ino: number }>();
const syncDirectory = async (path: string) => {
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await h.sync();
  } finally {
    await h.close();
  }
};
const assertDirectory = async (path: string) => {
  if ((await realpath(path)) !== resolve(path)) throw new Error('ARTIFACT_DIRECTORY_INVALID');
  const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await h.stat();
    if (!stat.isDirectory()) throw new Error('ARTIFACT_DIRECTORY_INVALID');
  } finally {
    await h.close();
  }
};
const assertHandle = async (h: FileHandle) => {
  const s = await h.stat();
  const e = retained.get(h);
  if (
    !e ||
    !s.isFile() ||
    (s.mode & 0o777) !== 0o600 ||
    s.nlink !== 1 ||
    s.dev !== e.dev ||
    s.ino !== e.ino
  )
    throw new Error('ARTIFACT_HANDLE_INVALID');
};
const writeJson = async (h: FileHandle, v: unknown) => {
  await assertHandle(h);
  await h.writeFile(`${JSON.stringify(v)}\n`, 'utf8');
  await h.sync();
};
const writeBinary = async (h: FileHandle, b: Uint8Array) => {
  await assertHandle(h);
  await h.writeFile(b);
  await h.sync();
};
const openArtifact = async (path: string) => {
  const h = await open(
    path,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  const s = await h.stat();
  retained.set(h, { dev: s.dev, ino: s.ino });
  return h;
};

type DispatchResult = {
  readonly response?: SamMaskResponse;
  readonly status?: number;
  readonly body?: string;
  readonly dispatchCount: number;
  readonly cutoutPng?: Uint8Array;
  readonly maskPng?: Uint8Array;
};
type DispatchAccounting = { dispatchCount: number; status: number | null };
type Dispatch = (
  accounting: DispatchAccounting,
  revalidateClaim: () => Promise<void>,
) => Promise<DispatchResult>;
type CoreInput = {
  root: string;
  head: string;
  prepareDispatch: Dispatch;
  preflight: SamsungManualBoxPreflight;
};

const classify = (
  e: unknown,
): 'indeterminate' | 'provider_failure' | 'response_invalid' | 'failed_closed' =>
  e instanceof SamRunPodDirectV3Error
    ? e.reason === 'INDETERMINATE'
      ? 'indeterminate'
      : e.reason === 'PROVIDER_FAILURE'
        ? 'provider_failure'
        : e.reason === 'RESPONSE_INVALID'
          ? 'response_invalid'
          : 'failed_closed'
    : 'failed_closed';

const runCore = async ({ root, head, prepareDispatch, preflight }: CoreInput) => {
  const operation = resolve(root, preflight.operationId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertDirectory(root);
  await mkdir(operation, { recursive: false, mode: 0o700 });
  await assertDirectory(operation);
  const handles: FileHandle[] = [];
  try {
    for (const name of [
      'claim.json',
      'response.json',
      'report.json',
      'candidate-1.cutout.png',
      'candidate-1.mask.png',
    ])
      handles.push(await openArtifact(resolve(operation, name)));
    const claim = {
      operationId: preflight.operationId,
      status: 'claimed-before-dispatch',
      repositoryHead: head,
      canonicalRequestSha256: preflight.canonicalRequestSha256,
      canonicalRequestByteLength: preflight.canonicalRequestByteLength,
      requestIdentifiers: SAM_SAMSUNG_MANUAL_BOX_REQUEST_IDENTIFIERS,
    };
    const claimBytes = Buffer.from(`${JSON.stringify(claim)}\n`, 'utf8');
    await writeJson(handles[0]!, claim);
    const claimDigest = createHash('sha256').update(claimBytes).digest('hex');
    await syncDirectory(operation);
    await syncDirectory(root);
    const accounting: DispatchAccounting = { dispatchCount: 0, status: null };
    await assertHandle(handles[0]!);
    const rereadClaim = Buffer.alloc(claimBytes.length);
    const reread = await handles[0]!.read(rereadClaim, 0, claimBytes.length, 0);
    if (reread.bytesRead !== claimBytes.length || !rereadClaim.equals(claimBytes))
      throw new Error('CLAIM_CONTENT_INVALID');
    const revalidateClaim = async () => {
      await assertHandle(handles[0]!);
      const bytes = Buffer.alloc(claimBytes.length);
      const reread = await handles[0]!.read(bytes, 0, claimBytes.length, 0);
      if (
        reread.bytesRead !== claimBytes.length ||
        !bytes.equals(claimBytes) ||
        createHash('sha256').update(bytes).digest('hex') !== claimDigest
      )
        throw new Error('CLAIM_CONTENT_INVALID');
    };
    try {
      const result = await prepareDispatch(accounting, revalidateClaim);
      accounting.dispatchCount = Math.max(accounting.dispatchCount, result.dispatchCount);
      if (result.status !== undefined) accounting.status = result.status;
      if (result.status !== undefined && result.status !== 200)
        throw new SamRunPodDirectV3Error(
          result.status >= 500
            ? 'INDETERMINATE'
            : result.status >= 400
              ? 'PROVIDER_FAILURE'
              : 'RESPONSE_INVALID',
          'Samsung manual-box dispatch failed.',
        );
      if (
        result.response === undefined ||
        result.response.candidateCount !== 1 ||
        result.response.candidates.length !== 1
      )
        throw new SamRunPodDirectV3Error(
          'RESPONSE_INVALID',
          'Samsung manual-box response must contain exactly one candidate.',
        );
      const materialized =
        result.cutoutPng && result.maskPng
          ? {
              cutoutPng: result.cutoutPng,
              binaryMaskPng: result.maskPng,
              metadata: {
                cutoutPngSha256: createHash('sha256').update(result.cutoutPng).digest('hex'),
                maskSha256: createHash('sha256').update(result.maskPng).digest('hex'),
              },
            }
          : await materializeSamMaskCutout({
              trustedRequest: prepareSamSamsungManualBoxRequest(
                new Uint8Array(await readFile(sourcePath)),
              ).request,
              candidate: result.response.candidates[0]!,
            });
      await writeJson(handles[1]!, result.response);
      await writeBinary(handles[3]!, materialized.cutoutPng);
      await writeBinary(handles[4]!, materialized.binaryMaskPng);
      await writeJson(handles[2]!, {
        operationId: preflight.operationId,
        terminalClassification: 'success',
        dispatchCount: accounting.dispatchCount,
        retryCount: 0,
        pollCount: 0,
        endpointId: preflight.endpointId,
        requestIdentifiers: SAM_SAMSUNG_MANUAL_BOX_REQUEST_IDENTIFIERS,
        canonicalRequestSha256: preflight.canonicalRequestSha256,
        canonicalRequestByteLength: preflight.canonicalRequestByteLength,
        source: preflight.source,
        crop: preflight.crop,
        workerRoundtripBounds: preflight.workerRoundtripBounds,
        modelIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
        workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
        repositoryHead: head,
        clientWallTimeoutMs: 330_000,
        costMaximumMicroUsd: 250_000,
        providerBillingGuarantee: false,
        status: accounting.status,
        claimSha256: claimDigest,
        responseSha256: result.response.responseSha256,
        cutoutSha256: materialized.metadata.cutoutPngSha256,
        maskSha256: materialized.metadata.maskSha256,
      });
      await syncDirectory(operation);
      return {
        operation,
        terminalClassification: 'success',
        dispatchCount: accounting.dispatchCount,
      };
    } catch (error) {
      const terminalClassification = classify(error);
      await writeJson(handles[2]!, {
        operationId: preflight.operationId,
        terminalClassification,
        dispatchCount: accounting.dispatchCount,
        retryCount: 0,
        pollCount: 0,
        endpointId: preflight.endpointId,
        requestIdentifiers: SAM_SAMSUNG_MANUAL_BOX_REQUEST_IDENTIFIERS,
        canonicalRequestSha256: preflight.canonicalRequestSha256,
        canonicalRequestByteLength: preflight.canonicalRequestByteLength,
        source: preflight.source,
        crop: preflight.crop,
        workerRoundtripBounds: preflight.workerRoundtripBounds,
        modelIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
        workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
        repositoryHead: head,
        clientWallTimeoutMs: 330_000,
        costMaximumMicroUsd: 250_000,
        providerBillingGuarantee: false,
        status: accounting.status,
        claimSha256: claimDigest,
      });
      await syncDirectory(operation);
      throw new Error(terminalClassification);
    }
  } finally {
    await Promise.all(handles.map((h) => h.close()));
  }
};

const assertCleanHead = (expected?: string) => {
  if (
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim() !== repositoryRoot ||
    execFileSync('git', ['status', '--porcelain'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }).trim() !== ''
  )
    throw new Error('REPOSITORY_ADMISSION_FAILED');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (expected && expected !== head) throw new Error('REPOSITORY_ADMISSION_FAILED');
  return head;
};

const capabilities = new WeakMap<object, { root: string; dispatch: Dispatch }>();
const consumed = new WeakSet<object>();
export const createTestOnlySamsungManualBoxHarness = (input: {
  root: string;
  dispatch: Dispatch;
}) => {
  const capability = Object.freeze({ purpose: 'test-only-samsung-manual-box-harness' });
  capabilities.set(capability, { root: resolve(input.root), dispatch: input.dispatch });
  return capability;
};
export const runTestOnlySamsungManualBoxHarness = async (capability: object) => {
  const state = capabilities.get(capability);
  if (!state || consumed.has(capability))
    throw new TypeError('Samsung test harness capability is foreign or consumed.');
  consumed.add(capability);
  const root = await realpath(state.root);
  const tmp = await realpath(tmpdir());
  if (dirname(root) !== tmp || !root.split('/').at(-1)?.startsWith('sam-samsung-manual-box-test-'))
    throw new TypeError('Samsung test harness root realpath drifted.');
  const preflight = {
    operationId: SAM_SAMSUNG_MANUAL_BOX_OPERATION_ID,
    sourcePath,
    source: SAM_SAMSUNG_MANUAL_BOX_SOURCE,
    crop: SAM_SAMSUNG_MANUAL_BOX_CROP,
    workerRoundtripBounds: SAM_SAMSUNG_MANUAL_BOX_BPS,
    endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    canonicalRequestSha256: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_SHA256,
    canonicalRequestByteLength: SAM_SAMSUNG_MANUAL_BOX_CANONICAL_REQUEST_BYTE_LENGTH,
  } as SamsungManualBoxPreflight;
  return runCore({ root, head: 'test-head', prepareDispatch: state.dispatch, preflight });
};

export const executeSamsungManualBoxLive = async () => {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error('AUTHORIZATION_REQUIRED');
  const preflight = await preflightSamsungManualBox();
  const head = assertCleanHead();
  if (Date.now() + 330_000 >= Date.parse('2026-08-18T13:15:50Z'))
    throw new Error('EVIDENCE_EXPIRED');
  return runCore({
    root: reservationRoot,
    head,
    preflight,
    prepareDispatch: async (accounting, revalidateClaim) => {
      const currentHead = assertCleanHead(head);
      if (Date.now() + 330_000 >= Date.parse('2026-08-18T13:15:50Z'))
        throw new Error('EVIDENCE_EXPIRED');
      const prepared = prepareSamSamsungManualBoxRequest(
        new Uint8Array(await readFile(sourcePath)),
      );
      const authorization = mintSamSamsungManualBoxAuthorization(prepared);
      const adapter = createSamRunPodDirectV3Adapter({
        endpointId: preflight.endpointId,
        expectedExecutionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
        transport: createSamRunPodDirectV3NativeFetchTransport({
          apiKey: key,
          secretReferenceName: 'RUNPOD_API_KEY',
        }),
        authorization,
        configuredImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
        telemetry: (event) => {
          if (
            event.event === 'sam-runpod-direct-failed' ||
            event.event === 'sam-runpod-direct-succeeded'
          ) {
            accounting.dispatchCount = 1;
            accounting.status = event.status;
          }
        },
      });
      if (currentHead !== assertCleanHead(head)) throw new Error('REPOSITORY_ADMISSION_FAILED');
      await revalidateClaim();
      return {
        response: await adapter.dispatchPrepared(prepared),
        dispatchCount: accounting.dispatchCount,
      };
    },
  });
};
export const runSamsungManualBoxControl = async (mode: '--preflight' | '--live') =>
  mode === '--preflight' ? preflightSamsungManualBox() : executeSamsungManualBoxLive();

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSamsungManualBoxControl(process.argv[2] === '--live' ? '--live' : '--preflight')
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const safe = [
        'AUTHORIZATION_REQUIRED',
        'REPOSITORY_ADMISSION_FAILED',
        'EVIDENCE_EXPIRED',
        'indeterminate',
        'failed_closed',
        'response_invalid',
        'provider_failure',
      ].includes(message)
        ? message
        : 'LIVE_CONTROL_FAILED';
      process.stderr.write(`${safe}\n`);
      process.exitCode = 1;
    });
}
