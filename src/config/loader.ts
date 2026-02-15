import fs from 'fs';
import { parse as parseYaml } from 'yaml';
import { docAlignConfigSchema } from './schema';
import type { DocAlignConfig } from '../shared/types';


export interface ConfigWarning {
  field: string;
  message: string;
}

export interface LoadConfigResult {
  config: DocAlignConfig;
  warnings: ConfigWarning[];
}

/** Default DocAlignConfig values used when file is absent or fields are omitted. */
export const CONFIG_DEFAULTS: Required<DocAlignConfig> = {
  doc_patterns: {
    include: [
      'README.md',
      'README.mdx',
      'README.rst',
      'CONTRIBUTING.md',
      'ARCHITECTURE.md',
      'CLAUDE.md',
      'AGENTS.md',
      'COPILOT-INSTRUCTIONS.md',
      '.cursorrules',
      'docs/**/*.md',
      'docs/**/*.mdx',
      'doc/**/*.md',
      'wiki/**/*.md',
      'adr/**/*.md',
      'ADR-*.md',
      '**/CLAUDE.md',
      '**/AGENTS.md',
      'api/**/*.md',
    ],
    exclude: ['node_modules/**', 'vendor/**', '.git/**', '**/CHANGELOG.md', '**/LICENSE.md'],
  },
  code_patterns: {
    include: ['**'],
    exclude: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'vendor/**', '__pycache__/**'],
  },
  verification: {
    min_severity: 'low',
    max_claims_per_pr: 50,
    auto_fix: false,
    auto_fix_threshold: 0.9,
  },
  claim_types: {
    path_reference: true,
    dependency_version: true,
    command: true,
    api_route: true,
    code_example: true,
    behavior: true,
    architecture: true,
    config: true,
    convention: true,
    environment: true,
    url_reference: true,
  },
  suppress: [],
  schedule: {
    full_scan: 'weekly',
    full_scan_day: 'sunday',
  },
  agent: {
    concurrency: 5,
    timeout_seconds: 120,
    command: undefined,
  },
  llm: {
    verification_model: 'claude-sonnet-4-20250514',
    extraction_model: 'claude-sonnet-4-20250514',
    embedding_model: 'text-embedding-3-small',
    embedding_dimensions: 1536,
  },
  check: {
    min_severity_to_block: undefined,
  },
  mapping: {
    semantic_threshold: 0.7,
    path1_max_evidence_tokens: 8000,
    max_agent_files_per_claim: 10,
  },
  url_check: {
    enabled: true,
    timeout_ms: 5000,
    max_per_domain: 5,
    exclude_domains: [],
  },
  coverage: {
    enabled: false,
    min_entity_importance: 'exported',
  },
};

/**
 * Load and validate a .docalign.yml configuration file.
 * Returns fully-populated config with defaults applied.
 *
 * - Missing file → defaults
 * - Empty file → defaults
 * - Invalid YAML → E501 warning + defaults
 * - Invalid values → E502 warning + field defaults
 * - Unknown keys → E502 warning with "did you mean?"
 */
export function loadDocAlignConfig(filePath?: string): LoadConfigResult {
  const warnings: ConfigWarning[] = [];

  // 1. Try to read file
  const resolvedPath = filePath ?? '.docalign.yml';
  let rawContent: string | null = null;

  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    // File not found — use defaults (GATE42-015)
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  // 2. Handle empty file
  if (!rawContent || rawContent.trim() === '') {
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  // 3. Parse YAML
  let parsed: unknown;
  try {
    parsed = parseYaml(rawContent);
  } catch (err) {
    warnings.push({
      field: '_yaml',
      message: `E501: Invalid YAML syntax: ${err instanceof Error ? err.message : 'Unknown error'}. Using defaults.`,
    });
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  // Handle YAML that parses to null/undefined (e.g., just comments)
  if (parsed === null || parsed === undefined) {
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push({
      field: '_yaml',
      message: 'E501: Config must be a YAML mapping. Using defaults.',
    });
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  // 4. Validate suppress[].pattern regex
  const rawObj = parsed as Record<string, unknown>;
  if (Array.isArray(rawObj.suppress)) {
    for (let i = 0; i < rawObj.suppress.length; i++) {
      const rule = rawObj.suppress[i] as Record<string, unknown> | undefined;
      if (rule?.pattern && typeof rule.pattern === 'string') {
        try {
          new RegExp(rule.pattern);
        } catch {
          warnings.push({
            field: `suppress[${i}].pattern`,
            message: `E502: Invalid regex pattern "${rule.pattern}". This suppression rule will be ignored.`,
          });
          // Remove invalid pattern
          delete rule.pattern;
          if (Object.keys(rule).length === 0) {
            rawObj.suppress.splice(i, 1);
            i--;
          }
        }
      }
    }
  }

  // 5. Validate with Zod (strict mode catches unknown keys)
  const result = docAlignConfigSchema.safeParse(parsed);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const fieldPath = issue.path.join('.');
      if (issue.code === 'unrecognized_keys') {
        const unknownKeys = (issue as { keys: string[] }).keys;
        for (const key of unknownKeys) {
          const suggestion = findSimilarKey(key);
          const msg = suggestion
            ? `E502: Unknown key "${key}". Did you mean "${suggestion}"?`
            : `E502: Unknown key "${key}".`;
          warnings.push({ field: fieldPath || key, message: msg });
        }
      } else {
        warnings.push({
          field: fieldPath || '_unknown',
          message: `E502: ${issue.message}. Using default for this field.`,
        });
      }
    }

    // Strip unknown keys and re-parse leniently
    const stripped = stripUnknownKeys(parsed as Record<string, unknown>);
    const retryResult = docAlignConfigSchema.safeParse(stripped);
    if (retryResult.success) {
      return { config: deepMerge(CONFIG_DEFAULTS, retryResult.data as Partial<DocAlignConfig>), warnings };
    }

    // If still fails, use defaults
    return { config: deepMerge(CONFIG_DEFAULTS, {}), warnings };
  }

  return { config: deepMerge(CONFIG_DEFAULTS, result.data as Partial<DocAlignConfig>), warnings };
}

/** Known top-level keys for "did you mean?" suggestions. */
const KNOWN_KEYS = [
  'doc_patterns',
  'code_patterns',
  'verification',
  'claim_types',
  'suppress',
  'schedule',
  'agent',
  'trigger',
  'llm',
  'check',
  'mapping',
  'url_check',
  'coverage',
];

function findSimilarKey(key: string): string | null {
  const lower = key.toLowerCase();
  for (const known of KNOWN_KEYS) {
    if (levenshtein(lower, known) <= 3) {
      return known;
    }
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

function stripUnknownKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of KNOWN_KEYS) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/** Deep merge defaults with user config (user values take precedence). */
function deepMerge<T extends Record<string, unknown>>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const val = overrides[key];
    if (val === undefined) continue;
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}
