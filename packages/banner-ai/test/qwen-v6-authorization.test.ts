import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  QWEN_V6_GRANT_DIGEST,
  QWEN_V6_FIXTURE_BINDING_DIGEST,
  QWEN_V6_OWNER_GRANT_PROJECTION,
  QwenV6GrantSchema,
  createQwenV6TestReservationRoot,
  reserveQwenV6ExecutionForTest,
  verifyQwenV6Reservation,
  finalizeQwenV6Reservation,
} from '../src/server/qwen-v6-authorization.js';
import { QWEN_V6_AUTHORIZATION_ID } from '../src/server/qwen-v6-authorization.js';
import {
  QwenBenchmarkAuthorizationPacketV6Schema,
  createQwenFourFixtureLiveAuthorizationPacketV6,
  createQwenManualReleaseBindingV1,
  mintQwenBenchmarkExecutionAuthorization,
} from '../src/server/qwen3-vl-scene-analysis-adapter.js';

const packetNow = Date.parse('2026-08-12T08:32:00.000Z');
const packetSha = '0123456789012345678901234567890123456789';
const packetRelease = (issuedAtMs = packetNow, expiresAtMs = packetNow + 600_000) =>
  createQwenManualReleaseBindingV1({
    releaseId: 'qwen.release.v6.regression.0001',
    issuedAtMs,
    expiresAtMs,
  });

describe('Qwen V6 authorization grant and durable store', () => {
  it('strictly binds packet fields, grant window, release coverage, and generic mint rejection', () => {
    const packet = createQwenFourFixtureLiveAuthorizationPacketV6({
      issuedAtMs: packetNow,
      expiresAtMs: packetNow + 600_000,
      gitSha: packetSha,
      manualRelease: packetRelease(),
    });
    expect(QwenBenchmarkAuthorizationPacketV6Schema.parse(packet).authorizationVersion).toBe(6);
    expect(() =>
      QwenBenchmarkAuthorizationPacketV6Schema.parse({ ...packet, unknown: true }),
    ).toThrow();
    expect(() =>
      QwenBenchmarkAuthorizationPacketV6Schema.parse({ ...packet, grantDigest: '0'.repeat(64) }),
    ).toThrow();
    expect(() =>
      QwenBenchmarkAuthorizationPacketV6Schema.parse({
        ...packet,
        requestedModelId: 'wrong-model',
      }),
    ).toThrow();
    expect(() =>
      QwenBenchmarkAuthorizationPacketV6Schema.parse({
        ...packet,
        endpoint: 'https://wrong.invalid',
      }),
    ).toThrow();
    expect(() =>
      QwenBenchmarkAuthorizationPacketV6Schema.parse({
        ...packet,
        orderedFixtureBindingDigest: '0'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      createQwenFourFixtureLiveAuthorizationPacketV6({
        issuedAtMs: packetNow,
        expiresAtMs: packetNow + 600_000,
        gitSha: packetSha,
        manualRelease: packetRelease(packetNow + 1, packetNow + 600_000),
      }),
    ).toThrow();
    expect(() =>
      createQwenFourFixtureLiveAuthorizationPacketV6({
        issuedAtMs: packetNow,
        expiresAtMs: packetNow + 600_000,
        gitSha: packetSha,
        manualRelease: packetRelease(packetNow, packetNow + 599_999),
      }),
    ).toThrow();
    expect(() => mintQwenBenchmarkExecutionAuthorization(packet)).toThrow();
  });

  it('is closed and digest-bound', () => {
    expect(QwenV6GrantSchema.parse(QWEN_V6_OWNER_GRANT_PROJECTION).grantId).toBe(
      QWEN_V6_OWNER_GRANT_PROJECTION.grantId,
    );
    expect(QWEN_V6_GRANT_DIGEST).toMatch(/^[0-9a-f]{64}$/u);
    expect(QWEN_V6_FIXTURE_BINDING_DIGEST).toMatch(/^[0-9a-f]{64}$/u);
    expect(QWEN_V6_AUTHORIZATION_ID).toBe('qwen.v6.owner-grant.single-use-20260812');
    expect(() =>
      QwenV6GrantSchema.parse({ ...QWEN_V6_OWNER_GRANT_PROJECTION, unknown: true }),
    ).toThrow();
  });

  it('reserves exclusive claim/report and rejects arbitrary finalization bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qwen-v6-'));
    const directory = join(root, '.local-data/banner-ai/qwen-four-fixture-live-v6');
    mkdirSync(directory, { recursive: true });
    chmodSync(directory, 0o700);
    const reservation = reserveQwenV6ExecutionForTest({
      testRoot: createQwenV6TestReservationRoot(root),
      gitSha: '0123456789012345678901234567890123456789',
      manualRelease: 'a'.repeat(64),
      grantDigest: QWEN_V6_GRANT_DIGEST,
    });
    verifyQwenV6Reservation(reservation);
    expect(statSync(reservation.claimPath).mode & 0o777).toBe(0o600);
    expect(statSync(reservation.reportPath).mode & 0o777).toBe(0o600);
    await expect(
      finalizeQwenV6Reservation(reservation, Buffer.from('{"authorizationVersion":6}')),
    ).rejects.toThrow();
    expect(readFileSync(reservation.reportPath).byteLength).toBe(0);
    expect(() =>
      reserveQwenV6ExecutionForTest({
        testRoot: createQwenV6TestReservationRoot(root),
        gitSha: '0123456789012345678901234567890123456789',
        manualRelease: 'a'.repeat(64),
        grantDigest: QWEN_V6_GRANT_DIGEST,
      }),
    ).toThrow();
    rmSync(root, { recursive: true, force: true });
  });
});
