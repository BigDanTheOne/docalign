import { describe, it, expect } from 'vitest';
import type { PreProcessedDoc } from '../../../src/shared/types';
import {
  extractEnvironmentClaims,
  extractConventionClaims,
  deduplicateWithinFile,
  getIdentityKey,
  generateKeywords,
} from '../../../src/layers/L1-claim-extractor/extractors';

function makeDoc(content: string): PreProcessedDoc {
  const lines = content.split('\n');
  return {
    cleaned_content: content,
    original_line_map: lines.map((_, i) => i + 1),
    format: 'markdown',
    file_size_bytes: content.length,
    code_fence_lines: new Set<number>(),
  };
}

// === Environment Claims: Runtime Versions ===
describe('extractEnvironmentClaims — runtime versions', () => {
  it('extracts "Requires Node.js 18+"', () => {
    const doc = makeDoc('Requires Node.js 18+');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].claim_type).toBe('environment');
    expect(results[0].extracted_value.runtime).toBe('Node.js');
    expect(results[0].extracted_value.version).toBe('18+');
  });

  it('extracts "Python 3.11 required"', () => {
    const doc = makeDoc('Python 3.11 is required for this project');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].extracted_value.runtime).toBe('Python');
    expect(results[0].extracted_value.version).toBe('3.11');
  });

  it('extracts "Node.js version >= 20.0.0"', () => {
    const doc = makeDoc('Node.js version >= 20.0.0');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].extracted_value.runtime).toBe('Node.js');
    expect(results[0].extracted_value.version).toBe('20.0.0');
  });

  it('extracts "Deno 1.40" runtime', () => {
    const doc = makeDoc('Built on Deno 1.40');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].extracted_value.runtime).toBe('Deno');
    expect(results[0].extracted_value.version).toBe('1.40');
  });

  it('extracts "Bun 1.0.0" runtime', () => {
    const doc = makeDoc('Uses Bun 1.0.0 as runtime');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].extracted_value.runtime).toBe('Bun');
    expect(results[0].extracted_value.version).toBe('1.0.0');
  });

  it('extracts multiple runtimes from separate lines', () => {
    const doc = makeDoc('Requires Node.js 18+\nPython 3.11 for scripts');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(2);
  });

  it('handles "Nodejs" variant (no dot)', () => {
    const doc = makeDoc('Nodejs 20.11.0 is needed');
    const results = extractEnvironmentClaims(doc);
    expect(results.length).toBe(1);
    expect(results[0].extracted_value.runtime).toBe('Nodejs');
    expect(results[0].extracted_value.version).toBe('20.11.0');
  });
});

// === Environment Claims: Env Vars ===
describe('extractEnvironmentClaims — environment variables', () => {
  it('extracts "Set DATABASE_URL to configure the database"', () => {
    const doc = makeDoc('Set DATABASE_URL to configure the database');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(1);
    expect(envVarClaims[0].extracted_value.env_var).toBe('DATABASE_URL');
  });

  it('extracts "configure REDIS_URL"', () => {
    const doc = makeDoc('You need to configure REDIS_URL in your environment');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(1);
    expect(envVarClaims[0].extracted_value.env_var).toBe('REDIS_URL');
  });

  it('extracts "export SECRET_KEY=..."', () => {
    const doc = makeDoc('export SECRET_KEY=your-secret-key');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(1);
    expect(envVarClaims[0].extracted_value.env_var).toBe('SECRET_KEY');
  });

  it('extracts "API_TOKEN is required"', () => {
    const doc = makeDoc('API_TOKEN is required for authentication');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(1);
    expect(envVarClaims[0].extracted_value.env_var).toBe('API_TOKEN');
  });

  it('extracts env var with "environment variable" context', () => {
    const doc = makeDoc('The environment variable STRIPE_KEY must be configured');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBeGreaterThanOrEqual(1);
    expect(envVarClaims.some((c) => c.extracted_value.env_var === 'STRIPE_KEY')).toBe(true);
  });

  it('filters out common false positives (API, URL, HTTP)', () => {
    const doc = makeDoc('Set API to use HTTP for URL requests');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(0);
  });

  it('filters out short env var names (< 3 chars)', () => {
    const doc = makeDoc('Set AB to value');
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(0);
  });

  it('extracts multiple env vars from different lines', () => {
    const doc = makeDoc(
      'Set DATABASE_URL to configure the database\n' +
      'Define REDIS_URL for caching\n' +
      'export AUTH_SECRET=your-secret',
    );
    const results = extractEnvironmentClaims(doc);
    const envVarClaims = results.filter((r) => r.extracted_value.env_var);
    const vars = envVarClaims.map((c) => c.extracted_value.env_var);
    expect(vars).toContain('DATABASE_URL');
    expect(vars).toContain('REDIS_URL');
    expect(vars).toContain('AUTH_SECRET');
  });
});

// === Convention Claims: Strict Mode ===
describe('extractConventionClaims — strict mode', () => {
  it('extracts "TypeScript strict mode"', () => {
    const doc = makeDoc('TypeScript strict mode is enabled');
    const results = extractConventionClaims(doc);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const strictClaims = results.filter((r) => r.extracted_value.convention === 'strict_mode');
    expect(strictClaims.length).toBe(1);
    expect(strictClaims[0].pattern_name).toBe('strict_mode_convention');
  });

  it('extracts "strict: true"', () => {
    const doc = makeDoc('The project uses strict: true for TypeScript');
    const results = extractConventionClaims(doc);
    const strictClaims = results.filter((r) => r.extracted_value.convention === 'strict_mode');
    expect(strictClaims.length).toBe(1);
  });

  it('extracts "strict typescript"', () => {
    const doc = makeDoc('We use strict TypeScript throughout');
    const results = extractConventionClaims(doc);
    const strictClaims = results.filter((r) => r.extracted_value.convention === 'strict_mode');
    expect(strictClaims.length).toBe(1);
  });

  it('does not match unrelated "strict" mentions', () => {
    const doc = makeDoc('We have strict coding guidelines');
    const results = extractConventionClaims(doc);
    const strictClaims = results.filter((r) => r.extracted_value.convention === 'strict_mode');
    expect(strictClaims.length).toBe(0);
  });
});

// === Convention Claims: Framework Usage ===
describe('extractConventionClaims — framework', () => {
  it('extracts "Built with Express"', () => {
    const doc = makeDoc('Built with Express');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(1);
    expect(fwClaims[0].extracted_value.framework).toBe('Express');
  });

  it('extracts "Uses React" (case-insensitive framework match)', () => {
    const doc = makeDoc('Uses React for the frontend');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(1);
    expect(fwClaims[0].extracted_value.framework).toBe('React');
  });

  it('extracts "Powered by Next.js"', () => {
    const doc = makeDoc('Powered by Next.js');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(1);
  });

  it('extracts "Based on Django"', () => {
    const doc = makeDoc('Based on Django');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(1);
    expect(fwClaims[0].extracted_value.framework).toBe('Django');
  });

  it('ignores unknown frameworks', () => {
    const doc = makeDoc('Built with MyCustomLib');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(0);
  });

  it('extracts multiple frameworks from separate lines', () => {
    const doc = makeDoc('Built with Express\nUses React for UI\nPowered by Redis');
    const results = extractConventionClaims(doc);
    const fwClaims = results.filter((r) => r.extracted_value.framework);
    expect(fwClaims.length).toBe(3);
  });
});

// === Deduplication ===
describe('deduplication for environment/convention claims', () => {
  it('deduplicates environment runtime claims by runtime name', () => {
    const doc = makeDoc('Requires Node.js 18+\nNode.js 18 or later');
    const results = extractEnvironmentClaims(doc);
    const deduped = deduplicateWithinFile(results);
    const runtimeClaims = deduped.filter((r) => r.extracted_value.runtime);
    // Both mention Node.js → deduplicated to 1
    expect(runtimeClaims.length).toBe(1);
  });

  it('deduplicates environment env var claims by var name', () => {
    const doc = makeDoc('Set DATABASE_URL to configure\nDefine DATABASE_URL as your connection string');
    const results = extractEnvironmentClaims(doc);
    const deduped = deduplicateWithinFile(results);
    const envVarClaims = deduped.filter((r) => r.extracted_value.env_var);
    expect(envVarClaims.length).toBe(1);
  });

  it('deduplicates convention claims by convention type', () => {
    const doc = makeDoc('TypeScript strict mode\nstrict: true is enabled');
    const results = extractConventionClaims(doc);
    const deduped = deduplicateWithinFile(results);
    const strictClaims = deduped.filter((r) => r.extracted_value.convention === 'strict_mode');
    expect(strictClaims.length).toBe(1);
  });

  it('keeps different runtimes separate', () => {
    const doc = makeDoc('Requires Node.js 18+\nPython 3.11 for scripts');
    const results = extractEnvironmentClaims(doc);
    const deduped = deduplicateWithinFile(results);
    const runtimeClaims = deduped.filter((r) => r.extracted_value.runtime);
    expect(runtimeClaims.length).toBe(2);
  });
});

// === Identity Keys ===
describe('getIdentityKey for new types', () => {
  it('generates env:var:KEY for environment var claims', () => {
    const extraction = {
      claim_text: 'Set DATABASE_URL',
      claim_type: 'environment' as const,
      extracted_value: { type: 'environment', env_var: 'DATABASE_URL' },
      line_number: 1,
      pattern_name: 'env_var_set_instruction',
    };
    expect(getIdentityKey(extraction)).toBe('env:var:DATABASE_URL');
  });

  it('generates env:runtime:Node.js for runtime claims', () => {
    const extraction = {
      claim_text: 'Requires Node.js 18',
      claim_type: 'environment' as const,
      extracted_value: { type: 'environment', runtime: 'Node.js', version: '18' },
      line_number: 1,
      pattern_name: 'runtime_requirement',
    };
    expect(getIdentityKey(extraction)).toBe('env:runtime:Node.js');
  });

  it('generates conv:strict_mode for strict mode claims', () => {
    const extraction = {
      claim_text: 'TypeScript strict mode',
      claim_type: 'convention' as const,
      extracted_value: { type: 'convention', convention: 'strict_mode' },
      line_number: 1,
      pattern_name: 'strict_mode_convention',
    };
    expect(getIdentityKey(extraction)).toBe('conv:strict_mode');
  });

  it('generates conv:fw:express for framework claims', () => {
    const extraction = {
      claim_text: 'Built with Express',
      claim_type: 'convention' as const,
      extracted_value: { type: 'convention', framework: 'Express' },
      line_number: 1,
      pattern_name: 'framework_convention',
    };
    expect(getIdentityKey(extraction)).toBe('conv:fw:express');
  });
});

// === Keyword Generation ===
describe('generateKeywords for new types', () => {
  it('generates keywords for environment runtime claims', () => {
    const extraction = {
      claim_text: 'Requires Node.js 18+',
      claim_type: 'environment' as const,
      extracted_value: { type: 'environment', runtime: 'Node.js', version: '18+' },
      line_number: 1,
      pattern_name: 'runtime_requirement',
    };
    const keywords = generateKeywords(extraction);
    expect(keywords).toContain('Node.js');
    expect(keywords).toContain('18+');
  });

  it('generates keywords for environment env var claims', () => {
    const extraction = {
      claim_text: 'Set DATABASE_URL',
      claim_type: 'environment' as const,
      extracted_value: { type: 'environment', env_var: 'DATABASE_URL' },
      line_number: 1,
      pattern_name: 'env_var_set_instruction',
    };
    const keywords = generateKeywords(extraction);
    expect(keywords).toContain('DATABASE_URL');
  });

  it('generates keywords for convention framework claims', () => {
    const extraction = {
      claim_text: 'Built with Express',
      claim_type: 'convention' as const,
      extracted_value: { type: 'convention', framework: 'Express' },
      line_number: 1,
      pattern_name: 'framework_convention',
    };
    const keywords = generateKeywords(extraction);
    expect(keywords).toContain('Express');
  });
});
