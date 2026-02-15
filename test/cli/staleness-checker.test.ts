import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkClaimStaleness, verifyWithEvidence } from '../../src/cli/staleness-checker';
import { hashContent, type SemanticClaimRecord } from '../../src/cli/semantic-store';
import type { CodebaseIndexService } from '../../src/layers/L0-codebase-index';
import type { CodeEntity } from '../../src/shared/types';

let tmpDir: string;

function makeEntity(overrides: Partial<CodeEntity> = {}): CodeEntity {
  return {
    id: 'entity-1',
    repo_id: 'local',
    file_path: 'src/auth.ts',
    line_number: 1,
    end_line_number: 5,
    entity_type: 'function',
    name: 'authenticate',
    signature: 'function authenticate()',
    embedding: null,
    raw_code: 'function authenticate() { return true; }',
    last_commit_sha: '',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeMockIndex(entities: CodeEntity[] = []): CodebaseIndexService {
  return {
    fileExists: async () => false,
    getFileTree: async () => [],
    findSymbol: async (_repoId: string, name: string) => {
      return entities.filter((e) => e.name === name);
    },
    getEntityByFile: async () => [],
    getEntityById: async () => null,
    findRoute: async () => null,
    searchRoutes: async () => [],
    getDependencyVersion: async () => null,
    scriptExists: async () => false,
    getAvailableScripts: async () => [],
    searchSemantic: async () => [],
    updateFromDiff: async () => ({
      entities_added: 0,
      entities_updated: 0,
      entities_removed: 0,
      files_skipped: [],
    }),
    readFileContent: async () => null,
    getManifestMetadata: async () => null,
    getHeadings: async () => [],
  };
}

function makeClaim(overrides: Partial<SemanticClaimRecord> = {}): SemanticClaimRecord {
  return {
    id: 'sem-test000000000000',
    source_file: 'README.md',
    line_number: 10,
    claim_text: 'Uses JWT for auth',
    claim_type: 'behavior',
    keywords: ['jwt'],
    section_content_hash: 'abc123',
    section_heading: 'Auth',
    extracted_at: '2025-01-01T00:00:00.000Z',
    evidence_entities: [],
    evidence_assertions: [],
    last_verification: {
      verdict: 'verified',
      confidence: 0.9,
      reasoning: 'JWT found in auth module',
      verified_at: '2025-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('staleness-checker', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-stale-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns stale when no cached verification', async () => {
    const claim = makeClaim({ last_verification: null });
    const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
    expect(result).toBe('stale');
  });

  it('returns fresh when no evidence (nothing to invalidate)', async () => {
    const claim = makeClaim({
      evidence_entities: [],
      evidence_assertions: [],
    });
    const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
    expect(result).toBe('fresh');
  });

  describe('entity checks', () => {
    it('returns fresh when entity hash matches', async () => {
      // Create source file
      const code = 'function authenticate() {\n  return true;\n}\nextra line\nmore';
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/auth.ts'), code);

      const entityContent = 'function authenticate() {\n  return true;\n}\nextra line\nmore';
      const contentHash = hashContent(entityContent);

      const entity = makeEntity({
        file_path: 'src/auth.ts',
        line_number: 1,
        end_line_number: 5,
      });

      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'authenticate',
          file: 'src/auth.ts',
          content_hash: contentHash,
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex([entity]), tmpDir);
      expect(result).toBe('fresh');
    });

    it('returns stale when entity hash differs', async () => {
      const code = 'function authenticate() {\n  return false;\n}';
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/auth.ts'), code);

      const entity = makeEntity({
        file_path: 'src/auth.ts',
        line_number: 1,
        end_line_number: 3,
      });

      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'authenticate',
          file: 'src/auth.ts',
          content_hash: 'oldhash1234567890',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex([entity]), tmpDir);
      expect(result).toBe('stale');
    });

    it('returns stale when entity deleted (not found)', async () => {
      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'authenticate',
          file: 'src/auth.ts',
          content_hash: 'abc',
        }],
      });

      // Empty index — no entities
      const result = await checkClaimStaleness(claim, makeMockIndex([]), tmpDir);
      expect(result).toBe('stale');
    });

    it('returns stale when entity moved to different file', async () => {
      const entity = makeEntity({ file_path: 'src/new-auth.ts' });

      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'authenticate',
          file: 'src/auth.ts', // Expected in old file
          content_hash: 'abc',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex([entity]), tmpDir);
      expect(result).toBe('stale');
    });
  });

  describe('assertion checks', () => {
    it('returns fresh when exists-assertion passes', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'import jwt from "jsonwebtoken";');

      const claim = makeClaim({
        evidence_assertions: [{
          pattern: 'import.*jwt',
          scope: 'src/*.ts',
          expect: 'exists',
          description: 'JWT import exists',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
      expect(result).toBe('fresh');
    });

    it('returns stale when exists-assertion fails', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'console.log("hello")');

      const claim = makeClaim({
        evidence_assertions: [{
          pattern: 'import.*jwt',
          scope: 'src/*.ts',
          expect: 'exists',
          description: 'JWT import should exist',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
      expect(result).toBe('stale');
    });

    it('returns fresh when absent-assertion passes', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'console.log("hello")');

      const claim = makeClaim({
        evidence_assertions: [{
          pattern: 'eval\\(',
          scope: 'src/*.ts',
          expect: 'absent',
          description: 'No eval calls',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
      expect(result).toBe('fresh');
    });

    it('returns stale when absent-assertion finds match', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'eval("bad code")');

      const claim = makeClaim({
        evidence_assertions: [{
          pattern: 'eval\\(',
          scope: 'src/*.ts',
          expect: 'absent',
          description: 'No eval calls',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex(), tmpDir);
      expect(result).toBe('stale');
    });
  });

  describe('mixed entities + assertions', () => {
    it('returns stale if any entity fails even if assertions pass', async () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'import jwt from "jsonwebtoken";');

      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'deletedFunction',
          file: 'src/auth.ts',
          content_hash: 'abc',
        }],
        evidence_assertions: [{
          pattern: 'import.*jwt',
          scope: 'src/*.ts',
          expect: 'exists',
          description: 'JWT import exists',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex([]), tmpDir);
      expect(result).toBe('stale');
    });

    it('returns stale if any assertion fails even if entities pass', async () => {
      const code = 'function authenticate() {\n  return true;\n}';
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src/auth.ts'), code);

      const contentHash = hashContent(code);
      const entity = makeEntity({
        file_path: 'src/auth.ts',
        line_number: 1,
        end_line_number: 3,
      });

      const claim = makeClaim({
        evidence_entities: [{
          symbol: 'authenticate',
          file: 'src/auth.ts',
          content_hash: contentHash,
        }],
        evidence_assertions: [{
          pattern: 'nonexistent_pattern_xyz',
          scope: 'src/*.ts',
          expect: 'exists',
          description: 'Should exist but does not',
        }],
      });

      const result = await checkClaimStaleness(claim, makeMockIndex([entity]), tmpDir);
      expect(result).toBe('stale');
    });
  });
});

describe('verifyWithEvidence', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-verify-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns uncertain when no evidence', async () => {
    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [],
      evidence_assertions: [],
    });
    const result = await verifyWithEvidence(claim, makeMockIndex(), tmpDir);
    expect(result.verification.verdict).toBe('uncertain');
    expect(result.details).toHaveLength(0);
  });

  it('returns verified when all assertions pass', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'import jwt from "jsonwebtoken";');

    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [],
      evidence_assertions: [{
        pattern: 'import.*jwt',
        scope: 'src/*.ts',
        expect: 'exists',
        description: 'JWT import exists',
      }],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex(), tmpDir);
    expect(result.verification.verdict).toBe('verified');
    expect(result.details).toHaveLength(1);
    expect(result.details[0].passed).toBe(true);
  });

  it('returns drifted when assertion fails', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'console.log("no jwt")');

    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [],
      evidence_assertions: [{
        pattern: 'import.*jwt',
        scope: 'src/*.ts',
        expect: 'exists',
        description: 'JWT import should exist',
      }],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex(), tmpDir);
    expect(result.verification.verdict).toBe('drifted');
    expect(result.verification.reasoning).toContain('not found');
    expect(result.details[0].passed).toBe(false);
  });

  it('returns verified when entity exists and computes content hash', async () => {
    const code = 'function authenticate() {\n  return true;\n}';
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/auth.ts'), code);

    const entity = makeEntity({
      file_path: 'src/auth.ts',
      line_number: 1,
      end_line_number: 3,
    });

    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [{
        symbol: 'authenticate',
        file: 'src/auth.ts',
        content_hash: '',
      }],
      evidence_assertions: [],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex([entity]), tmpDir);
    expect(result.verification.verdict).toBe('verified');
    expect(result.entityContentHashes.get('authenticate:src/auth.ts')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns drifted when entity is missing', async () => {
    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [{
        symbol: 'deletedFunc',
        file: 'src/auth.ts',
        content_hash: '',
      }],
      evidence_assertions: [],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex([]), tmpDir);
    expect(result.verification.verdict).toBe('drifted');
    expect(result.verification.reasoning).toContain('deletedFunc');
  });

  it('handles mixed passing and failing checks', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'import jwt from "jsonwebtoken";');

    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [{
        symbol: 'missingFunc',
        file: 'src/auth.ts',
        content_hash: '',
      }],
      evidence_assertions: [{
        pattern: 'import.*jwt',
        scope: 'src/*.ts',
        expect: 'exists',
        description: 'JWT import exists',
      }],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex([]), tmpDir);
    expect(result.verification.verdict).toBe('drifted');
    expect(result.details).toHaveLength(2);
    // Entity failed, assertion passed
    expect(result.details[0].passed).toBe(false);
    expect(result.details[1].passed).toBe(true);
  });

  it('confidence scales with check count', async () => {
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src/app.ts'), 'import jwt from "jsonwebtoken";\nconst x = 3;');

    const claim = makeClaim({
      last_verification: null,
      evidence_entities: [],
      evidence_assertions: [
        { pattern: 'import.*jwt', scope: 'src/*.ts', expect: 'exists', description: 'JWT' },
        { pattern: 'const x = 3', scope: 'src/*.ts', expect: 'exists', description: 'x=3' },
      ],
    });

    const result = await verifyWithEvidence(claim, makeMockIndex(), tmpDir);
    expect(result.verification.verdict).toBe('verified');
    expect(result.verification.confidence).toBeGreaterThan(0.9);
  });
});
