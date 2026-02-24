import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import type { Plugin } from 'vite';

/**
 * Vite plugin that fixes relative imports that resolve above the project root.
 * Some QA tests use relative paths calibrated for a different directory depth;
 * this plugin rewrites resolved IDs that land in the parent worktree directory
 * back into the correct project-root-relative location.
 */
function fixWorktreeImports(): Plugin {
  const projectRoot = resolve(__dirname);
  const parentDir = resolve(__dirname, '..');
  return {
    name: 'fix-worktree-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const resolved = resolve(importer, '..', source);
      // If a relative import escapes the project root into the parent dir,
      // remap it back into the project root's src/
      if (resolved.startsWith(parentDir + '/src/') && !resolved.startsWith(projectRoot + '/')) {
        const suffix = resolved.slice(parentDir.length);
        return resolve(projectRoot, '.' + suffix);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [fixWorktreeImports()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '~test': resolve(__dirname, './test'),
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
