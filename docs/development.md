# Development guide

## Source layout

Keep `manifest.json` at the repository root as the source of plugin metadata. Use `manifest_version: 2` for the [Zotero bootstrap plugin format](https://www.zotero.org/support/dev/zotero_7_for_developers#installrdf_manifestjson); version 1 is rejected during installation. This schema version is separate from the plugin version and supported Zotero version range. Zotero's [patched installer](https://github.com/zotero/zotero/blob/10.0.6/app/scripts/fetch_xulrunner) also requires `applications.zotero.id`, `update_url`, and `strict_max_version`. The declared maximum `10.0.*` includes Zotero 10.0.6. Place runtime JavaScript in `src/`, maintenance scripts in `scripts/`, and development documentation in `docs/`.

`src/bootstrap.js` contains Zotero's `install`, `uninstall`, `startup`, and `shutdown` entry points. Each feature lives in its own file under `src/features/` and exposes `startup({ id })` and `shutdown()` through a uniquely named object. Keep feature state inside the module's closure.

`src/features/selection-popup.js` implements the Alt-triggered popup behavior. `src/features/handwritten-text.js` implements handwriting for PDF text annotations. `src/features/black-text-sidebar-filter.js` hides black Add Text entries in the PDF sidebar. `src/features/annotation-hit-targets.js` restricts underline and area annotation hit targets to their strokes and borders. Font assets and their attribution live in `assets/fonts/`; regression tests live in `tests/`.

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

Feature tests use a simulated reader environment to exercise font loading, new tabs, split views, disabling during initialization, failure handling, and cleanup. Sidebar filter tests cover annotation types and colors, recoloring, black color swatch hiding and deselection, late sidebar mounts, replaced rows and swatches, new readers, and cleanup during pending initialization. The package test builds an isolated XPI and checks its manifest version, required Zotero fields, HTTPS update URL, update manifest, Zotero 10 compatibility ceiling, root files, the font notice, exact embedded font bytes, absence of obsolete font resources, bootstrap entry points, and sidebar feature registration. It requires the build tools above plus `unzip`. Node.js is only needed for tests.

For the current popup feature, verify in Zotero that normal text selection hides the popup, holding Alt before mouse release shows it, and clicking elsewhere hides it again. Check both already-open readers and newly opened tabs. Disabling the plugin should remove its styles and listeners; re-enabling it should restore the behavior.

For handwriting, use **Add Text** to enter Chinese, English, and multiple lines in a PDF. Check wrapping, resizing, zooming, split views, and reopening the document. Existing text annotations should also display in handwriting. Confirm PDF body text, the sidebar, and note editors keep their normal fonts. Disable and re-enable the plugin to check restoration.

For sidebar filtering, create black and colored Add Text annotations and black annotations of other types. Only black Add Text entries should disappear from the annotation list; their text must remain visible and editable on the PDF. Change black text to another color and back, search the sidebar, use color/tag filters, toggle the sidebar, reopen the PDF, and open a reader in a separate window. Check both existing and new annotations, light and dark themes, and restoration after disabling and re-enabling the plugin.

The sidebar's black color swatch should also be hidden, including when black non-text annotations exist. With the plugin disabled, select black and another color; then enable the plugin and confirm that black is deselected while the other color, tags, and search query are retained. Toggle the sidebar and add/recolor annotations to check swatch updates. Disable the plugin to restore the black swatch.

Script and archive checks do not replace verification in Zotero.

For annotation hit targets, create single-line, multiline, and cross-page underlines and an area annotation over selectable PDF text. Click, double-click, drag to select, and copy text under the underline and inside the box, both before and after selecting the annotation. Text selection uses the PDF's existing text layer; scanned images still require OCR. Click underline strokes and all four box borders to select the annotations, then check native range/resize handles and border dragging. Check links inside a box, overlapping highlights or notes, read-only PDFs, different zoom levels, page/text rotations, high DPI displays, split views, new tabs, and separate reader windows. Disable and re-enable the plugin to check restoration.

Hit-target regression tests cover stroke/interior separation, selected objects and handles, zoom/density, page/text rotation, multiline/cross-page ranges, overlap priorities, filtered annotations, split-view replacement, pending initialization, cleanup, and coexistence with later method wrappers. Separate VM realms check callback and result-array ownership without cloning annotations. Injected geometry failures verify immediate restoration of native candidates/actions and prevent retry loops. These tests simulate the reader APIs and do not reproduce Gecko's security wrappers or exercise a running Zotero instance.

## Reader integration details

The handwriting feature loads the bundled font with `FontFace` into the outer reader document and each PDF view iframe. It styles `.customAnnotationLayer textarea.textAnnotation` and synchronizes the reader's `computedFontFamily`, which is used for annotation rendering and newer annotation measurements. Zotero 7.0.24's measurement code hardcodes the original font, so a scoped rule also covers its hidden measurement textareas. The feature does not modify saved annotation content or positions.

The view iframe path, annotation selectors, shared font global, and `_render()` refresh method are internal Zotero interfaces. Recheck them when updating supported Zotero versions. The implementation was checked against the [reader source used by Zotero 7.0.24](https://github.com/zotero/reader/tree/7f32b0ef732c61aa47ed670e4bc3513c9b6f9709), the [reader source used by Zotero 10.0.6](https://github.com/zotero/reader/tree/5802d14a76552e10000124d2431e352e92054f01), and the [current reader source](https://github.com/zotero/reader). Exported PDF font embedding is outside this display feature.

The black text sidebar filter uses the outer document's `#annotationsView [data-sidebar-annotation-id]` rows and the `.preview > header > .start > .icon-text` icon. The icon's inline `color` represents the annotation color without theme adjustments; only pure black is hidden. Color swatches are scoped to `#annotationsView #selector .colors > button.color` and identified by the SVG path's `fill`. An already selected black swatch is deselected through its native click handler before hiding, preserving other filter selections. A pending toggle is tracked until React commits deselection to prevent repeated clicks.

A scoped style hides marked rows and color buttons, and a mutation observer updates markers after list, type, color, or selection changes. The observer excludes the plugin's own marker attribute to avoid feedback loops. Shutdown removes styles, markers, observers, and listeners, including markers on removed rows and swatches.

These sidebar selectors were checked against the Zotero 7.0.24 and 10.0.6 reader sources linked above. Keep row hiding separate from the native annotation manager's `setFilter()` and `_hidden` state: those also control visibility on the PDF page. Saved annotations are preserved; the only native filter change is removing an active black color selection through the swatch's existing toggle behavior.

The annotation hit-target feature wraps each PDF view's `getSelectableAnnotations()` and `getSelectedAnnotationAction()`. Zotero calls these before choosing text selection, annotation dragging, and context menu actions. Only `underline` and `image` (area) annotations are narrowed; other candidates and native selected-text priority are retained. Selected range/resize handles use native actions, while selected annotation interiors no longer trigger dragging. Added edge candidates allow clicking strokes just outside the original text rectangle, including rotated underlines.

Stroke geometry follows the reader's rendering rules, using character rotation, the current page viewport, and per-page rectangles for cross-page annotations. `getViewPoint()` and `getViewRect()` return backing pixels; hit padding is converted from CSS pixels using `getPageByIndex(pageIndex).originalPage.outputScale`. Do not read `PDFViewerApplication` directly from the nested PDF window: Gecko security wrappers can hide that global from plugin code. A missing or unready page scale preserves native hit candidates and selected actions for that event and allows the next event to retry. Regression tests cover both a hidden/blocked global and late output-scale availability. Character rotation results are weakly cached by rectangle and character-array identity, while page rotation is read on every hit. The two-CSS-pixel allowance surrounds the rendered stroke (area borders also include half their two-pixel width).

The feature handles direct PDF views and newer `View._view` wrappers, observing outer-document changes and frame loads for split/replaced views. Shutdown and view removal restore original method descriptors; a later wrapper installed by another plugin is preserved, and any chained plugin wrapper becomes inactive. These are internal APIs checked against the Zotero 7.0.24 and 10.0.6 sources linked above, so recheck them when upgrading Zotero.

The self-contained patch factory is compiled with the unwrapped outer reader window's `Function` constructor. Both mouse callbacks and newly created return arrays therefore belong to the reader realm. Do not directly assign privileged bootstrap closures to content methods or clone annotation objects: Gecko's security boundary can reject privileged callbacks/objects, and native selection depends on annotation identity. Only the static factory source is compiled; document text and user input are never evaluated. Factory compilation failures leave native callbacks intact. Errors in custom hit testing restore both native methods for that view and return the existing native result for the current event. Other-plugin wrappers are preserved; the disabled patch is not retried on every DOM mutation. Consult [Gecko script security](https://firefox-source-docs.mozilla.org/dom/scriptSecurity/index.html) when changing this boundary.

## Formatting

Use UTF-8, LF line endings, and two-space indentation, as configured in `.editorconfig`. Use kebab-case filenames and keep generated artifacts out of source directories.
