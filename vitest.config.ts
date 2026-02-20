import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '~test': resolve(__dirname, './test'),
      // QA tests at test/qa/<suite>/ use ../../../../src which is off-by-one;
      // alias to correct the resolution without modifying QA test files.
      '../../../../src': resolve(__dirname, './src'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    fileParallelism: false,
    clearMocks: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.openclaw/**',
      '_team/**',
    ],
  },
});
