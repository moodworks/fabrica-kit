import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, unlink, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  buildQwenSamContactSheet,
  buildQwenSamRequest,
  assertQwenSamAuthorizationLive,
  closeQwenSamReservation,
  createQwenSamAuthorization,
  executeQwenSamSelection,
  parseQwenSamSelection,
  reserveQwenSamSelection,
  validateQwenSamProviderResponse,
  verifyQwenSamReservation,
  verifyQwenSamEvidence,
  QWEN_SAM_MODEL,
} from '../src/server/qwen-sam-candidate-selector-v1.js';

async function inCleanGitRepo<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), 'fabrica-qwen-git-'));
  process.chdir(dir);
  try {
    execFileSync('git', ['init', '-q']);
    execFileSync('git', ['config', 'user.email', 'test@example.com']);
    execFileSync('git', ['config', 'user.name', 'Test']);
    await writeFile('fixture.txt', 'fixture');
    await writeFile('.gitignore', '.local-data/\n');
    execFileSync('git', ['add', 'fixture.txt', '.gitignore']);
    execFileSync('git', ['commit', '-q', '-m', 'fixture']);
    return await fn();
  } finally {
    process.chdir(previous);
    await rm(dir, { recursive: true, force: true });
  }
}

function providerBody(
  selection: unknown,
  usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
) {
  return JSON.stringify({
    id: 'qwen-test',
    object: 'chat.completion',
    created: 1,
    model: QWEN_SAM_MODEL,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(selection) },
        finish_reason: 'stop',
      },
    ],
    usage,
  });
}

describe.sequential('Qwen SAM candidate selector preparation', () => {
  it('pins real evidence and sends the private contact sheet image', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    const body = JSON.parse(request.requestBodyText) as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    expect(sheet.sha256).toBe('78b2cbe473a68b96c3221d488cc840f1f3377a0835aa477a6e99004d6b313291');
    expect(request.requestBodyText.length).toBe(642955);
    expect(sha256Hex(Buffer.from(request.requestBodyText))).toBe(
      'fc6b314ed0a87a14bdc57db7623c3efb2be07251bf074cba8891f41ef43a7cc4',
    );
    expect(body.messages[1]?.content.filter((part) => part.type === 'image_url')).toHaveLength(1);
    expect(body.messages[1]?.content[0]?.type).toBe('text');
    expect(
      body.messages[1]?.content.some(
        (part) =>
          part.type === 'image_url' && part.image_url?.url.startsWith('data:image/png;base64,'),
      ),
    ).toBe(true);
  });

  it('rejects unknown and geometry-bearing selections', async () => {
    const catalog = await verifyQwenSamEvidence();
    expect(() =>
      parseQwenSamSelection(
        {
          selection: 'one',
          candidateId: 'samc_v1_' + '0'.repeat(64),
          semanticRole: 'subject',
          rationale: 'x',
        },
        catalog,
      ),
    ).toThrow('Unknown SAM candidate ID');
    expect(() =>
      parseQwenSamSelection(
        {
          selection: 'none',
          candidateId: null,
          semanticRole: null,
          rationale: 'x',
          bbox: [0, 0, 1, 1],
        },
        catalog,
      ),
    ).toThrow();
  });

  it('rejects extra fields', async () => {
    const c = await verifyQwenSamEvidence();
    expect(() =>
      parseQwenSamSelection(
        { selection: 'none', candidateId: null, semanticRole: null, rationale: 'x', extra: true },
        c,
      ),
    ).toThrow();
  });
  it('rejects duplicate-like malformed IDs', async () => {
    const c = await verifyQwenSamEvidence();
    expect(() =>
      parseQwenSamSelection(
        {
          selection: 'one',
          candidateId: c.candidates[0]!.candidateId + 'x',
          semanticRole: 'subject',
          rationale: 'x',
        },
        c,
      ),
    ).toThrow();
  });
  it('accepts none selection strictly', async () => {
    const c = await verifyQwenSamEvidence();
    expect(
      parseQwenSamSelection(
        { selection: 'none', candidateId: null, semanticRole: null, rationale: 'no subject' },
        c,
      ).selection,
    ).toBe('none');
  });
  it('rejects one without subject role', async () => {
    const c = await verifyQwenSamEvidence();
    expect(() =>
      parseQwenSamSelection(
        {
          selection: 'one',
          candidateId: c.candidates[0]!.candidateId,
          semanticRole: null,
          rationale: 'x',
        },
        c,
      ),
    ).toThrow();
  });
  it('rejects none with candidate', async () => {
    const c = await verifyQwenSamEvidence();
    expect(() =>
      parseQwenSamSelection(
        {
          selection: 'none',
          candidateId: c.candidates[0]!.candidateId,
          semanticRole: null,
          rationale: 'x',
        },
        c,
      ),
    ).toThrow();
  });
  it('keeps candidate order immutable', async () => {
    const c = await verifyQwenSamEvidence();
    expect(c.candidates.map((x) => x.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('pins contact-sheet dimensions', async () => {
    const s = await buildQwenSamContactSheet();
    expect([s.width, s.height]).toEqual([960, 720]);
  });
  it('keeps request secret-free', async () => {
    const c = await verifyQwenSamEvidence();
    const s = await buildQwenSamContactSheet();
    expect(buildQwenSamRequest(c, s)).not.toHaveProperty('secret');
  });
  it('rejects a replaced reservation path before transport', async () => {
    const previousCwd = process.cwd();
    const temporaryCwd = await mkdtemp(join(tmpdir(), 'fabrica-qwen-reservation-'));
    process.chdir(temporaryCwd);
    try {
      const reservation = await reserveQwenSamSelection(`test-${crypto.randomUUID()}`);
      await unlink(reservation.responsePath);
      await symlink(reservation.reportPath, reservation.responsePath);
      await expect(verifyQwenSamReservation(reservation)).rejects.toThrow(
        'Reservation integrity failure',
      );
      await closeQwenSamReservation(reservation);
    } finally {
      process.chdir(previousCwd);
      await rm(temporaryCwd, { recursive: true, force: true });
    }
  });
  it.each([
    ['malformed', '{', 'invalid'],
    ['missing usage', JSON.stringify({ id: 'x' }), 'missing-usage'],
  ])('classifies %s provider responses', async (_name, body, outcome) => {
    const catalog = await verifyQwenSamEvidence();
    expect(() => validateQwenSamProviderResponse(body, catalog)).toThrow(outcome);
  });
  it('executes one successful call and persists only the validated record', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    await inCleanGitRepo(async () => {
      const authorization = createQwenSamAuthorization(
        'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL',
        catalog,
        sheet,
        request.requestBodyText,
      );
      let calls = 0;
      const result = await executeQwenSamSelection({
        authorization,
        catalog,
        sheet,
        request,
        secret: 'sentinel-secret',
        transport: async () => {
          calls += 1;
          return {
            status: 200,
            bodyText: providerBody({
              selection: 'none',
              candidateId: null,
              semanticRole: null,
              rationale: 'no subject',
            }),
          };
        },
      });
      expect(calls).toBe(1);
      expect(result.outcome).toBe('success');
      const report = JSON.parse(
        await (await import('node:fs/promises')).readFile(result.reportPath, 'utf8'),
      ) as Record<string, unknown>;
      expect(report.terminal).toBe('success');
      expect(JSON.stringify(report)).not.toContain('sentinel-secret');
      expect(JSON.stringify(report)).not.toContain('qwen-test');
    });
  });
  it('uses one durable operation id across auth minting and blocks reruns', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    await inCleanGitRepo(async () => {
      const release = 'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL';
      const authA = createQwenSamAuthorization(release, catalog, sheet, request.requestBodyText);
      let firstCalls = 0;
      await executeQwenSamSelection({
        authorization: authA,
        catalog,
        sheet,
        request,
        secret: 'x',
        transport: async () => {
          firstCalls++;
          return {
            status: 200,
            bodyText: providerBody({
              selection: 'none',
              candidateId: null,
              semanticRole: null,
              rationale: 'none',
            }),
          };
        },
      });
      const authB = createQwenSamAuthorization(release, catalog, sheet, request.requestBodyText);
      let secondCalls = 0;
      expect(authB.id).toBe(authA.id);
      await expect(
        executeQwenSamSelection({
          authorization: authB,
          catalog,
          sheet,
          request,
          secret: 'x',
          transport: async () => {
            secondCalls++;
            return { status: 200, bodyText: '{}' };
          },
        }),
      ).rejects.toThrow();
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(0);
    });
  });
  it('rejects forged and release-mismatched authorizations', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    await inCleanGitRepo(async () => {
      expect(() =>
        createQwenSamAuthorization('wrong', catalog, sheet, request.requestBodyText),
      ).toThrow('release phrase');
      const auth = createQwenSamAuthorization(
        'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL',
        catalog,
        sheet,
        request.requestBodyText,
      );
      const forged = { ...auth };
      let calls = 0;
      await expect(
        executeQwenSamSelection({
          authorization: forged,
          catalog,
          sheet,
          request,
          secret: 'x',
          transport: async () => {
            calls++;
            return { status: 200, bodyText: '{}' };
          },
        }),
      ).rejects.toThrow('forged');
      expect(calls).toBe(0);
    });
  });
  it('rejects dirty trees and committed HEAD drift before transport', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    await inCleanGitRepo(async () => {
      const release = 'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL';
      const dirtyAuth = createQwenSamAuthorization(
        release,
        catalog,
        sheet,
        request.requestBodyText,
      );
      await writeFile('dirty.txt', 'dirty');
      expect(() => assertQwenSamAuthorizationLive(dirtyAuth, catalog, sheet, request)).toThrow();
      execFileSync('git', ['clean', '-fd']);
      const driftAuth = createQwenSamAuthorization(
        release,
        catalog,
        sheet,
        request.requestBodyText,
      );
      await writeFile('drift.txt', 'drift');
      execFileSync('git', ['add', 'drift.txt']);
      execFileSync('git', ['commit', '-q', '-m', 'drift']);
      expect(() => assertQwenSamAuthorizationLive(driftAuth, catalog, sheet, request)).toThrow();
    });
  });
  it('classifies terminal transport cases exactly once', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    const cases: Array<
      [string, (body: string) => Promise<{ status: number; bodyText: string }>, string]
    > = [
      ['http-error', async () => ({ status: 500, bodyText: 'secret-body' }), 'http-error'],
      ['invalid', async () => ({ status: 200, bodyText: '{' }), 'invalid'],
      [
        'missing-usage',
        async () => ({ status: 200, bodyText: JSON.stringify({ id: 'x' }) }),
        'missing-usage',
      ],
      [
        'timeout',
        async () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        },
        'timeout',
      ],
      [
        'transport-error',
        async () => {
          throw new Error('network');
        },
        'transport-error',
      ],
    ];
    for (const [, transport, expected] of cases)
      await inCleanGitRepo(async () => {
        const auth = createQwenSamAuthorization(
          'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL',
          catalog,
          sheet,
          request.requestBodyText,
        );
        let calls = 0;
        const result = await executeQwenSamSelection({
          authorization: auth,
          catalog,
          sheet,
          request,
          secret: 'x',
          transport: async () => {
            calls++;
            return transport('');
          },
        });
        expect(calls).toBe(1);
        expect(result.outcome).toBe(expected);
      });
  });
  it('rejects expired authorization before transport', async () => {
    const catalog = await verifyQwenSamEvidence();
    const sheet = await buildQwenSamContactSheet();
    const request = buildQwenSamRequest(catalog, sheet);
    await inCleanGitRepo(async () => {
      const auth = createQwenSamAuthorization(
        'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL',
        catalog,
        sheet,
        request.requestBodyText,
      );
      vi.setSystemTime(new Date('2026-08-17T00:00:00Z'));
      try {
        let calls = 0;
        await expect(
          executeQwenSamSelection({
            authorization: auth,
            catalog,
            sheet,
            request,
            secret: 'x',
            transport: async () => {
              calls++;
              return { status: 200, bodyText: '{}' };
            },
          }),
        ).rejects.toThrow();
        expect(calls).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
