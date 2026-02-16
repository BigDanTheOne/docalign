#!/usr/bin/env bash
set -euo pipefail
OLD_PATH="/Users/kotkot/Discovery/docalign"
NEW_PATH="/Users/kotkot/docalign"
PARENT_NEW="/Users/kotkot"

if [[ ! -d "$OLD_PATH" ]]; then
  echo "OLD_PATH missing: $OLD_PATH" >&2
  exit 2
fi

if [[ -e "$NEW_PATH" ]]; then
  echo "NEW_PATH already exists: $NEW_PATH" >&2
  exit 2
fi

mv "$OLD_PATH" "$NEW_PATH"
ln -s "$NEW_PATH" "$OLD_PATH"

echo "Relocation complete"
echo "- moved: $OLD_PATH -> $NEW_PATH"
echo "- compatibility symlink: $OLD_PATH -> $NEW_PATH"
