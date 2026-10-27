#!/usr/bin/env bash
# Optional dependency regeneration. Normal XPI builds require no Node or network.
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zotero-plugin-mathjax.XXXXXX")"
trap 'rm -rf -- "$BUILD_DIR"' EXIT
npm install --prefix "$BUILD_DIR" --ignore-scripts --no-audit --no-fund --package-lock=false \
  mathjax-full@3.2.2 esbuild@0.25.12
NODE_PATH="$BUILD_DIR/node_modules" "$BUILD_DIR/node_modules/.bin/esbuild" \
  "$PROJECT_DIR/vendor/mathjax/entry.cjs" --bundle --minify --format=iife \
  --global-name=ZoteroPluginMathJax --target=firefox115 --legal-comments=none \
  '--banner:js=/*! MathJax 3.2.2. Copyright (c) 2017-2022 The MathJax Consortium. Apache-2.0; see vendor/mathjax/LICENSE. */' \
  --outfile="$BUILD_DIR/tex-svg.js"
cp "$BUILD_DIR/node_modules/mathjax-full/LICENSE" "$PROJECT_DIR/vendor/mathjax/LICENSE"
mv "$BUILD_DIR/tex-svg.js" "$PROJECT_DIR/vendor/mathjax/tex-svg.js"
