import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadClaimsForFile,
  saveClaimsForFile,
  loadAllClaims,
  getClaimById,
  upsertClaims,
  findChangedSections,
  hashContent,
  generateClaimId,
  docFileToStorePath,
  type SemanticClaimFile,
  type SemanticClaimRecord,
} from '../../src/cli/semantic-store';

let tmpDir: string;

function makeClaim(overrides: Partial<SemanticClaimRecord> = {}): SemanticClaimRecord {
  return {
    id: overrides.id ?? generateClaimId('README.md', 'test claim'),
    source_file: 'README.md',
    line_number: 10,
    claim_text: 'The system uses JWT for authentication',
    claim_type: 'behavior',
    keywords: ['jwt', 'authentication'],
    section_content_hash: hashContent('## Auth\nThe system uses JWT'),
    section_heading: 'Auth',
    extracted_at: '2025-01-01T00:00:00.000Z',
    evidence_entities: [],
    evidence_assertions: [],
    last_verification: null,
    ...overrides,
  };
}

function makeClaimFile(overrides: Partial<SemanticClaimFile> = {}): SemanticClaimFile {
  return {
    version: 1,
    source_file: 'README.md',
    last_extracted_at: '2025-01-01T00:00:00.000Z',
    claims: [],
    ...overrides,
  };
}

describe('semantic-store', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-sem-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('docFileToStorePath', () => {
    it('encodes slashes as --', () => {
      const result = docFileToStorePath(tmpDir, 'docs/api.md');
      expect(result).toBe(path.join(tmpDir, '.docalign/semantic/docs--api.md.json'));
    });

    it('handles root-level files', () => {
      const result = docFileToStorePath(tmpDir, 'README.md');
      expect(result).toBe(path.join(tmpDir, '.docalign/semantic/README.md.json'));
    });

    it('handles deeply nested paths', () => {
      const result = docFileToStorePath(tmpDir, 'docs/guides/setup.md');
      expect(result).toBe(path.join(tmpDir, '.docalign/semantic/docs--guides--setup.md.json'));
    });
  });

  describe('hashContent', () => {
    it('returns 16-char hex string', () => {
      const hash = hashContent('hello world');
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is deterministic', () => {
      expect(hashContent('test')).toBe(hashContent('test'));
    });

    it('differs for different content', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
    });
  });

  describe('generateClaimId', () => {
    it('starts with sem-', () => {
      const id = generateClaimId('README.md', 'The system uses JWT');
      expect(id).toMatch(/^sem-[0-9a-f]{16}$/);
    });

    it('is deterministic', () => {
      const a = generateClaimId('README.md', 'claim text');
      const b = generateClaimId('README.md', 'claim text');
      expect(a).toBe(b);
    });

    it('normalizes whitespace', () => {
      const a = generateClaimId('f.md', 'hello  world');
      const b = generateClaimId('f.md', 'hello world');
      expect(a).toBe(b);
    });

    it('normalizes case', () => {
      const a = generateClaimId('f.md', 'Hello World');
      const b = generateClaimId('f.md', 'hello world');
      expect(a).toBe(b);
    });

    it('differs for different files', () => {
      const a = generateClaimId('a.md', 'claim');
      const b = generateClaimId('b.md', 'claim');
      expect(a).not.toBe(b);
    });
  });

  describe('loadClaimsForFile / saveClaimsForFile', () => {
    it('returns null for non-existent file', () => {
      const result = loadClaimsForFile(tmpDir, 'nonexistent.md');
      expect(result).toBeNull();
    });

    it('round-trips save and load', () => {
      const data = makeClaimFile({ claims: [makeClaim()] });
      saveClaimsForFile(tmpDir, 'README.md', data);
      const loaded = loadClaimsForFile(tmpDir, 'README.md');
      expect(loaded).toEqual(data);
    });

    it('creates directory if missing', () => {
      const data = makeClaimFile();
      saveClaimsForFile(tmpDir, 'README.md', data);
      expect(fs.existsSync(path.join(tmpDir, '.docalign/semantic'))).toBe(true);
    });

    it('handles nested doc paths', () => {
      const data = makeClaimFile({ source_file: 'docs/api.md' });
      saveClaimsForFile(tmpDir, 'docs/api.md', data);
      const loaded = loadClaimsForFile(tmpDir, 'docs/api.md');
      expect(loaded).toEqual(data);
    });

    it('returns null for corrupted JSON', () => {
      const dir = path.join(tmpDir, '.docalign/semantic');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'README.md.json'), 'not json');
      const result = loadClaimsForFile(tmpDir, 'README.md');
      expect(result).toBeNull();
    });

    it('returns null for wrong version', () => {
      const dir = path.join(tmpDir, '.docalign/semantic');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'README.md.json'),
        JSON.stringify({ version: 99, claims: [] }),
      );
      const result = loadClaimsForFile(tmpDir, 'README.md');
      expect(result).toBeNull();
    });

    it('atomic write does not leave partial files on success', () => {
      const data = makeClaimFile({ claims: [makeClaim()] });
      saveClaimsForFile(tmpDir, 'README.md', data);
      const storePath = docFileToStorePath(tmpDir, 'README.md');
      expect(fs.existsSync(storePath)).toBe(true);
      expect(fs.existsSync(storePath + '.tmp')).toBe(false);
    });
  });

  describe('loadAllClaims', () => {
    it('returns empty array for no files', () => {
      const result = loadAllClaims(tmpDir);
      expect(result).toEqual([]);
    });

    it('loads all claim files', () => {
      saveClaimsForFile(tmpDir, 'README.md', makeClaimFile({ source_file: 'README.md' }));
      saveClaimsForFile(tmpDir, 'docs/api.md', makeClaimFile({ source_file: 'docs/api.md' }));

      const result = loadAllClaims(tmpDir);
      expect(result).toHaveLength(2);
    });

    it('skips corrupted files', () => {
      saveClaimsForFile(tmpDir, 'README.md', makeClaimFile());
      const dir = path.join(tmpDir, '.docalign/semantic');
      fs.writeFileSync(path.join(dir, 'bad.json'), 'not json');

      const result = loadAllClaims(tmpDir);
      expect(result).toHaveLength(1);
    });
  });

  describe('getClaimById', () => {
    it('finds claim across files', () => {
      const claim = makeClaim({ id: 'sem-findme12345678' });
      saveClaimsForFile(tmpDir, 'README.md', makeClaimFile({ claims: [claim] }));

      const found = getClaimById(tmpDir, 'sem-findme12345678');
      expect(found).toBeTruthy();
      expect(found!.claim_text).toBe(claim.claim_text);
    });

    it('returns null for unknown ID', () => {
      saveClaimsForFile(tmpDir, 'README.md', makeClaimFile({ claims: [makeClaim()] }));
      const found = getClaimById(tmpDir, 'sem-nonexistent0000');
      expect(found).toBeNull();
    });
  });

  describe('upsertClaims', () => {
    it('adds new claims', () => {
      const data = makeClaimFile();
      const newClaims = [makeClaim({ section_heading: 'Auth' })];
      const result = upsertClaims(data, newClaims, ['Auth']);
      expect(result.claims).toHaveLength(1);
    });

    it('replaces claims from re-extracted sections', () => {
      const existing = makeClaim({ id: 'sem-old0000000000000', section_heading: 'Auth', claim_text: 'old' });
      const data = makeClaimFile({ claims: [existing] });
      const updated = makeClaim({ id: 'sem-new0000000000000', section_heading: 'Auth', claim_text: 'new' });
      const result = upsertClaims(data, [updated], ['Auth']);
      expect(result.claims).toHaveLength(1);
      expect(result.claims[0].claim_text).toBe('new');
    });

    it('keeps claims from non-extracted sections', () => {
      const kept = makeClaim({ section_heading: 'Installation' });
      const data = makeClaimFile({ claims: [kept] });
      const newClaim = makeClaim({ id: 'sem-new1234567890ab', section_heading: 'Auth' });
      const result = upsertClaims(data, [newClaim], ['Auth']);
      expect(result.claims).toHaveLength(2);
    });

    it('is case-insensitive for section heading matching', () => {
      const existing = makeClaim({ section_heading: 'AUTH' });
      const data = makeClaimFile({ claims: [existing] });
      const result = upsertClaims(data, [], ['auth']);
      // The existing claim from AUTH section should be removed (section was re-extracted with 0 claims)
      expect(result.claims).toHaveLength(0);
    });

    it('updates last_extracted_at', () => {
      const data = makeClaimFile({ last_extracted_at: '2020-01-01T00:00:00.000Z' });
      const result = upsertClaims(data, [], []);
      expect(result.last_extracted_at).not.toBe('2020-01-01T00:00:00.000Z');
    });
  });

  describe('findChangedSections', () => {
    it('returns all sections when no prior data', () => {
      const sections = [
        { heading: 'Auth', contentHash: 'abc123' },
        { heading: 'Setup', contentHash: 'def456' },
      ];
      const changed = findChangedSections(null, sections);
      expect(changed).toEqual(['Auth', 'Setup']);
    });

    it('returns empty when nothing changed', () => {
      const hash = hashContent('## Auth\nContent here');
      const claim = makeClaim({
        section_heading: 'Auth',
        section_content_hash: hash,
      });
      const data = makeClaimFile({ claims: [claim] });
      const sections = [{ heading: 'Auth', contentHash: hash }];
      const changed = findChangedSections(data, sections);
      expect(changed).toEqual([]);
    });

    it('detects changed sections', () => {
      const claim = makeClaim({
        section_heading: 'Auth',
        section_content_hash: 'oldhash123456789',
      });
      const data = makeClaimFile({ claims: [claim] });
      const sections = [{ heading: 'Auth', contentHash: 'newhash987654321' }];
      const changed = findChangedSections(data, sections);
      expect(changed).toEqual(['Auth']);
    });

    it('detects new sections not in stored data', () => {
      const data = makeClaimFile({ claims: [] });
      const sections = [{ heading: 'New Section', contentHash: 'abc' }];
      const changed = findChangedSections(data, sections);
      expect(changed).toEqual(['New Section']);
    });

    it('is case-insensitive for section heading comparison', () => {
      const hash = 'samehash12345678';
      const claim = makeClaim({
        section_heading: 'AUTH',
        section_content_hash: hash,
      });
      const data = makeClaimFile({ claims: [claim] });
      const sections = [{ heading: 'auth', contentHash: hash }];
      const changed = findChangedSections(data, sections);
      expect(changed).toEqual([]);
    });
  });
});
