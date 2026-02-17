import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.openclaw/**',
    ],
  },
});
