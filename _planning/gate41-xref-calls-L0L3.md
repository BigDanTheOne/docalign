# Gate 4.1 Cross-Layer Function Call Verification (L0-L3)

> **Date:** 2026-02-11
> **Scope:** All cross-layer function calls between TDD-0, TDD-1, TDD-2, and TDD-3.
> **Method:** Compared each caller's usage (Section 2 dependency declarations + Section 4 algorithm pseudocode) against the callee's Section 4 defined signature.

---

## L2 (Mapper) -> L0 (CodebaseIndex)

### L2 -> L0.fileExists
**Caller says:** `L0.fileExists(repoId, path)` (tdd-2, lines 217, 234)
**Callee defines:** `fileExists(repoId: string, path: string): Promise<boolean>` (tdd-0, line 126)
**Match:** YES

### L2 -> L0.getDependencyVersion
**Caller says:** `L0.getDependencyVersion(repoId, pkg)` (tdd-2, line 247)
**Callee defines:** `getDependencyVersion(repoId: string, packageName: string): Promise<DependencyVersion | null>` (tdd-0, line 536)
**Match:** YES

### L2 -> L0.findRoute
**Caller says:** `L0.findRoute(repoId, method, path)` (tdd-2, line 262)
**Callee defines:** `findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>` (tdd-0, line 420)
**Match:** YES

### L2 -> L0.searchRoutes
**Caller says:** `L0.searchRoutes(repoId, path)` (tdd-2, line 272)
**Callee defines:** `searchRoutes(repoId: string, path: string): Promise<Array<{ method: string; path: string; file: string; line: number; similarity: number }>>` (tdd-0, lines 476-482)
**Match:** YES

### L2 -> L0.findSymbol
**Caller says:** `L0.findSymbol(repoId, keyword)` (tdd-2, line 295)
**Callee defines:** `findSymbol(repoId: string, name: string): Promise<CodeEntity[]>` (tdd-0, line 236)
**Match:** YES

### L2 -> L0.searchSemantic
**Caller says:** `L0.searchSemantic(repoId, claim.claim_text, config.semantic_top_k)` (tdd-2, line 311)
**Callee defines:** `searchSemantic(repoId: string, query: string, topK: number): Promise<Array<CodeEntity & { similarity: number }>>` (tdd-0, line 689)
**Match:** YES

---

## L2 Section 2.1 Dependency Declaration vs. Actual Usage

**L2 Section 2.1 declares consuming from L0:** `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getEntityByFile`

**L2 Section 2 cross-layer call index states:** L2 -> L0: `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `getDependencyVersion`, `scriptExists`

**L2 algorithms actually call:** `fileExists`, `getDependencyVersion`, `findRoute`, `searchRoutes`, `findSymbol`, `searchSemantic`

### L2 -> L0.scriptExists (DECLARED BUT NOT CALLED)
**Caller declares:** Listed in Section 2.1 dependency table and cross-layer call index
**Callee defines:** `scriptExists(repoId: string, scriptName: string): Promise<boolean>` (tdd-0, line 589)
**Match:** NO -- DECLARED BUT UNUSED
**Issue:** L2 Section 2.1 and cross-layer index both list `scriptExists` as consumed from L0, but no L2 algorithm (Section 4) actually calls `L0.scriptExists`. The `command` claim type in `mapDirectReference` (Step 1) maps via manifest file existence (`L0.fileExists`), not via script lookup. Either the declaration is stale or an algorithm step is missing.

### L2 -> L0.getEntityByFile (DECLARED BUT NOT CALLED)
**Caller declares:** Listed in Section 2.1 dependency table ("entity line count")
**Callee defines:** `getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]>` (tdd-0, line 314)
**Match:** NO -- DECLARED BUT UNUSED
**Issue:** L2 Section 2.1 lists `getEntityByFile` as consumed from L0 but it does not appear in L2's cross-layer call index (line 48), nor does any L2 algorithm call `L0.getEntityByFile`. The `getEntityLineCount` function (Section 4.7) uses a DB JOIN, not an L0 call. The Section 2.1 declaration is stale.

### L2 -> L0.searchRoutes (USED BUT MISSING FROM CROSS-LAYER INDEX)
**Caller actually calls:** `L0.searchRoutes(repoId, path)` (tdd-2, line 272)
**Cross-layer index says:** L2 -> L0: `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `getDependencyVersion`, `scriptExists` (no `searchRoutes`)
**Match:** PARTIAL
**Issue:** L2 calls `L0.searchRoutes` in the `api_route` branch of `mapDirectReference` (Step 1), but `searchRoutes` is omitted from the cross-layer call index (tdd-2, line 48). It IS listed in Section 2.1 dependency table (line 27). The cross-layer index at line 48 is incomplete.

---

## L3 (Verifier) -> L0 (CodebaseIndex)

### L3 -> L0.fileExists
**Caller says:** `L0.fileExists(claim.repo_id, path)` (tdd-3, lines 987, 1284, 1337-1339, 1359)
**Callee defines:** `fileExists(repoId: string, path: string): Promise<boolean>` (tdd-0, line 126)
**Match:** YES

### L3 -> L0.scriptExists
**Caller says:** `L0.scriptExists(claim.repo_id, script)` (tdd-3, line 1021)
**Callee defines:** `scriptExists(repoId: string, scriptName: string): Promise<boolean>` (tdd-0, line 589)
**Match:** YES

### L3 -> L0.getAvailableScripts
**Caller says:** `L0.getAvailableScripts(claim.repo_id)` (tdd-3, line 1027)
**Callee defines:** `getAvailableScripts(repoId: string): Promise<ScriptInfo[]>` (tdd-0, line 638)
**Match:** YES

### L3 -> L0.getDependencyVersion
**Caller says:** `L0.getDependencyVersion(claim.repo_id, pkgName)` (tdd-3, line 1055)
**Callee defines:** `getDependencyVersion(repoId: string, packageName: string): Promise<DependencyVersion | null>` (tdd-0, line 536)
**Match:** YES

### L3 -> L0.findRoute
**Caller says:** `L0.findRoute(claim.repo_id, method, path)` (tdd-3, line 1090)
**Callee defines:** `findRoute(repoId: string, method: string, path: string): Promise<RouteEntity | null>` (tdd-0, line 420)
**Match:** YES

### L3 -> L0.searchRoutes
**Caller says:** `L0.searchRoutes(claim.repo_id, path)` (tdd-3, line 1098)
**Callee defines:** `searchRoutes(repoId: string, path: string): Promise<Array<{ method: string; path: string; file: string; line: number; similarity: number }>>` (tdd-0, lines 476-482)
**Match:** YES

### L3 -> L0.findSymbol
**Caller says:** `L0.findSymbol(claim.repo_id, symbolName)` (tdd-3, lines 1131, 1139, 1307)
**Callee defines:** `findSymbol(repoId: string, name: string): Promise<CodeEntity[]>` (tdd-0, line 236)
**Match:** YES

### L3 -> L0.getEntityByFile
**Caller says:** `L0.getEntityByFile(claim.repo_id, filePath)` (tdd-3, lines 494, 1283)
**Callee defines:** `getEntityByFile(repoId: string, filePath: string): Promise<CodeEntity[]>` (tdd-0, line 314)
**Match:** YES

### L3 -> L0.getFileTree
**Caller says:** `L0.getFileTree(repoId)` (tdd-3, line 1240)
**Callee defines:** `getFileTree(repoId: string): Promise<string[]>` (tdd-0, line 176)
**Match:** YES

---

## L3 Section 2.1 Dependency Declaration vs. Actual Usage

**L3 Section 2.1 declares consuming from L0:** `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`, `getFileTree`

**L3 Section 2 cross-layer call index states:** L3 -> L0: `fileExists`, `findSymbol`, `findRoute`, `searchRoutes`, `getDependencyVersion`, `scriptExists`, `getAvailableScripts`, `getEntityByFile`

### L3 -> L0.getFileTree (USED BUT MISSING FROM CROSS-LAYER INDEX)
**Caller actually calls:** `L0.getFileTree(repoId)` (tdd-3, line 1240, Appendix C)
**Cross-layer index says:** L3 -> L0 does NOT list `getFileTree` (tdd-3, line 44)
**Section 2.1 table says:** Lists `getFileTree` (tdd-3, line 25)
**Match:** PARTIAL
**Issue:** L3's cross-layer call index (line 44) omits `getFileTree`, but it IS used in Appendix C (`findSimilarPaths`) and IS listed in Section 2.1. The cross-layer index is incomplete.

---

## L0 Section 2.2 ("Exposes to") vs. Actual Callers

### L0 Section 2.2 lists L3 as consuming `getFileTree` -- NO
**L0 declares:** L4 (Worker) calls `getFileTree` (tdd-0, line 40)
**L0 cross-layer index:** Does NOT list L3 -> `getFileTree` (tdd-0, lines 44-46)
**Actual:** L3 DOES call `L0.getFileTree` in Appendix C (tdd-3, line 1240)
**Match:** NO
**Issue:** L0's Section 2.2 "Exposes to" table does not list L3 as a consumer of `getFileTree`. L0's cross-layer index also omits L3 -> `getFileTree`. But L3 actually calls it. Both L0 and L3 cross-layer indexes are out of sync.

### L0 Section 2.2 lists L3 as NOT consuming `searchRoutes` -- INCORRECT
**L0 declares in Section 2.2 table:** L3 consumes `fileExists`, `findSymbol`, `findRoute`, `getDependencyVersion`, `scriptExists`, `getEntityByFile` (tdd-0, line 38)
**L0 cross-layer index:** L3 -> L0: `fileExists`, `findSymbol`, `findRoute`, `getDependencyVersion`, `scriptExists`, `getEntityByFile` (tdd-0, line 45)
**Actual:** L3 DOES call `L0.searchRoutes` (tdd-3, line 1098) and `L0.getAvailableScripts` (tdd-3, line 1027)
**Match:** NO
**Issue:** L0's Section 2.2 table and cross-layer index both omit `searchRoutes` and `getAvailableScripts` from L3's consumption list. But L3 verifier algorithms call both. L0's Section 2.2 is incomplete for L3.

### L0 Section 2.2 lists L2 as NOT consuming `searchRoutes` or `getEntityByFile` -- PARTIAL
**L0 declares in cross-layer index:** L2 -> L0: `fileExists`, `findSymbol`, `searchSemantic`, `findRoute`, `getDependencyVersion`, `scriptExists` (tdd-0, line 44)
**Actual L2 usage:** L2 calls `searchRoutes` (tdd-2, line 272) but NOT `getEntityByFile` or `scriptExists`
**Match:** PARTIAL
**Issue:** L0 cross-layer index omits `searchRoutes` from L2's list (L2 does call it). L0 lists `scriptExists` for L2 (L2 does NOT call it). Both are wrong.

---

## L3 (Verifier) -> L2 (Mapper)

### L3 -> L2.getEntityLineCount
**Caller says:** `L2.getEntityLineCount(mapping.id)` (tdd-3, line 354)
**Callee defines:** `getEntityLineCount(mappingId: string): Promise<number | null>` (tdd-2, line 856)
**Match:** YES

---

## L3 (Verifier) -> L1 (ClaimExtractor)

L3 Section 2.1 declares consuming `Claim` records from L1, but these are passed as arguments by L4 (the orchestrator). L3 does NOT directly call any L1 service functions in its algorithms. This is consistent across all TDDs.

**Match:** YES (no direct calls; data passed by L4)

---

## L2 (Mapper) -> L1 (ClaimExtractor)

L2 Section 2.1 declares consuming `Claim` records from L1, and the `mapClaim` signature accepts `claim: Claim` as an argument. L2 does NOT directly call L1 service functions. Claims are passed by L4.

**Match:** YES (no direct calls; data passed by L4)

---

## Summary

| Count | Category |
|-------|----------|
| **15** | Full matches (signature + usage consistent) |
| **5** | Mismatches / Warnings |

### Mismatches and Warnings Detail

| # | Type | Finding |
|---|------|---------|
| 1 | **MISMATCH** | L2 declares `L0.scriptExists` in Section 2.1 and cross-layer index, but never calls it. Declaration is stale or algorithm is incomplete. |
| 2 | **MISMATCH** | L2 declares `L0.getEntityByFile` in Section 2.1, but never calls it and it is absent from L2 cross-layer index. Declaration is stale. |
| 3 | **WARNING** | L2 calls `L0.searchRoutes` but it is missing from L2's cross-layer call index (tdd-2, line 48). Present in Section 2.1 table. Index is incomplete. |
| 4 | **WARNING** | L3 calls `L0.getFileTree` but it is missing from L3's cross-layer call index (tdd-3, line 44). Present in L3 Section 2.1 table. Index is incomplete. |
| 5 | **MISMATCH** | L0 Section 2.2 and cross-layer index undercount L3's actual consumption. Missing: `searchRoutes`, `getAvailableScripts`, `getFileTree`. L0 also lists `scriptExists` for L2 but L2 never calls it. |

### Totals

- **15 matches**
- **3 mismatches** (stale declarations or missing entries in provider)
- **2 warnings** (cross-layer indexes incomplete but Section 2.1 tables correct)

### Recommended Actions

1. **TDD-2 Section 2.1:** Remove `scriptExists` and `getEntityByFile` from L0 consumption list (or add algorithm calls if they were intended).
2. **TDD-2 cross-layer index (line 48):** Add `searchRoutes` to the L2 -> L0 list.
3. **TDD-3 cross-layer index (line 44):** Add `getFileTree` to the L3 -> L0 list.
4. **TDD-0 Section 2.2 table (line 38):** Add `searchRoutes`, `getAvailableScripts`, `getFileTree` to L3's consumer row.
5. **TDD-0 cross-layer index (line 45):** Update L3 -> L0 to include `searchRoutes`, `getAvailableScripts`, `getEntityByFile`, `getFileTree`. Remove `scriptExists` from L2 -> L0 line (line 44) or add an L2 algorithm call.
