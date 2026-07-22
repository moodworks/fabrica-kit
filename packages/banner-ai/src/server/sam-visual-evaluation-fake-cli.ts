import { createTestOnlySamRunPodDirectV3AuthorizationSources } from './sam-runpod-direct-v3-authorization.js';
import { RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS } from './sam-runpod-direct-v3-profiles.js';
import {
  createSamVisualEvaluationDeterministicFakeTransportV1,
  executeSamVisualEvaluationV1,
} from './sam-visual-evaluation-control-v1.js';
import { SAM_VISUAL_EVALUATION_FAKE_LABEL } from './sam-visual-evaluation-v1.js';

const rawArgumentsAfterScript = process.argv.slice(2);
const argumentsAfterScript =
  rawArgumentsAfterScript[0] === '--' ? rawArgumentsAfterScript.slice(1) : rawArgumentsAfterScript;
if (argumentsAfterScript.length !== 1 || argumentsAfterScript[0] === undefined) {
  throw new TypeError(
    'The provider-free SAM visual CLI requires one explicit outside-repository fake output directory.',
  );
}

const transport = createSamVisualEvaluationDeterministicFakeTransportV1();
const result = await executeSamVisualEvaluationV1({
  mode: 'provider-free-deterministic-fake',
  outputDirectory: argumentsAfterScript[0],
  transport,
  testOnlyAuthorizationSources: createTestOnlySamRunPodDirectV3AuthorizationSources({
    nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 10_000,
    authorizationId: () => 'f2736f90-baf5-441a-93b4-7d9d0cafb751',
  }),
});

process.stdout.write(
  `${JSON.stringify({
    label: SAM_VISUAL_EVALUATION_FAKE_LABEL,
    candidateCount: result.artifacts.manifest.candidateCount,
    canonicalRequestSha256: result.canonicalRequestSha256,
    sanitizedResponseSha256: result.artifacts.manifest.sanitizedResponseSha256,
    manifestSha256: result.artifacts.manifestSha256,
    dispatchCount: transport.getCallCount(),
    materializationCount: result.materializationCount,
    nativeTransportCalls: 0,
    networkCalls: transport.networkCalls,
    realAuthorizationMinted: false,
    retryCount: result.retryCount,
    pollCount: result.pollCount,
  })}\n`,
);
