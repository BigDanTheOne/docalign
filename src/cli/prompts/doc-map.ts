/**
 * Step 0 prompt — sent to `claude -p` (no tools) to classify all doc files
 * and produce per-file extraction hints for the main extraction pipeline.
 *
 * The prompt deliberately does NOT give Claude code-exploration tools.
 * Classification is based purely on file paths, frontmatter, and headings.
 * This keeps Step 0 fast (a single Claude call with no sub-agents).
 */

export const DOC_MAP_SYSTEM_PROMPT = `You classify documentation files to guide a downstream claim-extraction pipeline.
You receive file paths, frontmatter, and headings — no full content, no code access.
Classify each file by type and audience, and write extraction hints that help the pipeline
distinguish illustrative examples from real factual claims.
Return valid JSON only.`;

/**
 * Build the Step 0 prompt.
 *
 * @param renderedSnippets - Output of renderDocFileSnippets() — one block per file.
 */
export function buildDocMapPrompt(renderedSnippets: string): string {
  return `You are classifying documentation files for a codebase documentation-drift detector.

Based on each file's path, frontmatter metadata, and heading structure:
1. Classify each file by type and audience
2. Generate a short \`summary\` and a \`read_when\` list for files that don't already have them
3. Write extraction hints for the downstream claim extractor

## Classification guide

**doc_type** — choose the best fit:
- \`getting_started\`: First-time user guide ("Getting Started", "Quickstart", "Installation")
- \`tutorial\`: Step-by-step task guide ("How to add X", "Step 1... Step 2...")
- \`reference\`: Command/API/config reference (flag tables, option lists, schemas)
- \`explanation\`: Conceptual "how it works" doc (architecture, design rationale)
- \`contributing\`: Developer contribution guide ("Adding a Check", "Development Setup")
- \`runbook\`: Operations / incident runbook (monitoring, alerts, recovery steps)
- \`convention\`: Code or project conventions ("Naming conventions", "Style guide")
- \`configuration\`: Config schema / options (what each setting does)
- \`troubleshooting\`: Problem-solution guide ("Common errors", "FAQ")
- \`unknown\`: Cannot determine from available metadata

**audience** — who reads this:
- \`developer\`: People building the tool
- \`user\`: End-users running the CLI
- \`contributor\`: Open-source contributors adding features
- \`mixed\`: Multiple audiences

**summary** — a short one-line tagline describing what the document covers.
Examples:
- "All docalign commands, flags, and exit codes"
- "Step-by-step guide for adding new claim types and verifiers"
- "Four-tier verification system from fast regex to LLM"

If the file's frontmatter already has a \`summary:\` field, copy it verbatim.
If not, write a concise, informative summary (one sentence, no "Use when" phrasing).

**read_when** — a list of 2–4 specific situations when someone should read this doc.
Examples: ["Looking up a specific command's flags", "Scripting DocAlign in CI"]

If the file's frontmatter already has a \`read_when:\` list, copy it verbatim.
If not, write 2–4 concrete, specific scenarios.

**skip_hint** (optional) — write when the file contains illustrative/template content
that a naive extractor might confuse for real claims about the codebase.

Good skip_hints:
- contributing guide: "Step-by-step guide with code templates. All code blocks are
  instructional scaffolding — not the project's real code. Template functions such as
  verifyYourNewType or extractYourNewType are hypothetical examples."
- tutorial: "Tutorial with hypothetical usage examples. Code blocks show patterns,
  not the project's own implementation."
- convention/patterns guide: "Code pattern examples illustrate conventions, not actual code."

Leave skip_hint empty for reference and explanation docs containing only factual claims.

**extraction_notes** (optional) — special guidance for the claim extractor, e.g.
"Claims about specific tier numbers are real and verifiable."

## Output format

Return a single JSON object:
{
  "entries": [
    {
      "file": "docs/contributing/adding-a-check.md",
      "doc_type": "contributing",
      "audience": "contributor",
      "summary": "Step-by-step guide for adding new claim types and verifiers",
      "read_when": [
        "Adding a new claim type to DocAlign",
        "Writing a new extractor or verifier function"
      ],
      "skip_hint": "Step-by-step guide with code templates...",
      "extraction_notes": "Focus only on factual statements about existing architecture."
    }
  ]
}

## Files to classify

${renderedSnippets}`;
}
