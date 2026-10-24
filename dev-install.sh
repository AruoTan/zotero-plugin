#!/usr/bin/env bash
# Rebuild xpi and drop it into the Zotero profile's extensions dir.
# Quit Zotero before running, then start it again afterwards.
set -euo pipefail
cd "$(dirname "$0")"
PROFILE_DIR="${ZOTERO_PROFILE:?Set ZOTERO_PROFILE to your Zotero profile directory}"
ID="vnmhgrjk@sfirstmail.com"

rm -f zotero-plugin.xpi
zip -q zotero-plugin.xpi manifest.json bootstrap.js
cp zotero-plugin.xpi "$PROFILE_DIR/extensions/$ID.xpi"
# Force Zotero to re-scan extensions on next startup
rm -f "$PROFILE_DIR/addonStartup.json.lz4" "$PROFILE_DIR/extensions.ini"
echo "Installed to $PROFILE_DIR/extensions/$ID.xpi"
echo "Start Zotero to load."
