import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.ts',
        '*.config.js',
        '*.config.mjs',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 60,
        functions: 62,
        branches: 51,
        statements: 60,
      },
      // Per-directory thresholds
      // Note: Vitest doesn't support per-directory thresholds directly,
      // but we can use coverage reports to verify
    },
    // Use fake timers for deterministic tests
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      // Ensure proper module resolution
    },
  },
});
