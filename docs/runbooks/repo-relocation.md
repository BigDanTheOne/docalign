---
title: "Repo Relocation Runbook"
summary: "Operational runbook for relocating the DocAlign repository, including rollback triggers, symlink governance, and evidence checklist."
description: "Defines owner (Tech Lead) and on-call role (EOC-primary). Hard rollback triggers: smoke command failure, check:path-hygiene or check:stage-artifacts non-zero, resolver errors, P1 incident or blocked CI >30 minutes. Rollback command: npm run migration:rollback. Compatibility symlink: /Users/kotkot/Discovery/docalign -> /Users/kotkot/docalign, 7-day sunset SLA, extension requires CEO approval. Build-exit evidence checklist: CI logs, local smoke proof, runbook execution record."
category: reference
read_when:
  - You are executing a repository relocation for DocAlign
  - You need to know when to trigger a rollback during relocation
  - You need to validate that the relocation completed successfully
related: []
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# Repo Relocation Runbook

## Owner / on-call
- Change owner: **Tech Lead (DocAlign)**
- On-call role: **Engineering On-call (EOC-primary)**

## Rollback trigger thresholds (hard triggers)
1. Smoke command failure count >= 1 after cutover.
2. `check:path-hygiene` or `check:stage-artifacts` non-zero in post-cutover validation.
3. Resolver errors (`Unable to resolve repo root` or sentinel validation failures) in any build/test command.
4. Any P1 incident or blocked CI for > 30 minutes attributable to relocation.

If any trigger fires: execute `npm run migration:rollback` immediately and page on-call.

## Compatibility symlink governance
<!-- docalign:semantic id="semantic-rr-symlink" claim="Compatibility symlink: /Users/kotkot/Discovery/docalign -> /Users/kotkot/docalign" -->
- Temporary symlink: `/Users/kotkot/Discovery/docalign -> /Users/kotkot/docalign`.
- Sunset SLA: **7 calendar days max** from cutover.
- Extension: requires CEO explicit approval + written rationale + new expiry date in this runbook.

## Build-exit evidence checklist
- CI/check logs captured.
- Local smoke proof captured.
- Runbook execution record captured (commands + timestamps + operator).
