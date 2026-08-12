import {
  constants,
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createQwenFourFixtureLiveAuthorizationPacketV6,
  createQwenManualReleaseBindingV1,
} from './qwen3-vl-scene-analysis-adapter.js';
import { QWEN_V6_EXPIRES_AT, QWEN_V6_ISSUED_AT } from './qwen-v6-authorization.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const relativePath = '.local-data/banner-ai/qwen-four-fixture-live-v6/authorization.json';
const directory = join(root, '.local-data/banner-ai/qwen-four-fixture-live-v6');
const output = join(root, relativePath);

const main = (): void => {
  const env = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' };
  const top = execFileSync('/usr/bin/git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    env,
  }).trim();
  const head = execFileSync('/usr/bin/git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    env,
  }).trim();
  const status = execFileSync(
    '/usr/bin/git',
    ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8', env },
  );
  if (top !== root || status !== '')
    throw new Error('Qwen V6 authoring requires a clean trusted repository.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const directoryStat = lstatSync(directory);
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o777) !== 0o700)
    throw new Error('Unsafe Qwen V6 authorization directory.');
  const issuedAtMs = Date.now();
  const expiresAtMs = Math.min(issuedAtMs + 600_000, Date.parse(QWEN_V6_EXPIRES_AT));
  if (issuedAtMs < Date.parse(QWEN_V6_ISSUED_AT) || expiresAtMs <= issuedAtMs)
    throw new Error('Qwen V6 grant is not operationally fresh.');
  const packet = createQwenFourFixtureLiveAuthorizationPacketV6({
    issuedAtMs,
    expiresAtMs,
    gitSha: head,
    manualRelease: createQwenManualReleaseBindingV1({
      releaseId: `qwen.release.v6.${head.slice(0, 12)}`,
      issuedAtMs,
      expiresAtMs,
    }),
  });
  const bytes = Buffer.from(`${JSON.stringify(packet)}\n`, 'utf8');
  const fd = openSync(
    output,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const parentFd = openSync(directory, 'r');
  try {
    fsyncSync(parentFd);
  } finally {
    closeSync(parentFd);
  }
  if (Buffer.compare(readFileSync(output), bytes) !== 0)
    throw new Error('Qwen V6 authorization reread mismatch.');
  process.stdout.write(`${relativePath}\n`);
};
main();
