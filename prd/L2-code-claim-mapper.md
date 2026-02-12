> Part of [DocAlign PRD](../PRD.md)

## 6. Layer 2: Code-to-Claim Mapper

### 6.1 Purpose

For each extracted claim, identify which code files and functions contain evidence to verify or disprove that claim. This mapping enables efficient incremental verification: when a code file changes, we know exactly which claims to re-verify.

### 6.2 Functional Requirements

**Mapping strategy (progressive, cheapest first):** The mapper runs four steps in order. High-confidence mapping threshold: confidence >= 0.9. When a high-confidence mapping is found, the mapper does NOT stop -- it continues through all tiers to find additional mappings (a behavior claim may map to multiple files). "High-confidence" only determines the confidence label, not early termination.

**Step 1: Direct Reference Mapping (Deterministic)**
- `path_reference` claims: look up the file path in the file tree index
- `command` claims: map to the file that defines the script (e.g., package.json for npm scripts, Makefile for make targets)
- `dependency_version` claims: map to the package manifest file that contains the dependency
- `api_route` claims: look up the route in the AST-indexed route definitions
- **Coverage estimate:** handles ~40-50% of all claims (all syntactic claims)

**Step 2: Symbol-Based Search (AST Lookup)**
- For claims mentioning specific code identifiers (class names, function names)
- Search the AST index for matching symbols
- Confidence: 0.85
- **Coverage estimate:** handles ~20-30% of remaining claims

**Step 3: Semantic Search (Embedding Similarity)**
- For claims describing behavior without naming specific code entities
- Embed the claim text and find the most similar code entity embeddings
- Filter by similarity threshold (0.7, configurable via `.docalign.yml` `mapping_threshold`)
- **Coverage estimate:** handles ~50-70% of remaining claims

**Step 4: LLM-Assisted Mapping (Vague Claims)**
- For architecture-level claims that span multiple files and cannot be localized
- **STATUS: Solved (see Spike A).** Dual mechanism: (a) universal/quantified claims → LLM-generated static analysis rules (deterministic evaluation, $0 per check after generation), (b) architecture flow claims → decomposition into 2-5 localizable sub-claims, each mapped via Steps 1-3.
- **MVP decision:** Skip Step 4 in MVP. Track which claims fall through with `mapping_method: 'skipped_flow'` or `'skipped_universal'` to inform v2 priorities. Implement dual mechanism in v2.
- **Expected fallthrough rate:** ~10-20% of semantic claims reach this step. These are architecture-level claims. Skipping them in MVP is acceptable.

### 6.3 Inputs and Outputs

**Inputs:**
- Claims (from Layer 1)
- Codebase index (from Layer 0)

**Outputs (per claim):**
- One or more mappings, each containing:
  - Code file path
  - Specific code entity (nullable -- may map to whole file)
  - Mapping confidence (0-1)
  - Mapping method used (direct_reference, symbol_search, semantic_search, llm_assisted, static_rule, skipped_flow, skipped_universal, manual)

### 6.4 Mapping Maintenance

Mappings can go stale when code changes:
- Mapped file was deleted: remove mapping, mark claim as "evidence_lost"
- Mapped file was renamed: detect via git rename tracking, update mapping
- Mapped entity was removed from file: remove entity mapping, re-run mapping

### 6.5 Reverse Index

Critical for change-triggered scanning (Layer 4): given a changed code file, which claims are mapped to it? This is the primary query path for PR-triggered verification and must be fast (indexed).

### 6.6 Performance Requirements

- Direct reference mapping: <10ms per claim
- Symbol search: <50ms per claim
- Semantic search: <200ms per claim (embedding query)
- Similarity threshold: 0.7 (configurable via .docalign.yml `mapping_threshold`). Note: OpenAI text-embedding-3-small cosine similarities cluster in the 0.5-0.8 range; 0.7 balances precision and recall.

### 6.7 Open Questions

- Architecture-level claims: solved by Spike A (static rules + decomposition). Skipped in MVP; implement in v2. See `phases/spike-a-vague-claim-mapping.md`.
- Semantic search similarity threshold set at 0.7 (see Section 6.6). Calibrate via Experiment 16.2.

> Technical detail: see phases/technical-reference.md Section 3.3 (mapping functions, LLM-assisted mapping options, reverse index query)

