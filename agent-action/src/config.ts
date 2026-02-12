import fs from 'fs';
import { parse as parseYaml } from 'yaml';

/**
 * Action configuration loaded from environment + .docalign.yml.
 */
export interface ActionConfig {
  docalignToken: string;
  serverUrl: string;
  anthropicApiKey: string;
  openaiApiKey: string | null;
  scanRunId: string;
  repoId: string;
  maxTasks: number;
  pollIntervalMs: number;
  actionRunId: string;

  // LLM config from .docalign.yml
  llm: {
    verificationModel: string;
    extractionModel: string;
    triageModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
  };

  // Verification config
  verification: {
    maxClaimsPerPr: number;
    autoFix: boolean;
    autoFixThreshold: number;
  };

  // Mapping config
  mapping: {
    path1MaxEvidenceTokens: number;
    maxAgentFilesPerClaim: number;
  };

  // Agent config
  agent: {
    concurrency: number;
    timeoutSeconds: number;
    command: string | undefined;
  };
}

const LLM_DEFAULTS = {
  verificationModel: 'claude-sonnet-4-5-20250929',
  extractionModel: 'claude-sonnet-4-5-20250929',
  triageModel: 'claude-haiku-3-5-20241022',
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
};

const VERIFICATION_DEFAULTS = {
  maxClaimsPerPr: 50,
  autoFix: false,
  autoFixThreshold: 0.9,
};

const MAPPING_DEFAULTS = {
  path1MaxEvidenceTokens: 8000,
  maxAgentFilesPerClaim: 10,
};

const AGENT_DEFAULTS = {
  concurrency: 5,
  timeoutSeconds: 120,
  command: undefined as string | undefined,
};

/**
 * Load action configuration from GitHub Action inputs (env vars) and .docalign.yml.
 */
export function loadActionConfig(): ActionConfig {
  const docalignToken = requireEnv('INPUT_DOCALIGN_TOKEN');
  const serverUrl = requireEnv('INPUT_DOCALIGN_SERVER_URL');
  const anthropicApiKey = requireEnv('INPUT_ANTHROPIC_API_KEY');
  const openaiApiKey = process.env.INPUT_OPENAI_API_KEY || null;
  const scanRunId = requireEnv('INPUT_SCAN_RUN_ID');
  const repoId = requireEnv('INPUT_REPO_ID');
  const maxTasks = parseInt(process.env.INPUT_MAX_TASKS || '100', 10);
  const pollIntervalMs = parseInt(process.env.INPUT_POLL_INTERVAL_MS || '2000', 10);
  const actionRunId = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const configPath = process.env.INPUT_CONFIG_PATH || '.docalign.yml';

  // Load .docalign.yml overrides
  const yamlConfig = loadYamlConfig(configPath);

  return {
    docalignToken,
    serverUrl: serverUrl.replace(/\/$/, ''), // strip trailing slash
    anthropicApiKey,
    openaiApiKey,
    scanRunId,
    repoId,
    maxTasks,
    pollIntervalMs,
    actionRunId,
    llm: {
      verificationModel: yamlConfig?.llm?.verification_model || LLM_DEFAULTS.verificationModel,
      extractionModel: yamlConfig?.llm?.extraction_model || LLM_DEFAULTS.extractionModel,
      triageModel: yamlConfig?.llm?.triage_model || LLM_DEFAULTS.triageModel,
      embeddingModel: yamlConfig?.llm?.embedding_model || LLM_DEFAULTS.embeddingModel,
      embeddingDimensions: yamlConfig?.llm?.embedding_dimensions || LLM_DEFAULTS.embeddingDimensions,
    },
    verification: {
      maxClaimsPerPr: yamlConfig?.verification?.max_claims_per_pr ?? VERIFICATION_DEFAULTS.maxClaimsPerPr,
      autoFix: yamlConfig?.verification?.auto_fix ?? VERIFICATION_DEFAULTS.autoFix,
      autoFixThreshold: yamlConfig?.verification?.auto_fix_threshold ?? VERIFICATION_DEFAULTS.autoFixThreshold,
    },
    mapping: {
      path1MaxEvidenceTokens: yamlConfig?.mapping?.path1_max_evidence_tokens ?? MAPPING_DEFAULTS.path1MaxEvidenceTokens,
      maxAgentFilesPerClaim: yamlConfig?.mapping?.max_agent_files_per_claim ?? MAPPING_DEFAULTS.maxAgentFilesPerClaim,
    },
    agent: {
      concurrency: yamlConfig?.agent?.concurrency ?? AGENT_DEFAULTS.concurrency,
      timeoutSeconds: yamlConfig?.agent?.timeout_seconds ?? AGENT_DEFAULTS.timeoutSeconds,
      command: yamlConfig?.agent?.command ?? AGENT_DEFAULTS.command,
    },
  };
}

/**
 * Require an environment variable or throw.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadYamlConfig(configPath: string): any {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    if (!content.trim()) return null;
    return parseYaml(content);
  } catch {
    return null;
  }
}
