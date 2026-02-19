#!/bin/bash
set -euo pipefail

# DocAlign GitHub Actions Composite Action Entrypoint
# Installs DocAlign and runs scan, outputting structured JSON results

SCAN_PATH="${1:-.}"
CONFIG_PATH="${2:-}"
FAIL_ON_STALE="${3:-true}"

# Check for required dependencies
if ! command -v jq &> /dev/null; then
  echo "::error::jq is required but not installed. Please add a step to install jq before this action."
  exit 1
fi

echo "::group::Installing DocAlign"
npm install -g docalign
echo "::endgroup::"

echo "::group::Running DocAlign scan"
cd "$SCAN_PATH"

# Build scan command
SCAN_CMD=("docalign" "scan" "--json")

# Add config if specified
if [ -n "$CONFIG_PATH" ]; then
  if [ ! -f "$CONFIG_PATH" ]; then
    echo "::error::Config file not found: $CONFIG_PATH"
    exit 1
  fi
  SCAN_CMD+=("--config" "$CONFIG_PATH")
fi

# Run scan and capture output, separating stdout from stderr
SCAN_EXIT=0
SCAN_OUTPUT=$("${SCAN_CMD[@]}" 2>/dev/null) || SCAN_EXIT=$?

# Check if scan failed
if [ "$SCAN_EXIT" -ne 0 ]; then
  echo "::error::DocAlign scan failed with exit code $SCAN_EXIT"
  echo "::endgroup::"
  exit "$SCAN_EXIT"
fi

echo "$SCAN_OUTPUT"
echo "::endgroup::"

# Parse JSON output
STALE_COUNT=$(echo "$SCAN_OUTPUT" | jq -r '.drifted // 0' 2>/dev/null || echo "0")

# Write outputs using unique heredoc delimiter to prevent injection
HEREDOC_DELIMITER="DOCALIGN_REPORT_EOF_DELIMITER_$(date +%s%N)"
echo "stale-found=$([ "$STALE_COUNT" -gt 0 ] && echo 'true' || echo 'false')" >> "$GITHUB_OUTPUT"
echo "report<<${HEREDOC_DELIMITER}" >> "$GITHUB_OUTPUT"
echo "$SCAN_OUTPUT" >> "$GITHUB_OUTPUT"
echo "${HEREDOC_DELIMITER}" >> "$GITHUB_OUTPUT"

# Write job summary
{
  echo "## DocAlign Scan Results"
  echo ""
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
