---
Schema-Version: 1
Run-ID: 24919391-3857-458b-a416-90666443ede9
Stage: spec
Agent: tech-lead
Generated-At: 2026-02-16T18:39:44+04:00
---
# Technical Specification — Harness Engineering Adoption + Repo Relocation

**Run ID:** `24919391-3857-458b-a416-90666443ede9`  
**Stage:** `spec`  
**Author:** `tech-lead`  
**Date:** 2026-02-16

---

## 1) Scope and goals

Implement Phase-1/2-ready technical changes to:
1. Relocate active DocAlign repo path from `/Users/kotkot/Discovery/docalign` to `/Users/kotkot/docalign`.
2. Remove hard dependency on absolute local paths by introducing canonical repo-root resolution.
3. Enforce fail-closed path hygiene and baseline harness invariants in CI/local checks.
4. Establish stage-aware context contracts and artifact completeness gates to support deterministic agent operation.
5. Preserve rollback safety with explicit migration and break-glass procedures.

### Out of scope
- Net-new user-facing product capabilities unrelated to reliability and harness operation.
- Broad platform rewrite or architectural layer redesign beyond path/context/invariant harnessing.
- Historical artifact cleanup across all archives (active surfaces enforced now; archives handled separately).

---

## 2) Design principles (binding)

- **Fail-closed for core invariants:** path hygiene, required stage artifacts, and rule metadata are merge-blocking.
- **Single source of path truth:** all tooling resolves repo root via shared resolver utility.
- **Deterministic checks:** no network/time-dependent behavior in blocking checks.
- **Auditable exceptions:** any bypass requires named human approver + expiry + follow-up ticket.
- **Bounded compatibility window:** symlink compatibility is temporary and sunset-enforced.

---

## 3) Architecture changes

### 3.1 Canonical repo-root resolver

Create a shared resolver utility consumed by scripts, checks, and agent helpers.

**Contract:**
- Input: optional override env (`DOCALIGN_REPO_ROOT`), runtime cwd.
- Behavior:
  1. If override env set, validate path exists and contains repo sentinel(s) (e.g., `.git` and required project marker file).
  2. Else walk upward from cwd until sentinel found.
  3. Normalize path realpath; reject if outside allowed filesystem scope.
- Output: absolute canonical root path.
- Errors: explicit actionable messages (missing sentinel, invalid override, permission denied).

**Required migration:** replace direct references to `/Users/kotkot/Discovery/docalign` and ad-hoc path joins with resolver calls.

### 3.2 Path hygiene invariant

Add blocking check `check:path-hygiene`:
- Scans active files (source, scripts, configs, active docs) for forbidden absolute prefix `/Users/kotkot/Discovery/docalign`.
- Excludes explicit allowlist paths (migration ledger/archive buckets only).
- Fails with file/line output and remediation hint.

### 3.3 Required artifact invariant

Add blocking check `check:stage-artifacts`:
- Verifies required stage documents exist for active run transitions (decision/spec/review outputs as configured).
- Ensures non-empty content and minimum headers for parseability.

### 3.4 Stage context contract files

Define stage-specific context manifests (debate/define/spec/build):
- Inputs allowed by stage.
- Required prior artifacts.
- Forbidden context classes (to reduce overload/drift).
- Validation command for orchestrator preflight.

### 3.5 Migration tooling

Add scripts:
- `scripts/migration/preflight-path-audit.(ts|js)` — inventory and classify old-path references.
- `scripts/migration/relocate-repo.(sh|ts)` — controlled move/cutover flow.
- `scripts/migration/rollback-repo.(sh|ts)` — restore prior path or temporary compatibility mode.

### 3.6 Observability baseline (Phase-2-ready)

Add structured logging for checks:
- check name, duration_ms, outcome, violating_files_count.
- deterministic schema version field.
- emitted locally + CI summary artifact.

---

## 4) File-level implementation plan

> Exact paths may be adjusted to current repo layout; intent and contracts are mandatory.

1. `src/lib/repoRootResolver.ts` (new)
   - Implement resolver API and validation.
2. `src/lib/pathPolicy.ts` (new)
   - Forbidden prefixes, allowlist loader, scope matcher.
3. `scripts/checks/path-hygiene.ts` (new)
   - Blocking invariant command.
4. `scripts/checks/stage-artifacts.ts` (new)
   - Blocking artifact completeness command.
5. `scripts/migration/preflight-path-audit.ts` (new)
6. `scripts/migration/relocate-repo.sh` (new)
7. `scripts/migration/rollback-repo.sh` (new)
8. `config/stage-context/*.yml` (new)
   - `debate.yml`, `define.yml`, `spec.yml`, `build.yml`.
9. `package.json` (update)
   - Add scripts: `check:path-hygiene`, `check:stage-artifacts`, `migration:preflight`, `migration:relocate`, `migration:rollback`.
10. CI workflow file(s) (update)
   - Add fail-closed gates for path hygiene + stage artifacts.
11. `AGENTS.md` / docs index files (update)
   - Root-relative references and context contract pointers.
12. `docs/runbooks/repo-relocation.md` (new)
   - Cutover + rollback + exception procedure.

---

## 5) Interfaces and command contracts

### Resolver API
```ts
resolveRepoRoot(opts?: { cwd?: string; overrideEnv?: string }): { root: string; source: 'env' | 'cwd-walk' }
```

### Path hygiene command
```bash
npm run check:path-hygiene
# exit 0 = pass
# exit 1 = violations found (with file:line list)
# exit 2 = execution/config error
```

### Stage artifact command
```bash
npm run check:stage-artifacts -- --run-id <id> --stage <stage>
```

### Migration commands
```bash
npm run migration:preflight
npm run migration:relocate
npm run migration:rollback
```

---

## 6) Test strategy

### Unit tests
- resolver: env override valid/invalid, cwd walk, sentinel miss, symlink normalization.
- path policy matcher: allowlist/exclude behavior, forbidden prefix detection.
- stage artifact validator: missing file, empty file, malformed header, valid artifact.

### Integration tests
- simulate repo at new path and verify all key scripts operate.
- run full check suite with intentional old-path fixture; assert fail-closed.
- validate migration scripts idempotency and rollback behavior.

### Canary scenarios
- symlink-heavy tree
- restricted permission directory encountered during scan
- monorepo-like nested workspace

### Performance budgets
- path-hygiene check target < 3s on standard repo size.
- stage-artifact check target < 1s.

---

## 7) Rollout sequence

1. Merge resolver + non-enforcing preflight checks.
2. Refactor active scripts/config/docs to resolver/root-relative references.
3. Execute relocation to `/Users/kotkot/docalign` in approved window.
4. Enable temporary compatibility symlink (`/Users/kotkot/Discovery/docalign -> /Users/kotkot/docalign`).
5. Run validation suite (typecheck/tests/checks + one orchestrator flow smoke).
6. Turn on fail-closed gates in CI.
7. Sunset and remove compatibility symlink after stable window.

---

## 8) Risk mitigation mapping

- **Hidden absolute paths:** preflight inventory + fail-closed path-hygiene gate.
- **Migration breakage:** scripted relocate/rollback + tested break-glass procedure.
- **Guardrail bypass pressure:** runtime budgets + clear errors + mandatory CI gating.
- **Context drift:** stage-context manifests validated pre-spawn.
- **False positives from archives:** scoped active-surface scanning + explicit allowlist.

---

## 9) Acceptance criteria (spec completion)

1. Shared repo-root resolver exists and is used by all active automation entrypoints.
2. No active required references to `/Users/kotkot/Discovery/docalign` remain.
3. Blocking checks for path hygiene and stage artifact completeness are active in CI.
4. Migration runbook and rollback commands are present and test-verified.
5. Stage context manifests for debate/define/spec/build exist and pass validation.
6. One end-to-end smoke run from new path succeeds with evidence attached.

---

## 10) Review focus for `spec_review`

PM/Critic should verify:
- Scope discipline (no unrelated platform expansion).
- Completeness of rollback and exception governance.
- Determinism/performance of blocking checks.
- Adequate handling of archive exclusions without weakening active guardrails.
- Explicit human gates for cutover and correction-first exceptions.
