# Development guide

## Source layout

Keep `manifest.json` at the repository root as the source of plugin metadata. Use `manifest_version: 2` for the [Zotero bootstrap plugin format](https://www.zotero.org/support/dev/zotero_7_for_developers#installrdf_manifestjson); version 1 is rejected during installation. This schema version is separate from the plugin version and supported Zotero version range. Zotero's [patched installer](https://github.com/zotero/zotero/blob/10.0.6/app/scripts/fetch_xulrunner) also requires `applications.zotero.id`, `update_url`, and `strict_max_version`. The declared maximum `10.0.*` includes Zotero 10.0.6. Place runtime JavaScript in `src/`, maintenance scripts in `scripts/`, and development documentation in `docs/`.

`src/bootstrap.js` contains Zotero's `install`, `uninstall`, `startup`, and `shutdown` entry points. Each feature lives in its own file under `src/features/` and exposes `startup({ id })` and `shutdown()` through a uniquely named object. Keep feature state inside the module's closure.

`src/features/selection-popup.js` implements the Alt-triggered popup behavior. `src/features/handwritten-text.js` implements handwriting for PDF text annotations. Font assets and their attribution live in `assets/fonts/`; regression tests live in `tests/`.

## Adding a feature

1. Create `src/features/<feature-name>.js`. Follow the closure pattern in `selection-popup.js` and expose a uniquely named feature object.
2. Add the file to the explicit concatenation list in `scripts/build.sh`, before `src/bootstrap.js`.
3. Register its object in `ZoteroPluginFeatures` in `src/bootstrap.js`.
4. Release event listeners, observers, injected styles, and other owned resources in `shutdown()`. Features start in registration order and stop in reverse order.
5. Document the behavior in `README.md` and verify it in Zotero.

The build concatenates scripts into a single `bootstrap.js`, which Zotero loads from the XPI root. Source files use plain JavaScript; `import`, `export`, and third-party dependencies require additional build support. Avoid adding top-level globals outside the named feature objects, generated font data, and lifecycle entry point.

The build embeds Hetang Yuese as a data URL in `ZoteroPluginHandwritingFonts` and includes its attribution notice at `assets/fonts/HetangYuese-NOTICE.txt` in the XPI. Chinese, English, and digits use the same face, including its native Latin glyphs. The font must load before styles and measurements change. Keep the upstream font binary and its notice together; see [font attribution](../assets/fonts/README.md). Add other resource directories when needed and update the packaging script to include them at the same time.

## Build and install

```sh
bash scripts/build.sh
ZOTERO_PROFILE="/path/to/your/zotero/profile" bash scripts/dev-install.sh
```

Both scripts resolve paths relative to their own location, so they also work when invoked from another working directory. `build.sh` assembles the package in a temporary directory and replaces `dist/zotero-plugin.xpi` only after packaging succeeds. Generated files belong in `dist/` and must not be committed.

The install script requires an existing profile with an `extensions` directory. Quit Zotero before running it. The script copies the package to `extensions/vnmhgrjk@sfirstmail.com.xpi` and removes `addonStartup.json.lz4` and `extensions.ini` so Zotero rescans plugins on startup.

## Update metadata

`update.json` is an update manifest served separately from the XPI. Its `addons` key must use the same ID as `manifest.json`. The included empty `updates` array advertises no releases, which suits manual personal installs. The required `update_url` points to `https://raw.githubusercontent.com/AruoTan/zotero-plugin/master/update.json`, matching the current development branch; publish the file there or change the URL to your actual hosted location. No automatic update hosting is provisioned by the build script.

## Validation

Check the shell scripts and archive before installing:

```sh
bash -n scripts/build.sh scripts/dev-install.sh
bash scripts/build.sh
unzip -t dist/zotero-plugin.xpi
unzip -l dist/zotero-plugin.xpi
```

The archive should contain `manifest.json` and the generated `bootstrap.js` at its root, plus `assets/fonts/HetangYuese-NOTICE.txt`. The font bytes are embedded in `bootstrap.js`. Revisit this list when adding packaged resources.

With Node.js 18 or later available, run the feature regression tests:

```sh
node --test tests/*.test.cjs
```

Feature tests use a simulated reader environment to exercise font loading, new tabs, split views, disabling during initialization, failure handling, and cleanup. The package test builds an isolated XPI and checks its manifest version, required Zotero fields, HTTPS update URL, update manifest, Zotero 10 compatibility ceiling, root files, the font notice, exact embedded font bytes, absence of obsolete font resources, and bootstrap entry points. It requires the build tools above plus `unzip`. Node.js is only needed for tests.

For the current popup feature, verify in Zotero that normal text selection hides the popup, holding Alt before mouse release shows it, and clicking elsewhere hides it again. Check both already-open readers and newly opened tabs. Disabling the plugin should remove its styles and listeners; re-enabling it should restore the behavior.

For handwriting, use **Add Text** to enter Chinese, English, and multiple lines in a PDF. Check wrapping, resizing, zooming, split views, and reopening the document. Existing text annotations should also display in handwriting. Confirm PDF body text, the sidebar, and note editors keep their normal fonts. Disable and re-enable the plugin to check restoration.

Script and archive checks do not replace verification in Zotero.

## Reader integration details

The handwriting feature loads the bundled font with `FontFace` into the outer reader document and each PDF view iframe. It styles `.customAnnotationLayer textarea.textAnnotation` and synchronizes the reader's `computedFontFamily`, which is used for annotation rendering and newer annotation measurements. Zotero 7.0.24's measurement code hardcodes the original font, so a scoped rule also covers its hidden measurement textareas. The feature does not modify saved annotation content or positions.

The view iframe path, annotation selectors, shared font global, and `_render()` refresh method are internal Zotero interfaces. Recheck them when updating supported Zotero versions. The implementation was checked against the [reader source used by Zotero 7.0.24](https://github.com/zotero/reader/tree/7f32b0ef732c61aa47ed670e4bc3513c9b6f9709), the [reader source used by Zotero 10.0.6](https://github.com/zotero/reader/tree/5802d14a76552e10000124d2431e352e92054f01), and the [current reader source](https://github.com/zotero/reader). Exported PDF font embedding is outside this display feature.

## Formatting

Use UTF-8, LF line endings, and two-space indentation, as configured in `.editorconfig`. Use kebab-case filenames and keep generated artifacts out of source directories.
