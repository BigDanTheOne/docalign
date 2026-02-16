VERDICT: build with modifications

KEY_CLAIMS:
- The pattern set is directionally correct, but “adopt all 10 patterns” as a broad mandate is too ambiguous and likely to fail without strict sequencing, ownership, and measurable acceptance gates.
- The highest-probability failure is not technical implementation but process drift: creating docs/guardrails that are not continuously enforced, producing a false sense of safety while real behavior remains unchanged.
- Repo relocation from `/Users/kotkot/Discovery/docalign` to `/Users/kotkot/docalign` is a high-risk change because latent absolute paths can exist in scripts, CI configs, shell history snippets, generated artifacts, agent instructions, and local automation; incomplete migration can silently break scan/check workflows.
- Mechanical invariants are valuable only if they are deterministic, fast, and mandatory in CI; otherwise teams will bypass them under delivery pressure.
- Progressive disclosure can reduce context overload, but if index docs are stale or fragmented, agents may make confidently wrong decisions from partial context.
- “Short-lived PR + fast correction” is safe only with explicit rollback playbooks and data/schema reversibility; otherwise rapid merges can amplify incident frequency.

CONDITIONS:
- Define a phased rollout with hard entry/exit criteria: Phase 1 (path relocation + detection harness), Phase 2 (invariant enforcement), Phase 3 (observability + GC routines). No phase overlap until previous phase SLOs pass.
- Treat relocation as an atomic migration with a freeze window: complete global search-and-replace, run scripted validation, and cut over once; avoid prolonged dual-path operation.
- Add non-negotiable stale-path detection in CI and pre-commit (fail on `/Users/kotkot/Discovery/docalign` references except an explicit migration ledger/allowlist).
- Require a canonical workspace-root resolver utility and ban new absolute path usage via lint rule; all scripts/tools must consume the resolver.
- Implement rollback-ready migration safeguards: snapshot/backup, idempotent move script, verified rollback script, and documented break-glass procedure tested at least once.
- Enforce guardrails as blocking checks with performance budgets (e.g., fast-fail lint under fixed runtime threshold) to prevent mass bypass due to slow pipelines.
- Add ownership and freshness controls for legibility docs (named owner + max staleness window + CI check for required doc sections/version stamps).
- Instrument failure taxonomy: every agent/run failure must map to a tracked capability gap with remediation ticket, SLA, and closure evidence.
- Require canary validation on representative repo shapes (small repo, large monorepo, symlink-heavy tree, restricted-permission directories) before general rollout.

RISKS:
- Silent breakage risk: hidden absolute paths in shell scripts, cron/launchd tasks, agent configs, and cached artifacts cause intermittent failures after relocation.
- Non-determinism risk: environment-dependent path resolution (symlinks, case sensitivity assumptions, HOME overrides) yields “works on one machine” behavior.
- Security risk: over-broad search/replace or path normalization may accidentally widen file access boundaries, allowing scans outside intended repo root.
- Reliability risk: new invariant checks can create flaky CI if they depend on network/time/local state; teams may disable checks, eroding trust.
- Process risk: documentation-first changes can become documentation-only changes; without enforcement hooks, agent behavior won’t improve.
- Regression risk: aggressive short PR cadence without contract tests for scan/check CLI can ship drift-detection regressions faster than they’re detected.
- Migration coordination risk: local developer tooling and automation may continue writing old paths, reintroducing deprecated references after cutover.
- Observability gap risk: if logs/metrics are added without stable schema/versioning, analysis tooling breaks and incident triage worsens.
- Garbage-collection risk: automated cleanup can remove “rare but critical” scripts/docs absent explicit protection tags and restore procedure.

CONFIDENCE: high
