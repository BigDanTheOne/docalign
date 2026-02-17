#!/usr/bin/env node
'use strict';

const { randomUUID } = require('crypto');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// Resolve better-sqlite3
// ---------------------------------------------------------------------------
let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  const explicit = path.join(
    os.homedir(),
    'Discovery',
    'docalign',
    'node_modules',
    'better-sqlite3',
  );
  Database = require(explicit);
}

// ---------------------------------------------------------------------------
// DB path & initialisation
// ---------------------------------------------------------------------------
const DB_DIR = path.join(os.homedir(), 'Discovery', 'docalign', '_team', 'data');
const DB_PATH = process.env.PIPELINE_DB_PATH || path.join(DB_DIR, 'pipeline.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_stage TEXT,
    parent_epic_id TEXT,
    review_loop_count INTEGER DEFAULT 0,
    orchestrator_session TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    source TEXT NOT NULL DEFAULT 'pipeline'
  );

  CREATE TABLE IF NOT EXISTS steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    stage TEXT NOT NULL,
    agent TEXT NOT NULL,
    parallel_group TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    result_summary TEXT,
    feedback TEXT,
    worker_session TEXT,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS fan_in_tracker (
    run_id TEXT NOT NULL,
    parallel_group TEXT NOT NULL,
    expected INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    any_rejected INTEGER DEFAULT 0,
    results JSON DEFAULT '[]',
    PRIMARY KEY (run_id, parallel_group)
  );
`);

// ---------------------------------------------------------------------------
// Schema migration: add worktree_path column if missing
// ---------------------------------------------------------------------------
try {
  db.prepare("SELECT worktree_path FROM runs LIMIT 0").get();
} catch (_) {
  db.exec("ALTER TABLE runs ADD COLUMN worktree_path TEXT");
}

// Schema migration: add source column if missing
try {
  db.prepare("SELECT source FROM runs LIMIT 0").get();
} catch (_) {
  db.exec("ALTER TABLE runs ADD COLUMN source TEXT NOT NULL DEFAULT 'pipeline'");
}

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  let i = 0;
  while (i < argv.length) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
        i++;
      } else {
        args[key] = next;
        i += 2;
      }
    } else {
      i++;
    }
  }
  return args;
}

function requireArg(args, name) {
  if (args[name] === undefined || args[name] === true) {
    fatal(`Missing required argument: --${name}`);
  }
  return args[name];
}

// ---------------------------------------------------------------------------
// Run-ID prefix resolution
// ---------------------------------------------------------------------------
function resolveRunId(rawId) {
  // Try exact match first
  const exact = db.prepare('SELECT id FROM runs WHERE id = ?').get(rawId);
  if (exact) return exact.id;

  // Try prefix match
  const matches = db.prepare("SELECT id FROM runs WHERE id LIKE ? || '%'").all(rawId);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    fatal(`Ambiguous run-id prefix "${rawId}". Matches: ${matches.map(m => m.id).join(', ')}`);
  }
  fatal(`Run not found: ${rawId}`);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function fatal(msg) {
  process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Initial stage mapping
// ---------------------------------------------------------------------------
const INITIAL_STAGES = {
  task: 'request',
  feature: 'signal',
  epic: 'signal',
};

// ---------------------------------------------------------------------------
// Git worktree config
// ---------------------------------------------------------------------------
/**
 * Resolve the main git repository path.
 * Checks ~/docalign first (primary), then ~/Discovery/docalign (fallback).
 * This ensures worktree git commands use the same checkout that actually exists,
 * matching the DB_DIR / TEAM_DIR paths when only the Discovery checkout is present.
 */
function resolveMainRepo() {
  const candidates = [
    process.env.GITHUB_WORKSPACE,
    path.resolve(__dirname, '../../../../'),
    process.cwd(),
    path.join(os.homedir(), 'docalign'),
    path.join(os.homedir(), 'Discovery', 'docalign'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, '.git'))) {
      return candidate;
    }
  }
  // Last resort: return first candidate and let git commands fail with a clear error
  return candidates[0];
}

const MAIN_REPO = resolveMainRepo();
const WORKTREE_ROOT = path.join(os.homedir(), 'docalign-worktrees');

function shortId(uuid) {
  return uuid.split('-')[0];
}

function worktreePath(runId) {
  return path.join(WORKTREE_ROOT, shortId(runId));
}

function branchName(runId) {
  return `feature/${shortId(runId)}`;
}

/**
 * Create a git worktree for a pipeline run.
 * Idempotent: if the worktree already exists, reuse it.
 */
function createWorktree(runId) {
  const wt = worktreePath(runId);
  const branch = branchName(runId);

  // Already exists — reuse
  if (fs.existsSync(wt)) {
    db.prepare("UPDATE runs SET worktree_path = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(wt, runId);
    return { worktree_path: wt, branch, created: false, reused: true };
  }

  fs.mkdirSync(WORKTREE_ROOT, { recursive: true });

  try {
    execSync(`git -C "${MAIN_REPO}" worktree add "${wt}" -b "${branch}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (err) {
    // Branch might already exist (retry scenario) — try without -b
    try {
      execSync(`git -C "${MAIN_REPO}" worktree add "${wt}" "${branch}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (err2) {
      fatal(`Failed to create worktree: ${err2.stderr?.toString() || err2.message}`);
    }
  }

  // Install dependencies in the worktree
  try {
    execSync('npm install --prefer-offline --no-audit 2>/dev/null || true', {
      cwd: wt,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
    });
  } catch (_) { /* best-effort */ }

  db.prepare("UPDATE runs SET worktree_path = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(wt, runId);

  return { worktree_path: wt, branch, created: true, reused: false };
}

// ---------------------------------------------------------------------------
// EXEC_PLAN.md assembly
// ---------------------------------------------------------------------------

const TEAM_DIR = path.join(MAIN_REPO, '_team');

/**
 * Read a file, returning its content or null if it doesn't exist.
 */
function readArtifact(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (_) {
    return null;
  }
}

/**
 * Assemble an EXEC_PLAN.md for a pipeline build stage.
 * Gathers artifacts from _team/outputs/<runId>/ and writes a self-contained
 * execution plan into the worktree. The coding agent reads this file directly.
 *
 * @returns {string} Path to the written EXEC_PLAN.md
 */
function assembleExecPlan(runId, wtPath) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) { fatal(`Run ${runId} not found`); }

  const sid = shortId(runId);
  const outputsDir = path.join(TEAM_DIR, 'outputs', runId);
  const handoffsDir = path.join(TEAM_DIR, 'handoffs', runId);
  const isFeature = run.type === 'feature';
  const isEpic = run.type === 'epic';

  // Gather artifacts (all optional — degrade gracefully)
  const decision = readArtifact(path.join(outputsDir, 'decision.md'));
  const spec = readArtifact(path.join(outputsDir, 'spec', 'tech-lead.md'));
  const plan = readArtifact(path.join(outputsDir, 'plan', 'tech-lead.md'));
  const define = readArtifact(path.join(outputsDir, 'define', 'pm.md'));
  const specReviewPm = readArtifact(path.join(outputsDir, 'spec_review', 'pm.md'));
  const specReviewCritic = readArtifact(path.join(outputsDir, 'spec_review', 'critic.md'));
  const handoff = readArtifact(path.join(handoffsDir, 'handoff.md'));

  // Gather prior code review feedback (if re-building after rejection)
  let priorFeedback = null;
  const rejectedSteps = db.prepare(
    "SELECT agent, feedback FROM steps WHERE run_id = ? AND stage = 'code_review' AND status = 'rejected' ORDER BY completed_at DESC"
  ).all(runId);
  if (rejectedSteps.length > 0) {
    priorFeedback = rejectedSteps
      .map(s => `### ${s.agent}\n${normalizeMultiline(s.feedback) || '(no feedback)'}`)
      .join('\n\n');
  }

  // Build stage history from steps
  const steps = db.prepare(
    "SELECT stage, agent, status, result_summary, completed_at FROM steps WHERE run_id = ? ORDER BY started_at"
  ).all(runId);
  const stageHistory = steps.length > 0
    ? steps
      .map(s => `- **${s.stage}** (${s.agent}): ${s.status}${s.result_summary ? ' — ' + normalizeMultiline(s.result_summary) : ''}`)
      .join('\n')
    : '(no prior stages recorded)';

  // Extract progress items from plan if available
  let progressItems = '- [ ] Complete all build tasks\n- [ ] Push branch and open PR\n- [ ] All tests pass (`npm run typecheck && npm run test`)';
  if (plan) {
    // Try to extract task lines from the plan (look for numbered items or headers)
    const taskLines = plan.split('\n')
      .filter(l => /^(\d+[\.\)]\s|[-*]\s|###?\s)/.test(l.trim()))
      .map(l => `- [ ] ${l.trim().replace(/^[-*\d\.\)#]+\s*/, '')}`)
      .join('\n');
    if (taskLines) {
      progressItems = taskLines + '\n- [ ] Push branch and open PR\n- [ ] All tests pass (`npm run typecheck && npm run test`)';
    }
  }

  // Assemble the EXEC_PLAN.md
  const sections = [];

  sections.push(`# EXEC_PLAN — ${run.title}\n`);
  sections.push(`Run ID: \`${runId}\``);
  sections.push(`Pipeline type: ${run.type}`);
  sections.push(`Branch: \`feature/${sid}\``);
  sections.push(`Generated: ${new Date().toISOString()}\n`);

  // Purpose
  sections.push(`## Purpose / Big Picture\n`);
  if (decision) {
    sections.push(decision);
  } else if (handoff) {
    // Extract summary from handoff if no decision doc
    const summaryMatch = handoff.match(/(?:##?\s*(?:Summary|Purpose|Overview)[\s\S]*?)(?=\n##?\s|\n$)/i);
    sections.push(summaryMatch ? summaryMatch[0] : handoff.slice(0, 500));
  } else {
    sections.push(`Task: ${run.title}`);
  }

  // Progress
  sections.push(`\n## Progress\n`);
  sections.push(progressItems);

  // Prior code review feedback (if re-building)
  if (priorFeedback) {
    sections.push(`\n## Prior Code Review Feedback (MUST ADDRESS)\n`);
    sections.push(`The previous build was rejected. Address ALL of the following feedback:\n`);
    sections.push(priorFeedback);
  }

  // Context
  sections.push(`\n## Context and Orientation\n`);
  sections.push(`### Working Directory`);
  sections.push(`\`${wtPath}\`\n`);
  sections.push(`### Key Conventions`);
  sections.push(`- Run \`npm run typecheck && npm run test\` after every change`);
  sections.push(`- Run \`npm run lint:fix\` after every file edit`);
  sections.push(`- Run \`npm run lint:agent\` for errors with remediation hints`);
  sections.push(`- Follow existing patterns in \`src/\` — strict TypeScript, Zod validation, Pino logging`);
  sections.push(`- See \`CLAUDE.md\` in repo root for full conventions`);
  sections.push(`- See \`CONVENTIONS.md\` for coding style reference\n`);
  sections.push(`### Stage History\n${stageHistory}`);

  // Plan of Work
  if (plan) {
    sections.push(`\n## Plan of Work\n`);
    sections.push(plan);
  }

  // QA Test Requirements
  const qaManifest = readArtifact(path.join(outputsDir, 'qa_tests', 'qa.md'));
  const qaIntManifest = readArtifact(path.join(outputsDir, 'qa_integration_tests', 'qa.md'));
  if (qaManifest || qaIntManifest) {
    sections.push(`\n## QA Test Requirements (MUST PASS)\n`);
    sections.push(`Pre-written QA tests have been placed in this worktree under \`test/qa/\`.`);
    sections.push(`These tests validate design contracts — they will FAIL until implementation is correct.\n`);
    sections.push(`**Your implementation MUST make all QA tests pass. Do NOT modify QA test files.**`);
    sections.push(`If a QA test is impossible to satisfy, add \`.skip()\` with a \`// QA-DISPUTE: <reason>\` comment`);
    sections.push(`and document it in the Surprises & Discoveries section.\n`);
    sections.push(`Run QA tests: \`npm run test:qa\`\n`);
    if (qaManifest) sections.push(`### QA Test Manifest\n\n${qaManifest}`);
    if (qaIntManifest) sections.push(`### QA Integration Test Manifest\n\n${qaIntManifest}`);
  }

  // Specification (feature/epic only)
  if (spec && (isFeature || isEpic)) {
    sections.push(`\n## Specification\n`);
    sections.push(spec);
  }

  // Acceptance Criteria
  if (define) {
    sections.push(`\n## Acceptance Criteria\n`);
    sections.push(define);
  }

  // Review Conditions (feature only)
  if ((specReviewPm || specReviewCritic) && isFeature) {
    sections.push(`\n## Review Conditions\n`);
    if (specReviewPm) { sections.push(`### PM Review\n${specReviewPm}`); }
    if (specReviewCritic) { sections.push(`### Critic Review\n${specReviewCritic}`); }
  }

  // Validation
  sections.push(`\n## Validation and Acceptance\n`);
  sections.push(`For each task:`);
  sections.push(`1. Run \`npm run typecheck\` — must pass with 0 errors`);
  sections.push(`2. Run \`npm run test\` — must pass with 0 failures`);
  sections.push(`3. Run \`npm run lint:agent\` — must produce 0 errors (includes remediation hints)`);
  sections.push(`4. Run \`npm run test:qa\` — QA acceptance tests must pass (0 failures)\n`);
  sections.push(`Final validation:`);
  sections.push(`1. Run \`npm run typecheck && npm run test && npm run lint\``);
  sections.push(`2. Verify all acceptance criteria above are met`);
  sections.push(`3. Verify no regressions in existing tests`);
  sections.push(`4. Run \`npm run test:qa\` separately to confirm design contracts\n`);
  sections.push(`### Integration Testing (optional, for complex features)`);
  sections.push(`1. \`npm run build\``);
  sections.push(`2. \`bash ~/.openclaw/skills/pipeline/scripts/agent-dev.sh --run-id ${runId}\``);
  sections.push(`3. Read \`.agent-dev.json\` for the assigned port`);
  sections.push(`4. \`curl http://localhost:<port>/health\``);
  sections.push(`5. \`bash ~/.openclaw/skills/pipeline/scripts/agent-dev-cleanup.sh --run-id ${runId}\``);

  // Idempotence
  sections.push(`\n## Idempotence and Recovery\n`);
  sections.push(`- All tasks are idempotent — re-running produces the same result`);
  sections.push(`- If a task fails, fix the issue and re-run from the failing task`);
  sections.push(`- If typecheck/test fails, debug and fix before moving to next task`);
  sections.push(`- Maximum 3 retry attempts per task before recording the failure`);

  // Living sections (agent fills in)
  sections.push(`\n## Surprises & Discoveries\n`);
  sections.push(`_(Agent fills this in during execution — record unexpected findings here)_`);

  sections.push(`\n## Decision Log\n`);
  sections.push(`_(Agent fills this in during execution — record design decisions with rationale)_`);

  sections.push(`\n## Outcomes & Retrospective\n`);
  sections.push(`_(Agent fills this in after completion — summarize what was built, gaps, lessons)_`);

  // Write the file
  const execPlanPath = path.join(wtPath, 'EXEC_PLAN.md');
  fs.writeFileSync(execPlanPath, sections.join('\n'), 'utf8');

  return execPlanPath;
}

/**
 * Copy QA-authored test files from staging area into the worktree.
 * Called during advance --stage build, before assembleExecPlan.
 *
 * Checks two source directories:
 *   - _team/outputs/<runId>/qa_tests/files/       (feature/task QA tests)
 *   - _team/outputs/<runId>/qa_integration_tests/files/  (epic integration QA tests)
 *
 * Files are copied preserving relative paths (e.g., test/qa/slug/foo.qa.test.ts).
 *
 * @param {string} runId
 * @param {string} wtPath - Worktree root path
 * @returns {string[]} List of copied file paths (relative to worktree)
 */
function copyQaTestsToWorktree(runId, wtPath) {
  const outputsDir = path.join(TEAM_DIR, 'outputs', runId);
  const sources = [
    path.join(outputsDir, 'qa_tests', 'files'),
    path.join(outputsDir, 'qa_integration_tests', 'files'),
  ];

  const copied = [];

  for (const srcRoot of sources) {
    if (!fs.existsSync(srcRoot)) continue;

    // Recursive walk
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          const relPath = path.relative(srcRoot, fullPath);
          // Path guard: QA test files must resolve under test/qa/ in the worktree.
          // This prevents a malicious or buggy QA stage from overwriting implementation files.
          const normalizedRel = path.normalize(relPath);
          if (!normalizedRel.startsWith(`test${path.sep}qa${path.sep}`) && !normalizedRel.startsWith('test/qa/')) {
            fatal(`QA test path guard violation: "${relPath}" is outside test/qa/. QA tests must be under test/qa/.`);
          }
          const destPath = path.join(wtPath, relPath);
          const resolvedDest = path.resolve(destPath);
          const allowedRoot = path.resolve(path.join(wtPath, 'test', 'qa'));
          if (!resolvedDest.startsWith(allowedRoot + path.sep) && resolvedDest !== allowedRoot) {
            fatal(`QA test path traversal blocked: "${relPath}" resolves outside ${allowedRoot}`);
          }
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.copyFileSync(fullPath, destPath);
          copied.push(relPath);
        }
      }
    };

    walk(srcRoot);
  }

  return copied;
}

/**
 * Remove a git worktree for a pipeline run.
 * Idempotent: if the worktree doesn't exist, no-op.
 */
function removeWorktree(runId) {
  const wt = worktreePath(runId);

  if (!fs.existsSync(wt)) {
    return { worktree_path: wt, removed: false, reason: 'not_found' };
  }

  // Clean up agent dev environment before removing worktree (best-effort)
  const cleanupScript = path.join(os.homedir(), '.openclaw', 'skills', 'pipeline', 'scripts', 'agent-dev-cleanup.sh');
  if (fs.existsSync(cleanupScript)) {
    try {
      execSync(`bash "${cleanupScript}" --run-id "${runId}" --worktree "${wt}"`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
    } catch (_) { /* best-effort cleanup */ }
  }

  try {
    execSync(`git -C "${MAIN_REPO}" worktree remove "${wt}" --force`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch (_) {
    // Fallback: just remove the directory
    try { fs.rmSync(wt, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try {
      execSync(`git -C "${MAIN_REPO}" worktree prune`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      });
    } catch (_) { /* ignore */ }
  }

  db.prepare("UPDATE runs SET worktree_path = NULL, updated_at = datetime('now','localtime') WHERE id = ?").run(runId);

  return { worktree_path: wt, removed: true };
}

/**
 * Pull latest changes from remote into the main repository.
 * Best-effort: failures are reported but do not block pipeline completion.
 * This ensures the main checkout picks up merged PR changes.
 *
 * @returns {{ success: boolean, error?: string }}
 */
function pullMainRepo() {
  try {
    execSync(`git -C "${MAIN_REPO}" pull --ff-only`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || err.message;
    return { success: false, error: stderr };
  }
}

const MAX_CONCURRENT_ACTIVE = 8;

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

function cmdCreate(args) {
  const type = requireArg(args, 'type');
  if (!INITIAL_STAGES[type]) {
    fatal(`Invalid type "${type}". Must be one of: task, feature, epic`);
  }
  const title = requireArg(args, 'title');
  const parentEpicId = args['parent-epic-id'] || null;
  const source = args['source'] || 'pipeline';
  const id = randomUUID();
  const currentStage = INITIAL_STAGES[type];

  // Enforce concurrency limit: queue if too many active runs
  const activeCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE status = 'active'",
  ).get().cnt;

  const initialStatus = activeCount >= MAX_CONCURRENT_ACTIVE ? 'queued' : 'active';

  db.prepare(`
    INSERT INTO runs (id, type, title, status, current_stage, parent_epic_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, type, title, initialStatus, currentStage, parentEpicId, source);

  const result = { run_id: id, type, title, status: initialStatus, current_stage: currentStage, source };
  if (initialStatus === 'queued') {
    result.reason = `Concurrency limit reached (${MAX_CONCURRENT_ACTIVE} active). Run queued.`;
  }
  out(result);
}

function cmdStatus(args) {
  const rawRunId = args['run-id'];

  if (rawRunId) {
    const runId = resolveRunId(rawRunId);
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

    const steps = db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY started_at, id').all(runId);
    const fanIns = db.prepare('SELECT * FROM fan_in_tracker WHERE run_id = ?').all(runId);

    // Parse JSON results in fan_in_tracker
    for (const fi of fanIns) {
      try { fi.results = JSON.parse(fi.results); } catch (_) { /* keep as-is */ }
      fi.any_rejected = Boolean(fi.any_rejected);
    }

    out({ ...run, steps, fan_in: fanIns });
  } else {
    const runs = db.prepare(
      "SELECT * FROM runs WHERE status IN ('active', 'queued') ORDER BY updated_at DESC",
    ).all();
    out(runs);
  }
}

function parseEpochMs(value) {
  if (typeof value !== 'string' || !value.trim()) { return null; }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeMultiline(text) {
  if (typeof text !== 'string') { return text; }
  return text
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

function validateFollowupTriageForVerify(runId) {
  const codeReviewDir = path.join(TEAM_DIR, 'outputs', runId, 'code_review');
  const followupsPath = path.join(codeReviewDir, 'followups.json');
  const reviewWindowPath = path.join(codeReviewDir, 'codex-review-window.json');

  if (!fs.existsSync(reviewWindowPath)) {
    fatal(`Cannot advance to verify: missing Codex review gate file at ${reviewWindowPath}`);
  }

  let reviewWindow;
  try {
    reviewWindow = JSON.parse(fs.readFileSync(reviewWindowPath, 'utf8'));
  } catch (err) {
    fatal(`Cannot advance to verify: invalid JSON in ${reviewWindowPath}: ${err.message}`);
  }

  const windowStatus = reviewWindow.status;
  const allowedWindowStatuses = new Set(['review_observed', 'timed_out_no_feedback']);
  if (!allowedWindowStatuses.has(windowStatus)) {
    fatal(`Cannot advance to verify: Codex review window not satisfied (status=${windowStatus || 'missing'})`);
  }

  if (windowStatus === 'timed_out_no_feedback') {
    const reason = typeof reviewWindow.no_feedback_reason === 'string' ? reviewWindow.no_feedback_reason.trim() : '';
    if (!reason) {
      fatal('Cannot advance to verify: timed_out_no_feedback requires no_feedback_reason');
    }
  }

  const latestCommentMs = parseEpochMs(reviewWindow.latest_codex_comment_at);
  const finalIngestMs = parseEpochMs(reviewWindow.final_ingest_at || reviewWindow.ingested_at);
  if (latestCommentMs !== null && (finalIngestMs === null || finalIngestMs < latestCommentMs)) {
    fatal('Cannot advance to verify: follow-up ingestion is stale; run final Codex comment ingestion before verify');
  }

  const codexIssueCount = Number.isFinite(Number(reviewWindow.codex_issue_count))
    ? Number(reviewWindow.codex_issue_count)
    : null;

  if (!fs.existsSync(followupsPath)) {
    fatal(`Cannot advance to verify: missing follow-up triage file at ${followupsPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(followupsPath, 'utf8'));
  } catch (err) {
    fatal(`Cannot advance to verify: invalid JSON in ${followupsPath}: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    fatal(`Cannot advance to verify: followups.json must be an array`);
  }

  if (parsed.length === 0) {
    if (windowStatus === 'timed_out_no_feedback') {
      return;
    }
    fatal(
      `Cannot advance to verify: followups.json is empty but review status is "${windowStatus || 'unknown'}". ` +
      `Empty triage is only allowed when status is "timed_out_no_feedback".`
    );
  }

  const allowedStatuses = new Set(['accepted_fixed', 'not_real', 'not_applicable']);
  const unresolved = [];
  let codexItems = 0;

  for (const item of parsed) {
    const id = item.id || item.item_id || '(missing-id)';
    const status = item.status;
    const rationale = typeof item.rationale === 'string' ? item.rationale.trim() : '';
    const source = String(item.source || '').toLowerCase();

    if (source === 'codex') { codexItems += 1; }

    if (!allowedStatuses.has(status)) {
      unresolved.push({ id, reason: `invalid_or_unresolved_status:${status || 'missing'}` });
      continue;
    }

    if ((status === 'not_real' || status === 'not_applicable') && !rationale) {
      unresolved.push({ id, reason: 'missing_rationale_for_non_fix_triage' });
    }
  }

  if (codexIssueCount !== null && codexIssueCount > 0 && codexItems < codexIssueCount) {
    fatal(`Cannot advance to verify: codex_issue_count=${codexIssueCount} but triaged codex items=${codexItems}`);
  }

  if (unresolved.length > 0) {
    fatal(`Cannot advance to verify: unresolved follow-ups remain (${JSON.stringify(unresolved)})`);
  }
}

/**
 * Validate one-time bootstrap exception policy for verify health gate.
 * This is intentionally narrow: a temporary path for "health paradox" runs where
 * the work itself targets false-positive reduction causing an initially low score.
 *
 * Required artifact when health < threshold:
 *   _team/outputs/<runId>/verify/bootstrap-verify-policy.json
 */
function validateBootstrapVerifyPolicy(run, healthPct, minHealthPct) {
  const runId = run.id;
  const policyPath = path.join(TEAM_DIR, 'outputs', runId, 'verify', 'bootstrap-verify-policy.json');

  if (!fs.existsSync(policyPath)) {
    fatal(`Cannot advance past verify: DocAlign health ${healthPct}% is below minimum ${minHealthPct}% and no bootstrap policy found at ${policyPath}.`);
  }

  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (err) {
    fatal(`Cannot advance past verify: invalid JSON in ${policyPath}: ${err.message}`);
  }

  const required = ['exception_id', 'approved_by', 'reason', 'created_at', 'expires_at', 'scope', 'baseline', 'rollback_plan'];
  for (const key of required) {
    if (!policy[key]) fatal(`Cannot advance past verify: bootstrap policy missing required field '${key}'.`);
  }

  if (policy.scope.run_id !== runId) {
    fatal(`Cannot advance past verify: bootstrap policy scope.run_id (${policy.scope.run_id}) does not match run (${runId}).`);
  }

  if (policy.scope.run_type && policy.scope.run_type !== run.type) {
    fatal(`Cannot advance past verify: bootstrap policy scope.run_type (${policy.scope.run_type}) does not match run type (${run.type}).`);
  }

  if (policy.scope.parent_epic_id && run.parent_epic_id && policy.scope.parent_epic_id !== run.parent_epic_id) {
    fatal(`Cannot advance past verify: bootstrap policy parent_epic_id (${policy.scope.parent_epic_id}) does not match run parent_epic_id (${run.parent_epic_id}).`);
  }

  const expiresAt = Date.parse(policy.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    fatal('Cannot advance past verify: bootstrap policy is expired or has invalid expires_at.');
  }

  const baseline = Number(policy.baseline.health_pct);
  if (!Number.isFinite(baseline)) {
    fatal('Cannot advance past verify: bootstrap policy baseline.health_pct must be numeric.');
  }

  const minFloor = Number(policy.min_health_floor_pct ?? 50);
  if (!Number.isFinite(minFloor)) {
    fatal('Cannot advance past verify: bootstrap policy min_health_floor_pct must be numeric when provided.');
  }

  const requiredDelta = Number(policy.min_delta_pct ?? 0);
  if (!Number.isFinite(requiredDelta)) {
    fatal('Cannot advance past verify: bootstrap policy min_delta_pct must be numeric when provided.');
  }

  const delta = healthPct - baseline;
  if (healthPct < minFloor) {
    fatal(`Cannot advance past verify: bootstrap policy floor violated (${healthPct}% < ${minFloor}%).`);
  }

  if (delta < requiredDelta) {
    fatal(`Cannot advance past verify: bootstrap policy requires delta >= ${requiredDelta}%, actual delta=${delta}%.`);
  }

  if (Number(policy.rollback_plan.restore_min_health_pct) !== 80) {
    fatal('Cannot advance past verify: rollback_plan.restore_min_health_pct must be 80.');
  }

  const consumedPath = path.join(TEAM_DIR, 'outputs', runId, 'verify', 'bootstrap-verify-policy.consumed.json');
  if (fs.existsSync(consumedPath)) {
    fatal(`Cannot advance past verify: bootstrap policy already consumed for run ${runId}. One-time use only.`);
  }

  const consumed = {
    exception_id: policy.exception_id,
    consumed_at: new Date().toISOString(),
    health_pct_at_use: healthPct,
    min_health_pct: minHealthPct,
    baseline_health_pct: baseline,
    delta_pct: delta,
    approved_by: policy.approved_by,
    rollback_plan: policy.rollback_plan,
  };
  fs.writeFileSync(consumedPath, `${JSON.stringify(consumed, null, 2)}\n`);
}

/**
 * Validate DocAlign health before allowing verify -> next stage transition.
 * Requires a docalign-health.json artifact in _team/outputs/<runId>/verify/.
 * The orchestrator must run `npx docalign scan --json` and record the results.
 */
function validateDocAlignHealth(run) {
  const runId = run.id;
  const healthPath = path.join(TEAM_DIR, 'outputs', runId, 'verify', 'docalign-health.json');

  if (!fs.existsSync(healthPath)) {
    fatal(`Cannot advance past verify: missing DocAlign health report at ${healthPath}. Run 'npx docalign scan --json' and write results to this path.`);
  }

  let health;
  try {
    health = JSON.parse(fs.readFileSync(healthPath, 'utf8'));
  } catch (err) {
    fatal(`Cannot advance past verify: invalid JSON in ${healthPath}: ${err.message}`);
  }

  const MIN_HEALTH_PCT = Number(process.env.DOCALIGN_MIN_HEALTH_PCT) || 80;
  const healthPct = Number(health.health_pct);

  if (!Number.isFinite(healthPct)) {
    fatal(`Cannot advance past verify: docalign-health.json missing numeric health_pct field`);
  }

  if (healthPct < MIN_HEALTH_PCT) {
    validateBootstrapVerifyPolicy(run, healthPct, MIN_HEALTH_PCT);
  }
}

function cmdAdvance(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const stage = requireArg(args, 'stage');

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

  // Merge gate policy: do not allow code_review -> verify transition unless
  // every follow-up item is explicitly triaged and resolved.
  if (run.current_stage === 'code_review' && stage === 'verify') {
    validateFollowupTriageForVerify(runId);
  }

  // DocAlign health gate: do not allow verify -> next stage unless health is above threshold.
  if (run.current_stage === 'verify') {
    validateDocAlignHealth(run);
  }

  const result = { run_id: runId, previous_stage: run.current_stage, current_stage: stage, status: run.status };

  // Auto-create worktree and assemble EXEC_PLAN.md when advancing to build stage.
  // Keep this transition atomic: only persist stage=build after setup succeeds.
  if (stage === 'build') {
    const wt = createWorktree(runId);
    const qaFiles = copyQaTestsToWorktree(runId, wt.worktree_path);
    const execPlanPath = assembleExecPlan(runId, wt.worktree_path);
    db.prepare(`
      UPDATE runs SET current_stage = ?, updated_at = datetime('now','localtime') WHERE id = ?
    `).run(stage, runId);
    result.worktree = wt;
    result.exec_plan = execPlanPath;
    if (qaFiles.length > 0) result.qa_test_files = qaFiles;
    out(result);
    return;
  }

  // For epic pipelines advancing to verify: copy QA integration tests into the main repo
  // so the verify agent can run them. Epic has no build worktree — children merged to main.
  if (stage === 'verify' && run.type === 'epic') {
    const qaFiles = copyQaTestsToWorktree(runId, REPO_ROOT);
    if (qaFiles.length > 0) result.qa_test_files = qaFiles;
  }

  db.prepare(`
    UPDATE runs SET current_stage = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(stage, runId);

  out(result);
}

function cmdAddStep(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const stage = requireArg(args, 'stage');
  const agent = requireArg(args, 'agent');
  const parallelGroup = args['parallel-group'] || null;

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

  const stepId = randomUUID();

  const addStepAndTracker = db.transaction(() => {
    db.prepare(`
      INSERT INTO steps (id, run_id, stage, agent, parallel_group, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'pending', datetime('now','localtime'))
    `).run(stepId, runId, stage, agent, parallelGroup);

    if (parallelGroup) {
      const existing = db.prepare(
        'SELECT * FROM fan_in_tracker WHERE run_id = ? AND parallel_group = ?',
      ).get(runId, parallelGroup);

      if (existing) {
        db.prepare(`
          UPDATE fan_in_tracker SET expected = expected + 1 WHERE run_id = ? AND parallel_group = ?
        `).run(runId, parallelGroup);
      } else {
        db.prepare(`
          INSERT INTO fan_in_tracker (run_id, parallel_group, expected, completed, any_rejected, results)
          VALUES (?, ?, 1, 0, 0, '[]')
        `).run(runId, parallelGroup);
      }
    }
  });

  addStepAndTracker();

  const step = db.prepare('SELECT * FROM steps WHERE id = ?').get(stepId);
  const result = { ...step };

  if (parallelGroup) {
    const fi = db.prepare(
      'SELECT * FROM fan_in_tracker WHERE run_id = ? AND parallel_group = ?',
    ).get(runId, parallelGroup);
    if (fi) {
      try { fi.results = JSON.parse(fi.results); } catch (_) { /* keep */ }
      fi.any_rejected = Boolean(fi.any_rejected);
      result.fan_in = fi;
    }
  }

  out(result);
}

function cmdCompleteStep(args) {
  const stepId = requireArg(args, 'step-id');
  const result = requireArg(args, 'result');

  if (!['approved', 'rejected', 'completed'].includes(result)) {
    fatal(`Invalid result "${result}". Must be one of: approved, rejected, completed`);
  }

  const summary = args['summary'] || null;
  const feedback = args['feedback'] || null;

  const step = db.prepare('SELECT * FROM steps WHERE id = ?').get(stepId);
  if (!step) fatal(`Step not found: ${stepId}`);

  const isRejected = result === 'rejected';
  const stepStatus = isRejected ? 'rejected' : 'completed';

  const completeStepTx = db.transaction(() => {
    db.prepare(`
      UPDATE steps
      SET status = ?, result_summary = ?, feedback = ?, completed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(stepStatus, summary, feedback, stepId);

    if (isRejected) {
      db.prepare(`
        UPDATE runs SET review_loop_count = review_loop_count + 1, updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(step.run_id);
    }

    // Update runs.updated_at even for non-rejection completions
    if (!isRejected) {
      db.prepare(`
        UPDATE runs SET updated_at = datetime('now','localtime') WHERE id = ?
      `).run(step.run_id);
    }

    if (step.parallel_group) {
      const currentResults = db.prepare(
        'SELECT results FROM fan_in_tracker WHERE run_id = ? AND parallel_group = ?',
      ).get(step.run_id, step.parallel_group);

      let resultsList = [];
      if (currentResults) {
        try { resultsList = JSON.parse(currentResults.results); } catch (_) { /* empty */ }
      }
      resultsList.push({ step_id: stepId, agent: step.agent, result, summary });

      db.prepare(`
        UPDATE fan_in_tracker
        SET completed = completed + 1,
            any_rejected = CASE WHEN ? THEN 1 ELSE any_rejected END,
            results = ?
        WHERE run_id = ? AND parallel_group = ?
      `).run(isRejected ? 1 : 0, JSON.stringify(resultsList), step.run_id, step.parallel_group);
    }
  });

  completeStepTx();

  const updatedStep = db.prepare('SELECT * FROM steps WHERE id = ?').get(stepId);
  const output = { ...updatedStep };

  // Per-stage rejection count (for "max 3 loops per review stage" rule)
  const stageRejectionCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM steps WHERE run_id = ? AND stage = ? AND status = 'rejected'",
  ).get(step.run_id, step.stage).cnt;
  output.stage_rejection_count = stageRejectionCount;
  if (stageRejectionCount >= 3) {
    output.escalation_recommended = true;
  }

  if (step.parallel_group) {
    const fi = db.prepare(
      'SELECT * FROM fan_in_tracker WHERE run_id = ? AND parallel_group = ?',
    ).get(step.run_id, step.parallel_group);
    if (fi) {
      try { fi.results = JSON.parse(fi.results); } catch (_) { /* keep */ }
      fi.any_rejected = Boolean(fi.any_rejected);
      fi.all_done = fi.completed >= fi.expected;
      output.fan_in = fi;
    }
  }

  out(output);
}

function cmdFanIn(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const group = requireArg(args, 'group');

  const fi = db.prepare(
    'SELECT * FROM fan_in_tracker WHERE run_id = ? AND parallel_group = ?',
  ).get(runId, group);

  if (!fi) fatal(`No fan-in tracker found for run=${runId} group=${group}`);

  let results = [];
  try { results = JSON.parse(fi.results); } catch (_) { /* empty */ }

  out({
    expected: fi.expected,
    completed: fi.completed,
    any_rejected: Boolean(fi.any_rejected),
    all_done: fi.completed >= fi.expected,
    results,
  });
}

// ---------------------------------------------------------------------------
// Dequeue helper: promote oldest queued run to active when a slot opens
// ---------------------------------------------------------------------------
function dequeueNext() {
  const activeCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE status = 'active'",
  ).get().cnt;

  if (activeCount < MAX_CONCURRENT_ACTIVE) {
    const queued = db.prepare(
      "SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1",
    ).get();

    if (queued) {
      db.prepare(
        "UPDATE runs SET status = 'active', updated_at = datetime('now','localtime') WHERE id = ?",
      ).run(queued.id);
      return { dequeued_run_id: queued.id, title: queued.title, type: queued.type };
    }
  }
  return null;
}

function cmdCompleteRun(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const status = args['status'] || 'completed';

  if (!['completed', 'failed'].includes(status)) {
    fatal(`Invalid status "${status}". Must be one of: completed, failed`);
  }

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

  db.prepare(`
    UPDATE runs SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(status, runId);

  const result = { run_id: runId, status, previous_status: run.status };

  // Auto-cleanup worktree on completion
  if (run.worktree_path) {
    result.worktree_cleanup = removeWorktree(runId);
  }

  // Pull latest changes into main repo after successful completion
  // (picks up the merged PR changes so the main checkout is not stale)
  if (status === 'completed' && run.worktree_path) {
    result.main_repo_pull = pullMainRepo();
  }

  // Check if a queued run can now start
  const dequeued = dequeueNext();
  if (dequeued) result.dequeued = dequeued;

  out(result);
}

function cmdEscalate(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const reason = requireArg(args, 'reason');

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

  db.prepare(`
    UPDATE runs SET status = 'escalated', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(runId);

  const result = { run_id: runId, status: 'escalated', reason, previous_status: run.status };

  // Check if a queued run can now start
  const dequeued = dequeueNext();
  if (dequeued) result.dequeued = dequeued;

  out(result);
}

function cmdDismiss(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const reason = args['reason'] || 'dismissed by operator';

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);

  db.prepare(`
    UPDATE runs SET status = 'dismissed', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(runId);

  const result = { run_id: runId, status: 'dismissed', reason, previous_status: run.status };

  // Check if a queued run can now start
  const dequeued = dequeueNext();
  if (dequeued) result.dequeued = dequeued;

  out(result);
}

function cmdPause(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (run.status !== 'active') {
    fatal(`Cannot pause run with status "${run.status}". Only active runs can be paused.`);
  }

  db.prepare(`
    UPDATE runs SET status = 'paused', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(runId);

  const result = { run_id: runId, status: 'paused', previous_status: run.status };

  // Pausing frees a slot — check if a queued run can start
  const dequeued = dequeueNext();
  if (dequeued) result.dequeued = dequeued;

  out(result);
}

function cmdResume(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (run.status !== 'paused') {
    fatal(`Cannot resume run with status "${run.status}". Only paused runs can be resumed.`);
  }

  // Check concurrency before resuming
  const activeCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM runs WHERE status = 'active'",
  ).get().cnt;

  if (activeCount >= MAX_CONCURRENT_ACTIVE) {
    // Queue instead of activating
    db.prepare(`
      UPDATE runs SET status = 'queued', updated_at = datetime('now','localtime') WHERE id = ?
    `).run(runId);
    out({ run_id: runId, status: 'queued', previous_status: 'paused', reason: 'Concurrency limit reached. Run queued.' });
  } else {
    db.prepare(`
      UPDATE runs SET status = 'active', updated_at = datetime('now','localtime') WHERE id = ?
    `).run(runId);
    out({ run_id: runId, status: 'active', previous_status: 'paused' });
  }
}

function cmdList(args) {
  const status = args['status'];
  const source = args['source'];

  const clauses = [];
  const params = [];

  if (status) { clauses.push('status = ?'); params.push(status); }
  if (source) { clauses.push('source = ?'); params.push(source); }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const runs = db.prepare(`SELECT * FROM runs${where} ORDER BY updated_at DESC`).all(...params);

  out(runs);
}

function cmdWorktree(args) {
  const runId = resolveRunId(requireArg(args, 'run-id'));
  const run = db.prepare('SELECT id, worktree_path FROM runs WHERE id = ?').get(runId);

  if (!run.worktree_path) {
    out({ run_id: runId, worktree_path: null, branch: branchName(runId), exists: false });
    return;
  }

  const exists = fs.existsSync(run.worktree_path);
  out({
    run_id: runId,
    worktree_path: run.worktree_path,
    branch: branchName(runId),
    exists,
  });
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------
const subcommand = process.argv[2];
const args = parseArgs(process.argv.slice(3));

const COMMANDS = {
  create: cmdCreate,
  status: cmdStatus,
  advance: cmdAdvance,
  'add-step': cmdAddStep,
  'complete-step': cmdCompleteStep,
  'complete-run': cmdCompleteRun,
  'fan-in': cmdFanIn,
  escalate: cmdEscalate,
  dismiss: cmdDismiss,
  pause: cmdPause,
  resume: cmdResume,
  list: cmdList,
  worktree: cmdWorktree,
};

if (!subcommand || !COMMANDS[subcommand]) {
  fatal(
    `Usage: pipeline.js <command> [options]\nCommands: ${Object.keys(COMMANDS).join(', ')}`,
  );
}

try {
  COMMANDS[subcommand](args);
} catch (err) {
  fatal(err.message || String(err));
} finally {
  db.close();
}
