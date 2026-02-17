export interface MutationChange {
  file: string;
  operation:
    | 'delete_line_matching'
    | 'replace_line_matching'
    | 'rename_file'
    | 'delete_file'
    | 'set_json_field';
  pattern?: string; // for delete_line_matching
  find?: string; // for replace_line_matching
  replace?: string; // for replace_line_matching
  from?: string; // for rename_file
  to?: string; // for rename_file
  path?: string; // for set_json_field (dot-notation JSON path)
  value?: unknown; // for set_json_field
}

export interface ExpectedFinding {
  claim_id?: string;
  claim_type?: string;
  verdict: 'drifted' | 'verified' | 'uncertain';
  severity?: string;
  claim_text_contains?: string;
}

export interface MutationDef {
  id: string;
  type: 'deterministic' | 'semantic';
  description: string;
  changes: MutationChange[];
  expected_findings: ExpectedFinding[];
}

export interface RunOptions {
  preTags: boolean; // true = use tagged/ state; false = use untagged/
  llmFixtures?: string; // path to llm-fixtures.json (Tracks 3 & 4)
  mutations?: MutationDef[]; // applied as in-memory patches
}

export interface Finding {
  claim_id: string;
  claim_type: string;
  claim_text: string;
  source_file: string;
  verdict: 'drifted' | 'verified' | 'uncertain';
  severity: string | null;
  tier: number;
  is_semantic: boolean; // true = from sidecar evaluator
}

export interface RunResult {
  findings: Finding[];
  claimsExtracted: number;
  claimsVerified: number;
  tags?: Record<string, unknown>; // populated when preTags: false (Track 3)
}

export interface SidecarAssertion {
  pattern: string;
  scope: string;
  expect: 'exists' | 'not_exists';
}

export interface SidecarClaim {
  id: string;
  claim_text: string;
  evidence_assertions: SidecarAssertion[];
}

export interface SidecarFile {
  claims: SidecarClaim[];
}
