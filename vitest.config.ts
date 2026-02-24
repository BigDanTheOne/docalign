import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '~test', replacement: resolve(__dirname, './test') },
      // QA tests under test/qa/<topic>/ use ../../../../src/ (4+ levels deep).
      // From depth 4, relative ../../../.. overshoots the repo root.
      // This alias rewrites those deep relative imports to the absolute src/ path.
      // Required because QA test files are auto-generated and cannot be modified.
      { find: /^(\.\.\/){4,}src\//, replacement: resolve(__dirname, 'src') + '/' },
    ],
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
