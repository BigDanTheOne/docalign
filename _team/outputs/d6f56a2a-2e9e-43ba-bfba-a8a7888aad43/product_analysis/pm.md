# Product Analysis — Nightly 2026-02-18

## Executive Summary

DocAlign's core value proposition — detecting documentation drift — is currently broken for the most important detection category: mutation-based false negatives. 15 out of 15 mutation detection tests fail, meaning DocAlign cannot detect when code changes make documentation claims false. This is the #1 priority.

## Opportunity Ranking

### 1. 🔴 Fix False Negative Detection (Track 2) — TONIGHT'S EPIC
**Impact: Critical | Effort: Medium-High | Risk: Low**

- **What**: L3 verifiers fail to detect 15 categories of code mutations that invalidate doc claims
- **Why now**: This is DocAlign's reason to exist. A drift detector that doesn't detect drift has zero value.
- **Scope**: Enhance L3 tier1 verifiers to handle:
  - Dependency version bumps (express, zod, pino)
  - Script renames in package.json
  - File renames/deletions (.env.example, config files, agent files)
  - Function/export renames (createUser→addUser)
  - Route registration changes (removed routes, HTTP method changes)
  - MCP tool renames and config file deletions
- **Success criteria**: All 15 Track 2 mutation tests pass
- **Tasks (estimated 5-7)**:
  1. Fix dependency version verifier — detect version bumps
  2. Fix path reference verifier — detect file renames/deletions
  3. Fix command/script verifier — detect script renames
  4. Fix API route verifier — detect removed/changed routes
  5. Fix code example verifier — detect function renames
  6. Fix MCP tool verifier — detect tool renames and config deletions
  7. Integration: ensure Track 2 test harness runs clean

### 2. 🟡 Fix False Positive Gate (Track 1)
**Impact: High | Effort: Low | Risk: Low**

- 1 test failure on clean tagged corpus
- Likely an overly aggressive verifier or tag parsing bug
- Could be combined with Track 2 work if root cause is in same verifier

### 3. 🟢 Shutdown Test Stability
**Impact: Low | Effort: Low | Risk: None**

- Redis connection handling in test teardown
- Not user-facing but affects CI reliability

## Strategic Rationale

Fixing FN detection directly unblocks:
- **Credibility**: Can't market a drift detector that misses drift
- **CI integration**: No team will add a CI gate that produces false negatives
- **MCP adoption**: AI agents need reliable verification signals
- **Track 2 benchmark**: Establishes measurable detection quality baseline

## Proposed Epic Scope

**Epic**: "Fix L3 Verifier False Negative Detection"
**Tasks**: 5-7 autonomous tasks (see ranking above)
**Dependencies**: Tasks 1-6 are independent (can parallelize). Task 7 depends on all.
**No-merge mode**: All PRs left open for morning review.

## Risk Assessment

- **Low risk**: These are verifier logic fixes with clear test targets (Track 2 mutations)
- **Regression risk**: Fixing FN detection should not increase FP rate (Track 1 test is the guard)
- **Scope creep risk**: Low — each mutation type maps to a specific verifier enhancement
