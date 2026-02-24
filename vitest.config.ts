import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      { find: '~test', replacement: resolve(__dirname, './test') },
      // Map test/src → src so relative imports from test/qa/** resolve without a symlink
      { find: /^(\.\.\/)+src\//, replacement: resolve(__dirname, './src') + '/' },
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
