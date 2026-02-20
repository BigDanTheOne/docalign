import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '~test': resolve(__dirname, './test'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.openclaw/**',
      '_team/**',
    ],
  },
});
