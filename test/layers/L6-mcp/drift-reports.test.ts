import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadReports, appendReport, updateReportStatus } from '../../../src/layers/L6-mcp/drift-reports';

describe('drift-reports', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docalign-reports-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadReports', () => {
    it('returns empty array for missing file', () => {
      const reports = loadReports(tmpDir);
      expect(reports).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      const dir = path.join(tmpDir, '.docalign');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'reports.json'), 'not json');
      const reports = loadReports(tmpDir);
      expect(reports).toEqual([]);
    });

    it('returns reports from valid file', () => {
      const dir = path.join(tmpDir, '.docalign');
      fs.mkdirSync(dir, { recursive: true });
      const data = [{ id: 'test', doc_file: 'a.md' }];
      fs.writeFileSync(path.join(dir, 'reports.json'), JSON.stringify(data));
      const reports = loadReports(tmpDir);
      expect(reports).toHaveLength(1);
      expect(reports[0].id).toBe('test');
    });
  });

  describe('appendReport', () => {
    it('creates directory and file if missing', () => {
      const report = appendReport(tmpDir, {
        doc_file: 'README.md',
        claim_text: 'Run npm start',
        actual_behavior: 'Script is npm run dev',
        line_number: 10,
        evidence_files: ['package.json'],
      });

      expect(report.id).toBeTruthy();
      expect(report.doc_file).toBe('README.md');
      expect(report.status).toBe('pending');
      expect(report.reported_at).toBeTruthy();

      // Verify file exists
      const filePath = path.join(tmpDir, '.docalign', 'reports.json');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('appends to existing reports', () => {
      appendReport(tmpDir, {
        doc_file: 'a.md',
        claim_text: 'claim 1',
        actual_behavior: 'actual 1',
        line_number: null,
        evidence_files: [],
      });

      appendReport(tmpDir, {
        doc_file: 'b.md',
        claim_text: 'claim 2',
        actual_behavior: 'actual 2',
        line_number: 5,
        evidence_files: ['src/index.ts'],
      });

      const reports = loadReports(tmpDir);
      expect(reports).toHaveLength(2);
      expect(reports[0].doc_file).toBe('a.md');
      expect(reports[1].doc_file).toBe('b.md');
    });

    it('generates unique IDs', () => {
      const r1 = appendReport(tmpDir, {
        doc_file: 'a.md',
        claim_text: 'c1',
        actual_behavior: 'a1',
        line_number: null,
        evidence_files: [],
      });

      const r2 = appendReport(tmpDir, {
        doc_file: 'b.md',
        claim_text: 'c2',
        actual_behavior: 'a2',
        line_number: null,
        evidence_files: [],
      });

      expect(r1.id).not.toBe(r2.id);
    });

    it('includes all required fields', () => {
      const report = appendReport(tmpDir, {
        doc_file: 'docs/api.md',
        claim_text: 'POST /users creates a user',
        actual_behavior: 'POST /api/users creates a user',
        line_number: 42,
        evidence_files: ['src/routes/users.ts', 'src/controllers/users.ts'],
      });

      expect(report.id).toBeTruthy();
      expect(report.doc_file).toBe('docs/api.md');
      expect(report.line_number).toBe(42);
      expect(report.claim_text).toBe('POST /users creates a user');
      expect(report.actual_behavior).toBe('POST /api/users creates a user');
      expect(report.evidence_files).toEqual(['src/routes/users.ts', 'src/controllers/users.ts']);
      expect(report.reported_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(report.status).toBe('pending');
    });
  });

  describe('updateReportStatus', () => {
    it('updates status of existing report', () => {
      const report = appendReport(tmpDir, {
        doc_file: 'a.md',
        claim_text: 'claim',
        actual_behavior: 'actual',
        line_number: null,
        evidence_files: [],
      });

      const updated = updateReportStatus(tmpDir, report.id, 'fixed');
      expect(updated).toBe(true);

      const reports = loadReports(tmpDir);
      expect(reports[0].status).toBe('fixed');
    });

    it('returns false for nonexistent report', () => {
      const updated = updateReportStatus(tmpDir, 'nonexistent-id', 'dismissed');
      expect(updated).toBe(false);
    });

    it('can dismiss a report', () => {
      const report = appendReport(tmpDir, {
        doc_file: 'a.md',
        claim_text: 'claim',
        actual_behavior: 'actual',
        line_number: null,
        evidence_files: [],
      });

      updateReportStatus(tmpDir, report.id, 'dismissed');
      const reports = loadReports(tmpDir);
      expect(reports[0].status).toBe('dismissed');
    });
  });
});
