#!/usr/bin/env bash
set -euo pipefail
OLD_PATH="/Users/kotkot/Discovery/docalign"
NEW_PATH="/Users/kotkot/docalign"

if [[ -L "$OLD_PATH" ]]; then
  rm "$OLD_PATH"
fi

if [[ -d "$NEW_PATH" ]]; then
  mv "$NEW_PATH" "$OLD_PATH"
fi

echo "Rollback complete: repo restored to $OLD_PATH"
