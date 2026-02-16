# Decision Document — Feature 42087d49-5c2f-4af0-a98e-725ed4db2a9f

## Title
Apply Harness Engineering patterns to DocAlign + relocate repo path

## Status
Debate converged in Round 2 to **BUILD WITH MODIFICATIONS**.

## Inputs reviewed
- CEO directive
- OpenAI blog post: https://openai.com/index/harness-engineering/
- Debate Round 1 personas: PM, Tech Lead, Critic, GTM
- Debate Round 2 targeted resolution: Critic

## Extracted Harness Engineering patterns (from blog) → Concrete DocAlign decisions

1) **Humans steer, agents execute**
- Decision: keep humans focused on acceptance criteria, stage gates, and risk approvals; workers produce artifacts.
- Implementation: every stage output must be a versioned artifact under `_team/outputs/<run>/<stage>/`.

2) **Engineer role shifts to environment + feedback loops**
- Decision: invest in deterministic harnesses rather than prompt-only workflows.
- Implementation: add a `RepoContext` + execution harness contract (`runId`, `stage`, `agent`, `repoRoot`) with normalized outputs/logs.

3) **Application/system legibility for agents**
- Decision: make runtime evidence first-class (logs/metrics/test traces) for agent verification.
- Implementation: include structured logs and stage manifests so outcomes are auditable, not narrative.

4) **Repo knowledge as system of record (AGENTS as map, docs as source of truth)**
- Decision: keep AGENTS short and pointer-based; move operational truth into structured in-repo docs.
- Implementation: add doc linting/gardening checks for stale instructions and broken cross-links.

5) **Agent legibility over human style preference**
- Decision: prioritize predictable, composable architecture and in-repo discoverability.
- Implementation: prefer explicit domain boundaries and stable interfaces over ad-hoc patterns.

6) **Enforce invariants mechanically**
- Decision: encode guardrails in lint/tests, not prose only.
- Implementation: enforce path resolution via a single module, schema-validated boundaries, naming/logging constraints.

7) **High-throughput merge philosophy with safe correction loops**
- Decision: keep changes small and reversible; accept follow-up corrections where appropriate.
- Implementation: phased rollout + fast revert/kill-switch for relocation/harness regressions.

8) **Autonomy requires entropy control (continuous cleanup)**
- Decision: create recurring cleanup tasks for drift and stale docs.
- Implementation: periodic “doc drift” and structure quality checks with small auto-fix PRs.

## Repo relocation strategy
Move from:
- `/Users/kotkot/Discovery/docalign`
To:
- `/Users/kotkot/docalign`

### Migration plan
1. Introduce `RepoContext` resolver (single source of truth for repo root).
2. Replace hardcoded absolute paths across scripts/CI/tools with resolver/env-based paths.
3. Enable dual-path compatibility during transition (legacy + new path).
4. Run parity checks in CI for both paths.
5. Flip default to new path after parity confidence.
6. Remove legacy-path support after stabilization window.

### Rollback plan
- Feature flag (`REPO_CONTEXT_V2`) controls resolver activation.
- On resolver/path failures, auto-fallback to legacy path and mark run degraded.
- One-command rollback: disable new resolver flag in CI/local environment.

## Risk mitigation requirements (Round 2 convergence conditions)
The critic moved from reject to build-with-modifications, contingent on the following **hard gates**:

1. Fail-closed semantics (never report PASS on inconclusive scans)
2. Bounded execution controls (timeouts, depth/size caps, cycle detection)
3. Idempotent concurrency controls (locking/conflict-safe writes/dedup retries)
4. Adversarial validation suite before release (rate limits, malformed docs, large repos, permission issues, concurrent runs)
5. Observability release gates (error taxonomy, fallback telemetry, latency/SLO thresholds, immutable run manifests)
6. Phased rollout with kill switch and explicit rollback playbook

## Debate summary
- **Round 1**: PM/Tech Lead/GTM approve; Critic rejects (missing reliability controls).
- **Round 2**: Critic changes to **build with modifications** if reliability/operability conditions are explicit and mandatory.
- **Converged recommendation**: proceed with constrained implementation under mandatory safeguards above.

## Recommendation to CEO
Approve this feature decision for progression to next planning stage, with explicit condition that reliability controls and relocation safeguards are treated as release-blocking acceptance criteria.

## Approval gate requested
**CEO approval required before proceeding to spec stage.**
