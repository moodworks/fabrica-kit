import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { replaySanitizedQwenResponseV1 } from './qwen3-vl-response-diagnostics.js';

const responseFileFromArguments = (): string => {
  const markerIndex = process.argv.indexOf('--response-file');
  const candidate = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
  if (candidate === undefined || candidate.length < 1) {
    throw new TypeError('Qwen replay requires --response-file.');
  }
  return candidate;
};

const main = async (): Promise<void> => {
  const result = await replaySanitizedQwenResponseV1({
    responseFile: responseFileFromArguments(),
  });
  process.stdout.write(`${canonicalizeJson(result)}\n`);
  if (!result.replayReproduced) process.exitCode = 1;
};

void main().catch(() => {
  process.stderr.write('Qwen response replay failed closed.\n');
  process.exitCode = 1;
});
