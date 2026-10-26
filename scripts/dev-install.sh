#!/usr/bin/env bash
# Quit Zotero before running, then start it again afterwards.
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_DIR="${ZOTERO_PROFILE:?Set ZOTERO_PROFILE to your Zotero profile directory}"
PLUGIN_ID="vnmhgrjk@sfirstmail.com"

if [[ ! -d "$PROFILE_DIR/extensions" ]]; then
  printf 'Zotero extensions directory not found: %s\n' "$PROFILE_DIR/extensions" >&2
  exit 1
fi

bash "$PROJECT_DIR/scripts/build.sh"
cp "$PROJECT_DIR/dist/zotero-plugin.xpi" "$PROFILE_DIR/extensions/$PLUGIN_ID.xpi"
# Force Zotero to re-scan extensions on next startup.
rm -f "$PROFILE_DIR/addonStartup.json.lz4" "$PROFILE_DIR/extensions.ini"
printf 'Installed to %s/extensions/%s.xpi\n' "$PROFILE_DIR" "$PLUGIN_ID"
printf 'Start Zotero to load.\n'
