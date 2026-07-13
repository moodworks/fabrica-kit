import { defineConfig } from 'vitest/config';

const commonTestConfig = {
  clearMocks: true,
  environment: 'node',
  isolate: true,
  mockReset: true,
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...commonTestConfig,
          name: 'unit',
          include: [
            'apps/web/**/*.{test,spec}.{ts,tsx}',
            'packages/*/**/*.{test,spec}.ts',
            'tooling/**/*.{test,spec}.ts',
          ],
          exclude: ['**/node_modules/**', '**/*.{integration,e2e}.{test,spec}.{ts,tsx}'],
          testTimeout: 10_000,
        },
      },
      {
        test: {
          ...commonTestConfig,
          name: 'integration',
          include: [
            'apps/web/**/*.integration.{test,spec}.{ts,tsx}',
            'packages/*/**/*.integration.{test,spec}.ts',
          ],
          exclude: ['**/node_modules/**'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
