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
- Temporary symlink: `/Users/kotkot/Discovery/docalign -> /Users/kotkot/docalign`.
- Sunset SLA: **7 calendar days max** from cutover.
- Extension: requires CEO explicit approval + written rationale + new expiry date in this runbook.

## Build-exit evidence checklist
- CI/check logs captured.
- Local smoke proof captured.
- Runbook execution record captured (commands + timestamps + operator).
