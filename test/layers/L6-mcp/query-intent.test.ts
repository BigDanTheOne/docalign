import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../../../src/layers/L6-mcp/query-intent';

describe('classifyIntent', () => {
  it('classifies "API endpoints" to api_route', () => {
    const types = classifyIntent('API endpoints');
    expect(types).toContain('api_route');
  });

  it('classifies "deployment" to command', () => {
    const types = classifyIntent('deploy instructions');
    expect(types).toContain('command');
  });

  it('classifies "install setup" to command', () => {
    const types = classifyIntent('install setup');
    expect(types).toContain('command');
  });

  it('classifies "configuration" to config and environment', () => {
    const types = classifyIntent('configuration variables');
    expect(types).toContain('config');
    expect(types).toContain('environment');
  });

  it('classifies "version package" to dependency_version', () => {
    const types = classifyIntent('version package');
    expect(types).toContain('dependency_version');
  });

  it('classifies "file path" to path_reference', () => {
    const types = classifyIntent('file path');
    expect(types).toContain('path_reference');
  });

  it('classifies "code example import" to code_example', () => {
    const types = classifyIntent('code example import');
    expect(types).toContain('code_example');
  });

  it('returns empty array for unknown terms', () => {
    const types = classifyIntent('foobar baz quux');
    expect(types).toEqual([]);
  });

  it('is case-insensitive', () => {
    const types = classifyIntent('API ENDPOINT');
    expect(types).toContain('api_route');
  });

  it('handles single-character tokens (skipped)', () => {
    const types = classifyIntent('a b c');
    expect(types).toEqual([]);
  });

  it('combines multiple intents from different keywords', () => {
    const types = classifyIntent('API config example');
    expect(types).toContain('api_route');
    expect(types).toContain('config');
    expect(types).toContain('environment');
    expect(types).toContain('code_example');
  });

  it('deduplicates claim types', () => {
    // "install" and "build" both map to "command"
    const types = classifyIntent('install build');
    const commandCount = types.filter((t) => t === 'command').length;
    expect(commandCount).toBe(1);
  });

  it('classifies architecture and design', () => {
    const types = classifyIntent('architecture design');
    expect(types).toContain('architecture');
  });

  it('classifies convention and pattern', () => {
    const types = classifyIntent('convention naming');
    expect(types).toContain('convention');
  });
});
