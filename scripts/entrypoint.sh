#!/bin/bash
set -euo pipefail

# DocAlign GitHub Actions Composite Action Entrypoint
# Installs DocAlign and runs scan, outputting structured JSON results

SCAN_PATH="${1:-.}"
CONFIG_PATH="${2:-}"
FAIL_ON_STALE="${3:-true}"

echo "::group::Installing DocAlign"
npm install -g docalign
echo "::endgroup::"

echo "::group::Running DocAlign scan"
cd "$SCAN_PATH"

# Build scan command
SCAN_CMD="docalign scan --json"

# Add config if specified
if [ -n "$CONFIG_PATH" ]; then
  if [ ! -f "$CONFIG_PATH" ]; then
    echo "::error::Config file not found: $CONFIG_PATH"
    exit 1
  fi
  # Note: The CLI doesn't currently accept --config flag, it auto-loads .docalign.yml from repo root
  # If a custom config path is provided, we need to ensure it's at .docalign.yml or copy it
  if [ "$CONFIG_PATH" != ".docalign.yml" ]; then
    echo "::warning::Custom config path specified but CLI auto-loads from .docalign.yml. Config will be used if it exists at repo root."
  fi
fi

# Run scan and capture output
SCAN_OUTPUT=$(eval "$SCAN_CMD" 2>&1) || SCAN_EXIT=$?
SCAN_EXIT=${SCAN_EXIT:-0}

echo "$SCAN_OUTPUT"
echo "::endgroup::"

# Parse JSON output
STALE_COUNT=$(echo "$SCAN_OUTPUT" | jq -r '.drifted // 0' 2>/dev/null || echo "0")
HEALTH_PERCENT=$(echo "$SCAN_OUTPUT" | jq -r '.healthPercent // 100' 2>/dev/null || echo "100")

# Write outputs
echo "stale-found=$([ "$STALE_COUNT" -gt 0 ] && echo 'true' || echo 'false')" >> "$GITHUB_OUTPUT"
echo "report<<EOF" >> "$GITHUB_OUTPUT"
echo "$SCAN_OUTPUT" >> "$GITHUB_OUTPUT"
echo "EOF" >> "$GITHUB_OUTPUT"

# Write job summary
{
  echo "## DocAlign Scan Results"
  echo ""
  echo "📊 **Health Score:** ${HEALTH_PERCENT}%"
  echo "📝 **Stale Claims:** ${STALE_COUNT}"
  echo ""
  if [ "$STALE_COUNT" -gt 0 ]; then
    echo "⚠️ Documentation drift detected."
    echo ""
    echo "<details><summary>View detailed findings</summary>"
    echo ""
    echo '```json'
    echo "$SCAN_OUTPUT"
    echo '```'
    echo ""
    echo "</details>"
  else
    echo "✅ All documentation is up to date."
  fi
} >> "$GITHUB_STEP_SUMMARY"

# Exit based on fail-on-stale setting
if [ "$FAIL_ON_STALE" = "true" ] && [ "$STALE_COUNT" -gt 0 ]; then
  echo "::error::Found $STALE_COUNT stale claim(s). Set fail-on-stale to false to ignore."
  exit 1
fi

exit 0
