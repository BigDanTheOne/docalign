/**
 * Drift report persistence — stores agent-reported drift to local JSON.
 * File: .docalign/reports.json (local, not committed to git).
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface DriftReport {
  id: string;
  doc_file: string;
  line_number: number | null;
  claim_text: string;
  actual_behavior: string;
  evidence_files: string[];
  reported_at: string;
  status: 'pending' | 'fixed' | 'dismissed';
}

const REPORTS_DIR = '.docalign';
const REPORTS_FILE = 'reports.json';

function getReportsPath(repoRoot: string): string {
  return path.join(repoRoot, REPORTS_DIR, REPORTS_FILE);
}

export function loadReports(repoRoot: string): DriftReport[] {
  const filePath = getReportsPath(repoRoot);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [];
  } catch {
    return [];
  }
}

export function appendReport(
  repoRoot: string,
  input: {
    doc_file: string;
    claim_text: string;
    actual_behavior: string;
    line_number: number | null;
    evidence_files: string[];
  },
): DriftReport {
  const reports = loadReports(repoRoot);

  const report: DriftReport = {
    id: randomUUID(),
    doc_file: input.doc_file,
    line_number: input.line_number,
    claim_text: input.claim_text,
    actual_behavior: input.actual_behavior,
    evidence_files: input.evidence_files,
    reported_at: new Date().toISOString(),
    status: 'pending',
  };

  reports.push(report);

  // Ensure directory exists
  const dir = path.join(repoRoot, REPORTS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(getReportsPath(repoRoot), JSON.stringify(reports, null, 2) + '\n');
  return report;
}

export function updateReportStatus(
  repoRoot: string,
  id: string,
  status: 'pending' | 'fixed' | 'dismissed',
): boolean {
  const reports = loadReports(repoRoot);
  const report = reports.find((r) => r.id === id);
  if (!report) return false;

  report.status = status;
  fs.writeFileSync(getReportsPath(repoRoot), JSON.stringify(reports, null, 2) + '\n');
  return true;
}
