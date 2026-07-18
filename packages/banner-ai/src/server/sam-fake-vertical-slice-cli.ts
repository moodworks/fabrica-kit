import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import {
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  type SamMaskRequest,
} from '../sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import { createSamRunPodAdapter } from './sam-runpod-adapter.js';
import {
  SAM_DETERMINISTIC_FAKE_IDENTITY,
  createDeterministicSamRunPodTransport,
} from './sam-runpod-deterministic-fake-transport.js';

const label = 'DETERMINISTIC FAKE MASKS — NOT SAM OUTPUT';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = resolve(packageRoot, '../..');
const fixturePath = join(
  packageRoot,
  'test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
);
const outputDirectory = join(repositoryRoot, '.local-data/banner-ai/sam-fake-vertical-slice');

const escapeHtml = (input: string): string =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const main = async (): Promise<void> => {
  const source = await readFile(fixturePath);
  const sourceSha256 = sha256(source);
  if (
    source.byteLength !== 125_894 ||
    sourceSha256 !== '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073'
  ) {
    throw new TypeError('The package-owned normalized demonstration fixture drifted.');
  }
  const request: SamMaskRequest = {
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: '9d4c6db4-9808-4c21-9e6b-924edc266f41',
    workspaceId: '32205d2c-f4a4-41bf-a08d-9927bb4b4b52',
    jobId: '337ed90e-234e-4cf4-8d94-0919a9249f4e',
    attemptId: '684173c2-7a85-4703-b99f-abee3f037e53',
    source: {
      mediaType: 'image/png',
      byteSize: source.byteLength,
      width: 738,
      height: 255,
      sha256: sourceSha256,
      pngBase64: source.toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: { minMaskAreaPixels: 64, maxCandidates: 8 },
    output: { maskEncoding: SAM_MASK_ENCODING },
  };
  const transport = createDeterministicSamRunPodTransport();
  const adapter = createSamRunPodAdapter({
    endpointId: 'deterministic-fake-only',
    expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
    transport,
  });
  const response = await adapter.generate(request, null);
  await mkdir(outputDirectory, { recursive: true });
  const rows: string[] = [];
  for (const candidate of response.candidates) {
    const first = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    const second = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    if (
      !Buffer.from(first.cutoutPng).equals(Buffer.from(second.cutoutPng)) ||
      !Buffer.from(first.binaryMaskPng).equals(Buffer.from(second.binaryMaskPng)) ||
      JSON.stringify(first.metadata) !== JSON.stringify(second.metadata)
    ) {
      throw new TypeError('Fake demonstration materialization is not byte reproducible.');
    }
    await Promise.all([
      writeFile(join(outputDirectory, first.metadata.filenames.cutout), first.cutoutPng),
      writeFile(join(outputDirectory, first.metadata.filenames.binaryMask), first.binaryMaskPng),
      writeFile(
        join(outputDirectory, first.metadata.filenames.metadata),
        `${JSON.stringify(first.metadata, null, 2)}\n`,
        'utf8',
      ),
    ]);
    const overlay = await sharp(source)
      .composite([
        {
          input: Buffer.from(first.binaryMaskPng),
          blend: 'screen',
        },
      ])
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const overlayName = `${candidate.candidateId}.overlay.png`;
    await writeFile(join(outputDirectory, overlayName), overlay);
    rows.push(`<section>
      <h2>${escapeHtml(candidate.candidateId)}</h2>
      <p>bounds: ${escapeHtml(JSON.stringify(candidate.bounds))}</p>
      <div class="grid">
        <figure><img src="source.png" alt="Original normalized fixture"><figcaption>Original</figcaption></figure>
        <figure><img src="${overlayName}" alt="Deterministic fake mask overlay"><figcaption>Mask overlay</figcaption></figure>
        <figure class="checker"><img src="${first.metadata.filenames.cutout}" alt="Transparent cutout"><figcaption>Transparent cutout</figcaption></figure>
      </div>
    </section>`);
  }
  await writeFile(join(outputDirectory, 'source.png'), source);
  await writeFile(
    join(outputDirectory, 'report.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>${label}</title>
<style>body{font:15px system-ui;margin:2rem;background:#111;color:#eee}h1{color:#ff4da6}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}figure{margin:0;padding:1rem;background:#222}img{max-width:100%;height:auto}.checker{background-color:#fff;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}</style>
<body><h1>${label}</h1><p>Provider-free code-generated masks over an immutable package fixture. No SAM model or provider ran.</p>${rows.join('\n')}</body></html>\n`,
    'utf8',
  );
  await writeFile(
    join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(
      {
        label,
        source: {
          repositoryRelativePath:
            'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
          byteSize: source.byteLength,
          width: 738,
          height: 255,
          sha256: sourceSha256,
        },
        executionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
        networkCalls: transport.networkCalls,
        candidateIds: response.candidates.map((candidate) => candidate.candidateId),
        reproduction: 'materialized-twice-byte-identical',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(
    `${label}\n${outputDirectory}\n${response.candidateCount} candidates; zero network\n`,
  );
};

await main();
