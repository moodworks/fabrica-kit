import {
  SAM_LIMITS,
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamLiveExecutionIdentitySchema,
  SamMaskRequestSchema,
  SamWorkerImageDigestSchema,
  type SamExecutionIdentity,
  type SamMaskRequest,
} from '../sam/sam-mask-contracts.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1,
  readPendingCorpusPackageFileV1,
} from './real-model-benchmark-pending-corpus-source-registry.js';
import {
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  SamRunPodDirectEndpointIdSchema,
  deriveSamRunPodDirectV3Endpoint,
} from './sam-runpod-direct-v3-profiles.js';

export const SAM_FIRST_INFERENCE_ENDPOINT_ID = 'sawwuq4u7oiftj' as const;
export const SAM_FIRST_INFERENCE_ENDPOINT_NAME = 'fabrica-sam21-baseplus-build3' as const;
export const SAM_FIRST_INFERENCE_ENDPOINT_VERSION = 12 as const;
export const SAM_FIRST_INFERENCE_FIXTURE_ID = 'banner-person-v1' as const;
export const SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST =
  'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8' as const;
export const SAM_FIRST_INFERENCE_WORKER_IMAGE =
  `ghcr.io/moodworks/fabrica-sam-worker@${SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST}` as const;
export const SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS = 330_000 as const;
export const SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD = 250_000 as const;

export const SAM_FIRST_INFERENCE_FIXTURE = Object.freeze({
  fixtureId: SAM_FIRST_INFERENCE_FIXTURE_ID,
  normalizedReference: 'person-normalized' as const,
  byteSize: 241_013 as const,
  width: 876 as const,
  height: 221 as const,
  sha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699' as const,
});

export const SAM_FIRST_INFERENCE_REQUEST_LIMITS = Object.freeze({
  minMaskAreaPixels: 64 as const,
  maxCandidates: 8 as const,
});

/** Fixed one-milestone identifiers; they are not accepted from callers. */
export const SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS = Object.freeze({
  requestId: '817e7fd7-0c34-4449-ae81-38c90505a39b' as const,
  workspaceId: 'dd1f94e4-308e-4fd9-8ea0-e1d60f5d6cb5' as const,
  jobId: '2f249fbd-f14b-4004-8c74-1817fd2ef537' as const,
  attemptId: '08fb06c9-50c8-40e7-851f-922e4e2be5ff' as const,
});

export const SAM_FIRST_INFERENCE_EXECUTION_IDENTITY = SamLiveExecutionIdentitySchema.parse({
  kind: 'meta-sam2.1',
  repositoryUrl: 'https://github.com/facebookresearch/sam2',
  repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
  modelId: 'sam2.1_hiera_base_plus',
  configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml',
  checkpointUrl:
    'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt',
  checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
  workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
});

export const SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE = Object.freeze({
  samContract: SAM_MASK_CONTRACT_VERSION,
  checkpoint: Object.freeze({
    filename: 'sam2.1_hiera_base_plus.pt' as const,
    byteSize: 323_606_802 as const,
    sha256: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.checkpointSha256,
  }),
  distributions: Object.freeze({
    torch: '2.5.1+cu124' as const,
    torchvision: '0.20.1+cu124' as const,
  }),
  normalizedConfigurationSha256:
    '268e8972d9b8a502a1eec2a9ca6f42c65ffd2819c1108b6b8ed3da682fe5ac17' as const,
  selectedConfigurationSha256:
    'e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754' as const,
  selectedConfigurationAdapterProfileSha256:
    'f03c378caa5b9ba7979d67ffe958dfd9ca65cc823a10d728faed8c612937b7bf' as const,
  modelLoaderSha256: 'ec90d83f41840970b8df9947229908aad49fc15c71386096a60fe83318cf90dc' as const,
  artifactManifestSha256:
    '085ddd290b17b6931ea026c274610d9f6c49bad49a5fd372e846a2060b9ac5c4' as const,
  artifactManifestFileSha256:
    '412c430426d0cfcba50b908d2909907adda64813b7b1165642b8db677a8d6251' as const,
  selectedConfigurationAdapterProfileFileSha256:
    '93dfa19521a20d31ebd548de95e18c5f549e63350dd0d8aeb4e7c5075d49557e' as const,
  protocolVectorsVersion: 4 as const,
  protocolVectorsFileSha256:
    '76e83a4ff42fa794817e910b6e365099a93b5fa5f6ff287fcc9b601782b54aa1' as const,
  workerRuntimeFileSha256:
    '89124232de7c3f079bfa31593def66a01f2040539ba01c5c5b9e9c4223237aaf' as const,
  workerEngineFileSha256:
    '0c38620212e8cb6f7a5dcc2130c4700c938fc06159d9628eb3b4560b3cc4fad4' as const,
  workerHostingFileSha256:
    '55e8f0b6108af002f81ef59ce0000c100b64cee1252eec856ec2ef318b88f2b6' as const,
  workerHostingVersion: SAM_RUNPOD_DIRECT_HOSTING_PROFILE.workerHostingVersion,
  directHostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  directAdapterV3ProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  authorizationV3ProfileSha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
});

export interface SamRunPodDirectV3PreparedRequest {
  readonly endpointId: string;
  readonly endpoint: string;
  readonly request: SamMaskRequest;
  readonly workerImageDigest: string | null;
  readonly canonicalBodyText: string;
  readonly canonicalBodyBytes: Uint8Array;
  readonly canonicalBodyByteLength: number;
  readonly canonicalBodySha256: string;
  readonly orderedTopLevelFieldNames: readonly string[];
}

interface PreparedRequestPrivateState {
  readonly endpointId: string;
  readonly endpoint: string;
  readonly request: SamMaskRequest;
  readonly workerImageDigest: string | null;
  readonly canonicalBodyText: string;
  readonly canonicalBodyByteLength: number;
  readonly canonicalBodySha256: string;
  readonly milestone: typeof SAM_FIRST_INFERENCE_FIXTURE_ID | null;
  readonly expectedExecutionIdentity: SamExecutionIdentity | null;
}

const preparedRequestState = new WeakMap<object, PreparedRequestPrivateState>();

export const inspectSamRunPodDirectV3PreparedRequest = (
  prepared: SamRunPodDirectV3PreparedRequest,
): PreparedRequestPrivateState => {
  const state = preparedRequestState.get(prepared);
  if (state === undefined) {
    throw new TypeError('SAM direct prepared request is foreign or reconstructed.');
  }
  return state;
};

const prepareRequest = (input: {
  readonly endpointId: string;
  readonly requestInput: unknown;
  readonly workerImageDigest?: string;
  readonly milestone?: typeof SAM_FIRST_INFERENCE_FIXTURE_ID;
  readonly expectedExecutionIdentity?: SamExecutionIdentity;
}): SamRunPodDirectV3PreparedRequest => {
  const endpointId = SamRunPodDirectEndpointIdSchema.parse(input.endpointId);
  const endpoint = deriveSamRunPodDirectV3Endpoint(endpointId);
  const { request } = parseAndVerifySamMaskRequest(input.requestInput);
  const workerImageDigest =
    input.workerImageDigest === undefined
      ? null
      : SamWorkerImageDigestSchema.parse(input.workerImageDigest);
  const wireRequest =
    workerImageDigest === null ? request : Object.freeze({ ...request, workerImageDigest });
  if (Object.hasOwn(request, 'endpoint') || Object.hasOwn(request, 'input')) {
    throw new TypeError('SAM direct request contains foreign transport authority.');
  }
  const canonicalBodyText = canonicalizeJson(wireRequest);
  const canonicalBodyByteLength = Buffer.byteLength(canonicalBodyText, 'utf8');
  if (canonicalBodyByteLength > SAM_LIMITS.requestJsonBytes) {
    throw new TypeError('SAM direct request exceeds its canonical JSON byte budget.');
  }
  const state: PreparedRequestPrivateState = Object.freeze({
    endpointId,
    endpoint,
    request,
    workerImageDigest,
    canonicalBodyText,
    canonicalBodyByteLength,
    canonicalBodySha256: sha256Hex(Buffer.from(canonicalBodyText, 'utf8')),
    milestone: input.milestone ?? null,
    expectedExecutionIdentity: input.expectedExecutionIdentity ?? null,
  });
  const prepared = Object.freeze({
    endpointId: state.endpointId,
    endpoint: state.endpoint,
    request: state.request,
    workerImageDigest: state.workerImageDigest,
    canonicalBodyText: state.canonicalBodyText,
    get canonicalBodyBytes(): Uint8Array {
      return Uint8Array.from(Buffer.from(state.canonicalBodyText, 'utf8'));
    },
    canonicalBodyByteLength: state.canonicalBodyByteLength,
    canonicalBodySha256: state.canonicalBodySha256,
    orderedTopLevelFieldNames: Object.freeze(Object.keys(wireRequest).toSorted()),
  });
  preparedRequestState.set(prepared, state);
  return prepared;
};

/** Server-internal shared canonical construction used by the adapter's general path. */
export const prepareSamRunPodDirectV3Request = (input: {
  readonly endpointId: string;
  readonly requestInput: unknown;
  readonly workerImageDigest?: string;
}): SamRunPodDirectV3PreparedRequest => prepareRequest(input);

/**
 * Provider-free fixed preparation for the first inference milestone. Callers supply no fixture,
 * bytes, path, URL, endpoint, digest, mode, limit, profile, or authorization value.
 */
export const prepareSamFirstInferenceV3Request = async (
  rejectedCallerInput?: never,
): Promise<SamRunPodDirectV3PreparedRequest> => {
  if (rejectedCallerInput !== undefined) {
    throw new TypeError('The fixed SAM milestone preparation accepts no caller input.');
  }
  const entries = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1.filter(
    (entry) => entry.fixtureId === SAM_FIRST_INFERENCE_FIXTURE_ID,
  );
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    entry === undefined ||
    entry.normalized.reference !== SAM_FIRST_INFERENCE_FIXTURE.normalizedReference ||
    entry.normalized.filename !== 'banner-person-v1.png' ||
    entry.normalized.detectedMediaType !== 'image/png'
  ) {
    throw new TypeError('The fixed SAM milestone fixture registry binding drifted.');
  }
  const source = await readPendingCorpusPackageFileV1(entry.normalized.reference);
  if (
    source.byteLength !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    sha256Hex(source) !== SAM_FIRST_INFERENCE_FIXTURE.sha256
  ) {
    throw new TypeError('The fixed SAM milestone normalized fixture bytes drifted.');
  }
  const request = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    ...SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS,
    source: {
      mediaType: 'image/png',
      byteSize: SAM_FIRST_INFERENCE_FIXTURE.byteSize,
      width: SAM_FIRST_INFERENCE_FIXTURE.width,
      height: SAM_FIRST_INFERENCE_FIXTURE.height,
      sha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
      pngBase64: Buffer.from(source).toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: SAM_FIRST_INFERENCE_REQUEST_LIMITS,
    output: { maskEncoding: SAM_MASK_ENCODING },
  });
  return prepareRequest({
    endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    requestInput: request,
    workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    milestone: SAM_FIRST_INFERENCE_FIXTURE_ID,
    expectedExecutionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  });
};

export const assertSamFirstInferenceV3PreparedRequest = (
  prepared: SamRunPodDirectV3PreparedRequest,
): PreparedRequestPrivateState => {
  const state = inspectSamRunPodDirectV3PreparedRequest(prepared);
  if (
    state.milestone !== SAM_FIRST_INFERENCE_FIXTURE_ID ||
    state.endpointId !== SAM_FIRST_INFERENCE_ENDPOINT_ID ||
    state.workerImageDigest !== SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST ||
    state.request.source.sha256 !== SAM_FIRST_INFERENCE_FIXTURE.sha256 ||
    state.request.source.byteSize !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    state.request.source.width !== SAM_FIRST_INFERENCE_FIXTURE.width ||
    state.request.source.height !== SAM_FIRST_INFERENCE_FIXTURE.height ||
    state.request.segmentation.mode !== 'automatic-candidates' ||
    state.request.limits.minMaskAreaPixels !==
      SAM_FIRST_INFERENCE_REQUEST_LIMITS.minMaskAreaPixels ||
    state.request.limits.maxCandidates !== SAM_FIRST_INFERENCE_REQUEST_LIMITS.maxCandidates ||
    canonicalizeJson(state.expectedExecutionIdentity) !==
      canonicalizeJson(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY)
  ) {
    throw new TypeError('SAM first-inference preparation identity drifted.');
  }
  return state;
};
