import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { executeSamFirstInferenceV3 } from './sam-first-inference-control-v3.js';
import { createTestOnlySamRunPodDirectV3AuthorizationSources } from './sam-runpod-direct-v3-authorization.js';
import { createDeterministicSamRunPodDirectV3Transport } from './sam-runpod-direct-v3-deterministic-fake-transport.js';
import {
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
} from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_ENDPOINT_NAME,
  SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE,
  SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_WORKER_IMAGE,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
} from './sam-runpod-direct-v3-request-preparation.js';

const transport = createDeterministicSamRunPodDirectV3Transport();
const deterministicTimeMs = RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1_000;
const result = await executeSamFirstInferenceV3({
  mode: 'provider-free-deterministic-fake',
  transport,
  testOnlyAuthorizationSources: createTestOnlySamRunPodDirectV3AuthorizationSources({
    nowMs: () => deterministicTimeMs,
    authorizationId: () => '7aa03f06-5544-4afd-8b66-a44b05fd7cb9',
  }),
});

const sourceIdentity = Object.fromEntries(
  Object.entries(result.prepared.request.source).filter(([key]) => key !== 'pngBase64'),
);
const nonImageRequest = Object.fromEntries(
  Object.entries(result.prepared.request).filter(([key]) => key !== 'source'),
);
const parsedWireBody = JSON.parse(result.prepared.canonicalBodyText) as Record<string, unknown>;
const source = parsedWireBody.source as Record<string, unknown>;
const imageCount =
  Object.keys(source).filter((key) => key === 'pngBase64').length === 1 &&
  typeof source.pngBase64 === 'string'
    ? 1
    : 0;

const report = Object.freeze({
  phase: 'provider-free-phase-a' as const,
  endpoint: Object.freeze({
    id: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    name: SAM_FIRST_INFERENCE_ENDPOINT_NAME,
    version: SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
    url: result.prepared.endpoint,
    capturedOnly: true as const,
  }),
  deployment: Object.freeze({
    image: SAM_FIRST_INFERENCE_WORKER_IMAGE,
    workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  }),
  request: Object.freeze({
    canonicalBodyByteLength: result.prepared.canonicalBodyByteLength,
    canonicalBodySha256: result.prepared.canonicalBodySha256,
    orderedTopLevelFieldNames: result.prepared.orderedTopLevelFieldNames,
    imageCount,
    source: sourceIdentity,
    nonImageRequest,
    workerImageDigest: parsedWireBody.workerImageDigest,
    automaticCandidateLimits: SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  }),
  identities: Object.freeze({
    execution: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
    localEvidence: SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE,
    hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
    authorizationProfileSha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  }),
  authorization: Object.freeze({
    kind: result.authorizationKind,
    deterministicTestOnly: true as const,
    realAuthorizationMinted: false as const,
    credentialUsed: false as const,
  }),
  dispatch: Object.freeze({
    fakeDispatchCount: transport.getCallCount(),
    nativeDispatchCount: 0 as const,
    networkCalls: transport.networkCalls,
    retryCount: result.retryCount,
    pollCount: result.pollCount,
    timeoutMs: result.timeoutMs,
    costMaximumMicroUsd: SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  }),
  sanitizedResult: Object.freeze({
    executionIdentity: result.response.executionIdentity,
    sourceSha256: result.response.sourceSha256,
    candidateCount: result.response.candidateCount,
    candidates: result.response.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      bounds: candidate.bounds,
      pixelArea: candidate.pixelArea,
      areaRatioBps: candidate.areaRatioBps,
      predictedIouBps: candidate.predictedIouBps,
      stabilityScoreBps: candidate.stabilityScoreBps,
      mask: {
        encoding: candidate.mask.encoding,
        width: candidate.mask.width,
        height: candidate.mask.height,
        byteSize: candidate.mask.byteSize,
        sha256: candidate.mask.sha256,
      },
      reviewFlags: candidate.reviewFlags,
    })),
    responseSha256: result.response.responseSha256,
  }),
});

process.stdout.write(`${canonicalizeJson(report)}\n`);
