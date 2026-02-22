---
title: "Troubleshooting"
summary: "Common issues and solutions when using DocAlign."
category: guide
docalign:
  setup_date: "2026-02-23T00:00:00Z"
  monitored: true
---

# Troubleshooting

Common issues and solutions when using DocAlign CLI and MCP integration.

## MCP server not appearing in tools

If the MCP server does not appear after running `docalign init`:

1. Check that your MCP config references the correct command. The entry in `.claude/mcp.json` should use `docalign mcp --repo .`.
2. Restart your AI client (Claude Code, Cursor, etc.) to pick up the new MCP config.
3. Run `docalign scan` to verify the integration works — if it returns results, the MCP server is configured correctly.

The MCP server uses stdio transport — if the process exits immediately, check the logs for startup errors.

## Config errors (E501, E502)

DocAlign validates `.docalign.yml` on load. Common issues:

- **E501 — Invalid YAML syntax:** The file has a YAML parse error. DocAlign falls back to defaults and logs a warning. Fix the YAML syntax and re-run.
- **E502 — Unknown or invalid fields:** A config key is misspelled or has an invalid value. DocAlign provides "did you mean?" suggestions in the warning. Check `src/config/loader.ts` for the valid schema.

## Scan finds no documentation files

If `docalign scan` returns zero files:

1. Ensure your doc files match the patterns in `.docalign.yml` under `doc_patterns`. The default patterns include `docs/**/*.md` and `README.md`.
2. Check that the files are not excluded by `exclude` patterns.
3. Verify you are running the command from the repository root (or using `--repo`).

## Drift reported on correct documentation

If DocAlign reports drift on documentation that is actually correct:

1. Use suppress rules in `.docalign.yml` to silence false positives. See the [Suppressing Findings](docs/guides/suppressing-findings.md) guide.
2. For claims that are intentionally aspirational, add a `docalign:skip` annotation in the doc.
3. Run `docalign check <file> --deep` to see the full verification details including reasoning.

## Extract command fails

The `docalign extract` command requires the Claude CLI to be installed and an `ANTHROPIC_API_KEY` set.

- **Claude CLI not found:** Install it with `npm install -g @anthropic-ai/claude-code`.
- **Quota exceeded:** The LLM API rate limit was hit. Wait and retry.
- **Parse error:** The LLM response could not be parsed as JSON. Re-running usually resolves this.

Run `docalign extract --dry-run` to verify the Claude CLI is available.

## MCP tool returns an error

If a tool like `check_doc` or `scan_docs` returns an error:

- Verify the file path is relative to the repo root.
- Check that the repository has been initialized with `docalign init`.
- Look at the error message — the MCP tools in `src/layers/L6-mcp/tool-handlers.ts` return structured JSON errors with details.
