# Phase 2.5 Audit Findings — Phase 3 Input

> Generated from 10-reviewer PRD audit (2026-02-11). Items triaged as "Phase 3" — architecture, implementation, and design decisions that belong in the Architecture Design Document phase, not the PRD.

## How to Use This Document

Each item below was identified by one or more specialized reviewers but triaged as out-of-scope for the PRD. These are **direct inputs** to Phase 3 artifacts. When writing each Phase 3 document, use the relevant section below as a checklist.

---

## 1. Security Threat Model (`phase3-security.md`)

### Authentication & Token Management

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| S1 | **Webhook replay protection:** Add timestamp validation (reject webhooks >5 min old), pin to SHA-256 algorithm, define key rotation procedure with zero-downtime | Security reviewer | Pre-launch |
| S2 | **Clone token exposure:** Use `GIT_ASKPASS` or Git credential helper instead of embedding installation token in clone URL. Never log clone commands. | Security reviewer | Pre-launch |
| S3 | **HMAC dismiss token:** Define construction: `HMAC-SHA256(DOCALIGN_API_SECRET, "dismiss_all:{repo_id}:{pr_number}:{timestamp}")`. Add 7-day expiry. Validate on click. | Security, Integration reviewers | Pre-launch |
| S4 | **MCP `report_drift` authentication:** Require authenticated API calls. Options: GitHub OAuth for agent tools, per-repo MCP token, or IP allowlist for local mode. | Security reviewer | Pre-launch |
| S5 | **Agent Task API token lifecycle:** Define token generation, rotation (90-day max), per-repo scoping, revocation procedure. Currently PRD says "API token" but no lifecycle spec. | Security, Enterprise reviewers | Pre-launch |
| S6 | **JWT signing key rotation:** Document procedure — generate new key, update Railway env, restart workers within 10 min, revoke old key in GitHub App settings. | Security reviewer | Pre-launch |

### Input Validation & Injection

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| S7 | **Prompt injection via XML entities:** Escape `<`, `>`, `&`, `"`, `'` in all variables interpolated into XML-structured LLM prompts (P-VERIFY, P-EXTRACT). Or switch to JSON structure. | Security reviewer | Pre-launch |
| S8 | **ReDoS in FILE_PATH_PATTERNS:** Add timeout (500ms) to regex execution. Limit input line length. Rewrite nested quantifier patterns. | Adversarial reviewer | Pre-launch |
| S9 | **Markdown injection in PR comments:** Sanitize all user-controlled strings in PR comment templates. Reject `javascript:` URLs. Escape markdown special characters. | Security reviewer | Pre-launch |
| S10 | **Log injection:** Escape newlines and JSON control characters in all log message fields. Use logging library with safe mode (e.g., `pino` with `safe: true`). | Security reviewer | v2 |
| S11 | **Code injection via sub-claim extraction:** Validate extracted imports against import syntax patterns. Reject shell-like code in import extraction. Treat bash code blocks as `command` sub-claims only. | Adversarial reviewer | Pre-launch |

### Data Protection

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| S12 | **Row-level security:** Implement PostgreSQL RLS policies scoped by `repo_id` on all tables. Prevents cross-tenant data exposure if SQL injection exists. | Security reviewer | Pre-launch |
| S13 | **Secrets in entity code:** Warn users in setup docs that DocAlign sends code to their LLM provider. Consider secret detection pass before evidence assembly (regex for `API_KEY=`, passwords, base64 blobs). | Security reviewer | Pre-launch |
| S14 | **GitHub Action API key logging:** Mask secrets in Action error handling (`core.setSecret()`). Test error paths to ensure no leaks in public CI logs. | Security reviewer | Pre-launch |
| S15 | **Installation token caching:** Tokens cached in memory without encryption. If container compromised, tokens expose all installed repos. Consider per-process ephemeral encryption key. | Security reviewer | v2 |
| S16 | **Uninstall audit gap:** Hard delete on uninstall destroys all evidence. Consider soft delete with 30-day retention, archive to cold storage. Log all uninstall events. | Security reviewer | v2 |

### Abuse Prevention

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| S17 | **BullMQ job ID predictability:** Job IDs are `pr-scan-{repo_id}-{pr_number}` — predictable. Use HMAC-based job IDs to prevent enumeration/cancellation attacks. | Security reviewer | v2 |
| S18 | **Dismiss API rate limiting:** Max 5 dismissals per IP per PR per hour. Prevents feedback table pollution and count-based suppression gaming. | Security reviewer | Pre-launch |
| S19 | **Rate limit bypass via reinstall:** Key rate limits on `github_installation_id` (persists across uninstall/reinstall). Add per-account scan limit. | Security reviewer | v2 |

---

## 2. System Architecture (`phase3-architecture.md`)

### Concurrency & Race Conditions

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| A1 | **Agent Task API polling collision:** Two Action runs grab the same task. Need `claimed_by` field (action_run_id). `GET /api/tasks/pending` filters by `claimed_by IS NULL`. `POST /result` returns 409 if already completed by different run. | Adversarial reviewer | Pre-launch |
| A2 | **Agent task expiration race:** Action polls at T+29:58, task expires at T+30:00, agent works 5 min, result rejected. Fix: extend `expires_at` when task is polled/assigned. | Adversarial reviewer | Pre-launch |
| A3 | **Rename detection in incremental index:** Git diff must use `--name-status` to detect renames. Update both `code_entities.file_path` and `claim_mappings.code_file` in same transaction. | Adversarial reviewer | Pre-launch |
| A4 | **Co-change retention purge race:** Purge job must not delete records referenced by active mappings. Or: snapshot co-change boost into mapping confidence at creation time (denormalize). | Adversarial reviewer | v2 |
| A5 | **Uninstall during active scan:** Cancel all in-progress and queued jobs BEFORE deleting data. `queue.removeJobs()` filtered by repo_id, then delete data. | Adversarial reviewer | Pre-launch |
| A6 | **Transaction boundaries:** Wrap entire verification batch write in a single transaction. If any row fails, rollback all, mark scan `failed`, save partial results separately. | Adversarial reviewer | Pre-launch |
| A7 | **BullMQ cancellation granularity:** Define "stage boundaries" for worker cancellation checks. Recommend: after L0 update, after claim extraction, after each verification batch of 10 claims. | Clarity reviewer | Pre-launch |

### Integration Contracts

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| A8 | **Repository dispatch event payload:** Define event type, payload schema (repo_id, scan_type, task_ids), and how the Action receives/parses it. | Completeness reviewer | Pre-launch |
| A9 | **Sub-claim mapping interface:** Reconcile L1 (`sub_claim_ids` array) vs technical-reference (`imports[], symbols[], commands[]`). Decide: are sub-claims separate DB rows with own IDs, or nested JSON in parent `extracted_value`? | Integration reviewer | Pre-launch |
| A10 | **Suppression rules in claim extraction:** L1 should query suppression_rules during re-extraction. If claim text+type+file combination is suppressed, skip creating new claim record. L4 should also filter before verification. | Integration reviewer | Pre-launch |
| A11 | **Post-check result display:** L5 should specify: if `post_check_result === 'contradicted'`, downgrade severity or mark "needs review." Display status in finding details. | Integration reviewer | v2 (Tier 5 is v2) |
| A12 | **Deleted doc file cleanup:** L4 should detect deleted doc files in PR diff and trigger claim deletion, not re-extraction. Prevent orphaned claims in DB. | Integration reviewer | Pre-launch |
| A13 | **Agent result handling:** Define behavior when agent returns freeform text, refuses to answer, or returns partial results. Validate against `VerificationResult` schema. | Integration, Clarity reviewers | Pre-launch |
| A14 | **Entity line count for routing:** Add `entity_line_count` to `claim_mappings` table, or document that routing queries `code_entities` join on the fly. | Integration reviewer | Pre-launch |
| A15 | **Dependency version lookup format:** L0 `getDependencyVersion()` should return resolved version from lock file if available, else specifier from package.json. Document explicitly. | Integration reviewer | Pre-launch |
| A16 | **MCP server database connection:** Define how MCP server authenticates to PostgreSQL: `DOCALIGN_DATABASE_URL` env var → `.docalign/config.json` → prompt on first run. | Integration reviewer | Pre-launch |

### Specification Gaps to Resolve

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| A17 | **Claim prioritization formula:** When claims exceed max-per-PR (50), define exact priority: severity score (H=3, M=2, L=1) × confidence, descending. | Clarity reviewer | Pre-launch |
| A18 | **"Same claim" for count-based exclusion:** Define: same `claim_id` (database record). Not same text across files. Deduplicated claims share one ID, so one dismissal covers all source locations. | Clarity reviewer | Pre-launch |
| A19 | **Version comparison edge cases:** Define handling for "18+" (strip +, treat as >=18), semver ranges in docs (treat as literal text, not semver), "~18.2.0" / "^18.0.0" (compare against resolved version, not specifier). | Clarity reviewer | Pre-launch |
| A20 | **Auto-detect project structure failure:** Define: failure = LLM returns invalid JSON or times out after 30s. Action submits `{ status: 'failed' }` to API. Server applies fallback (`**` with standard excludes). Log warning. | Clarity reviewer | Pre-launch |
| A21 | **Monorepo version match order:** Define: check manifest files closest to repo root first (shortest path), then alphabetically. Return first match. | Clarity reviewer | Pre-launch |
| A22 | **Path 1 evidence token cap:** Enforce `path1_max_evidence_tokens` config (default: 4000). If evidence exceeds, route to Path 2 with reason `evidence_too_large`. | Adversarial reviewer | Pre-launch |
| A23 | **Same-file type signature limit:** Cap at 3 type definitions or 100 lines total in Path 1 evidence. Include only types directly in entity signature, not transitive. | Adversarial reviewer | Pre-launch |
| A24 | **Agent file exploration limit:** Add `max_agent_files_per_claim` config (default: 15). If agent exceeds, abort with `uncertain` + reason "investigation too broad." | Adversarial reviewer | Pre-launch |
| A25 | **Agent unavailable banner:** If >20% of claims skipped due to agent unavailability, add prominent banner at top of PR comment instead of small footer note. | Adversarial reviewer | Pre-launch |

---

## 3. Infrastructure & Deployment (`phase3-infrastructure.md`)

### Scalability

| ID | Issue | Source | Breaking Point |
|----|-------|--------|----------------|
| I1 | **Per-repo queue serialization:** Switch to per-org concurrency limits (allow N repos in parallel, N=5 default). Current model bottlenecks at ~50 active repos. | Scalability reviewer | 30-50 customers |
| I2 | **PostgreSQL connection pooling:** Add pool with max size 20, idle timeout 30s. Add connection retry with exponential backoff. Railway's 100-connection limit hits at ~40-60 active repos. | Scalability reviewer | 5-10 customers |
| I3 | **tree-sitter memory monitoring:** Add per-job memory monitoring. Kill jobs exceeding 200MB. Reduce concurrency to 2 for full scans (keep 5 for PR scans). 5 concurrent full scans exceed 512MB container. | Scalability reviewer | 20-30 customers |
| I4 | **Org-wide onboarding UX:** Post progress GitHub issue in each repo. Prioritize repos by last commit date. Allow repo selection during install. 50-repo org takes 75+ min currently. | Scalability reviewer | First enterprise |
| I5 | **Agent task cleanup:** Run cleanup job hourly that deletes expired tasks older than 48 hours (not 30 days). Add index on `(status, expires_at)`. | Scalability reviewer | 50-100 customers |
| I6 | **GitHub API rate limits:** Batch review comments in single `POST /pulls/{pr}/reviews` call (already spec'd). Use GraphQL where possible. Request higher limits from GitHub for verified app. | Scalability reviewer | 50-100 customers |
| I7 | **Redis rate limit optimization:** Use atomic `INCR` for counters (not GET+SET). Cache org rate limit status in memory for 60s. | Scalability, Adversarial reviewers | Pre-launch |
| I8 | **HNSW vector index partitioning:** At 50K repos, partition `code_entities` by `repo_id`. Two-stage search: filter by repo, then vector search within subset. | Scalability reviewer | 1000+ customers |
| I9 | **Verification results table partitioning:** At 100K repos, partition by `created_at` (monthly). Drop old partitions instead of DELETE. | Scalability reviewer | 5000+ customers |

### Deployment & Operations

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| I10 | **Configuration validation visibility:** On invalid `.docalign.yml`, log warning AND post note in PR summary comment: "Configuration warning: [field] invalid, using default." | Clarity reviewer | Pre-launch |
| I11 | **tree-sitter 4+ language handling:** Define LRU eviction strategy when repo uses more than 3 languages. Unload least-recently-used grammar, load new one. | Completeness reviewer | Pre-launch |
| I12 | **Migration rollback scripts:** Define location (same directory as migration files, named `rollback-NNN.sql`), naming convention, and testing requirement. | Completeness reviewer | Pre-launch |
| I13 | **Healthcheck queue depth definition:** `queue_depth` = count of all pending + in-progress jobs across all repos. Single number for monitoring. | Completeness reviewer | Pre-launch |
| I14 | **Retry timing per error type:** Standardize: all retries use same exponential backoff (1s, 4s, 16s) regardless of error type. Per-call retries: 2 attempts. Per-job retries: 3 attempts. | Completeness reviewer | Pre-launch |

---

## 4. Error Handling (`phase3-error-handling.md`)

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| E1 | **LLM malformed response handling:** Retry once on JSON parse failure. On second failure, log full raw output + claim context. Mark claim as `uncertain` with reason `llm_parse_error`. Alert if >10% of verifications fail parsing. | Adversarial reviewer | Pre-launch |
| E2 | **Agent claims with deleted mapped files:** When file-mapped claim points to deleted file, verdict = `uncertain` with reason "mapped file not found." Do NOT delegate to agent (no valid starting point). | Adversarial reviewer | Pre-launch |
| E3 | **Force push during scan:** Store `commit_sha` in `scan_runs`. If PR HEAD changes between scan start and result posting, prepend warning in summary comment: "Results are from commit `abc123`. PR has been updated since." | Adversarial reviewer | Pre-launch |
| E4 | **Partial scan timeout behavior:** Define per-layer completion: a layer is "complete" if all its inputs were processed. Partial L1 = save extracted claims for completed doc files. Partial L3 = save completed verification results. | Clarity reviewer | Pre-launch |
| E5 | **Debounce cancellation vs failure:** Specify: debounce cancellation does not count as a failure. Retries apply only to job execution failures (errors, timeouts), not cancellations. | Consistency reviewer | Pre-launch |

---

## 5. Integration Specs (`phase3-integration-specs.md`)

| ID | Issue | Source | Priority |
|----|-------|--------|----------|
| G1 | **Review comment marker format:** Define exact marker: `<!-- docalign-review-comment claim-id={claim_id} scan-run-id={scan_run_id} -->` at end of comment body. Add to technical-reference Section 3.6 PR comment template. | Integration, Completeness reviewers | Pre-launch |
| G2 | **Fix acceptance detection:** Primary: webhook `pull_request_review` events. Fallback: on next push, diff changed doc file against suggested fixes (substring match allowing minor edits). Webhook is fast path; diff is authoritative. | Integration reviewer | Pre-launch |
| G3 | **L0 file tree format:** `getFileTree()` returns flat array of relative paths (from repo root), sorted alphabetically. All paths use forward slashes. | Integration reviewer | Pre-launch |
| G4 | **Evidence format template:** Reference Spike B Section 5.1 `formatEvidence()` in L3. Format: file path header + imports block + entity code block + optional type signatures. | Consistency reviewer | Pre-launch |
| G5 | **Co-change tracking in PRs:** L4 PR scan should also call `recordCoChanges()` for the PR's commits, enabling immediate mapper confidence boost before merge. | Integration reviewer | v2 |
| G6 | **Embedding dimension change handling:** If `llm.embedding_model` changes, require full re-index (all embeddings regenerated). Add validation: embedding dimension must match across claims and code_entities. | Integration reviewer | Pre-launch |
| G7 | **Zero-findings vs no-claims-in-scope:** L5 should distinguish: "No claims needed verification" (PR didn't touch relevant files) vs "N claims verified, 0 issues" (PR touched files, all verified). | Integration reviewer | Pre-launch |
| G8 | **Syntax validation language coverage:** L1 syntax validation only runs for languages supported by L0 tree-sitter grammars. Unsupported language code blocks: skip validation (not a failure). | Integration reviewer | Pre-launch |

---

## 6. Enterprise Requirements (Post-MVP)

These were flagged by the Enterprise Advocate reviewer. They are NOT Phase 3 items — they are future product requirements for enterprise adoption. Captured here for completeness.

| ID | Issue | When Needed |
|----|-------|-------------|
| ENT1 | Data residency controls (EU/US region selector) | Before first EU customer |
| ENT2 | Immutable audit log (SOX/HIPAA/PCI-DSS) | Before enterprise sales |
| ENT3 | RBAC with roles (Admin, Maintainer, Viewer) | Before enterprise sales |
| ENT4 | Data export API + 30-day grace period on uninstall | Before enterprise sales |
| ENT5 | Cost control (monthly caps, pre-scan estimates, alerts) | Public beta |
| ENT6 | Proxy support + egress documentation | Before enterprise sales |
| ENT7 | SSO/SAML integration (Pro tier) | Before enterprise sales |
| ENT8 | Self-hosted deployment option (Docker/Helm) | Before enterprise sales |
| ENT9 | SLA commitment + graceful degradation | Before enterprise sales |
| ENT10 | Bulk onboarding tooling (centralized config, auto-setup) | Before enterprise sales |
| ENT11 | Suppression rule management UI | v2 |

---

## Summary

| Category | Items | Pre-launch | v2 | Post-MVP |
|----------|-------|------------|-----|----------|
| Security | 19 | 14 | 5 | 0 |
| Architecture | 25 | 22 | 3 | 0 |
| Infrastructure | 14 | 10 | 0 | 4 |
| Error Handling | 5 | 5 | 0 | 0 |
| Integration | 8 | 7 | 1 | 0 |
| Enterprise | 11 | 0 | 1 | 10 |
| **Total** | **82** | **58** | **10** | **14** |

58 items to address before launch across 5 Phase 3 documents.
