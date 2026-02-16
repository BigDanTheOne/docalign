# Research Synthesis: OpenAI Harness Engineering Patterns → DocAlign

Source reviewed: https://openai.com/index/harness-engineering/

## Candidate patterns extracted and tailored to DocAlign

1. **Engineer role shift: intent + feedback loops over direct coding**
   - DocAlign implication: strengthen pipeline orchestration, acceptance criteria quality, and auto-review loops rather than adding ad-hoc manual code edits.

2. **Repository as system of record (AGENTS as map, docs as source of truth)**
   - DocAlign implication: keep `AGENTS.md` concise; formalize `_team/docs` as canonical knowledge, including architecture maps, runbooks, and decision logs.

3. **Progressive disclosure of context**
   - DocAlign implication: avoid giant prompt blobs; provide index docs and stage-specific references (debate/define/spec/build) to reduce context noise.

4. **Mechanical enforcement of invariants**
   - DocAlign implication: add lint/test guardrails for architecture boundaries, naming conventions, logging schema, and migration safety constraints.

5. **Agent legibility first**
   - DocAlign implication: move tacit knowledge (Slack/chat) into versioned repo docs; ensure agents can discover path conventions, release procedures, and pipeline policies.

6. **Observability and app legibility for agents**
   - DocAlign implication: expose deterministic local logs/metrics and harness scripts so agents can self-validate changes and regression risk.

7. **Short-lived PRs + correction-friendly merge philosophy**
   - DocAlign implication: smaller changesets with fast follow-up fixes; enforce rollback-ready migrations for risky changes.

8. **Continuous garbage collection (quality gardening)**
   - DocAlign implication: scheduled cleanup tasks for stale docs, drifted rules, dead scripts, and anti-pattern propagation.

9. **Boundary strictness + local autonomy**
   - DocAlign implication: strict package/layer dependency rules, freedom within modules; explicit “providers” interfaces for cross-cutting concerns.

10. **Treat agent failures as missing capability signals**
   - DocAlign implication: when runs fail, encode missing tooling/docs/checks into repo, not one-off manual workarounds.

## Migration-specific implications for path relocation

- Replace hardcoded absolute paths (`/Users/kotkot/Discovery/docalign`) with discoverable workspace-root resolution.
- Add relocation validation checks in CI/scripts to detect stale path references.
- Provide migration script + rollback script for path transition.
- Update all pipeline/skills references to new root (`/Users/kotkot/docalign`) in one atomic migration plan.
- Record migration decision log in repo docs for agent discoverability.

## Initial recommendation

Adopt all 10 patterns in staged form, prioritizing (a) repo legibility docs, (b) mechanical invariants, (c) relocation safety harness, then (d) observability/harness depth improvements.