import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 300_000,
    fileParallelism: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.openclaw/**',
      '_team/**',
    ],
  },
});
