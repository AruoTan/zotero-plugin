# zotero-plugin

A personal Zotero plugin for custom reader behavior and other features as needed.

## Features

### Hide PDF annotation tags in the library tag selector

The tag selector at the bottom of Zotero's left library pane excludes tags contributed only by PDF annotations. Tags assigned to regular items, notes, or attachments remain visible. If the same tag is used on both a PDF annotation and an ordinary item, its ordinary item association is retained. Tags in PDF readers remain available.

This follows the current library, collection, saved search, and **Display All Tags** setting, including selections across libraries. Annotation-only colored tags are also hidden; unused colored presets remain available. Adding or removing tags updates the list, and any hidden active tag filter is cleared while other selected tags remain selected. No tags or color settings are deleted. Disabling the plugin restores the native tag list.

### Alt-triggered selection popup

The reader's text-selection popup is hidden by default. Hold **Alt** before releasing the mouse to show it for that selection.

- Select text normally → no popup.
- Hold **Alt** before releasing the mouse → popup appears for that selection.
- Click elsewhere → popup vanishes.

Works in the PDF reader and (best-effort) in the EPUB / snapshot readers.

### Handwritten PDF text

Text inserted with the PDF reader's **Add Text** tool uses **荷塘月色手写体 (Hetang Yuese)** for Chinese, its native handwritten English letters, and digits. A single face keeps mixed-language annotations consistent in stroke weight and style. The font is embedded in the generated script, works offline, and does not need to be installed on your system.

The style applies to both existing and newly created text annotations while the plugin is enabled, including split views and their entries in the sidebar's annotation list. Sidebar Add Text content uses the same face while viewing formulas or editing their source; MathJax symbols keep their mathematical glyphs. Other annotation types and sidebar headers keep their existing fonts. Disabling the plugin restores the reader's normal font. PDF body text, notes, and the rest of the Zotero interface keep their existing fonts.

This is a local reader display setting. It does not store a font choice in annotation data or embed the font into exported PDFs; other devices and external PDF viewers may display a different font.

### Fit Add Text bounds after editing

After leaving an **Add Text** editor on the PDF page or in the sidebar, the plugin fits the annotation rectangle to its rendered handwriting and MathJax content. Explicit line breaks are preserved, and wrapped text stays within the available width. A small padding prevents fractional glyphs from being clipped. Finishing a manual resize preserves the chosen width and recalculates the height from rendered content, removing extra lines caused by measuring LaTeX source. Re-entering editing restores room for the original source text.

The native selection border and click target use the new dimensions, and Zotero saves the updated rectangle through its normal annotation manager, including undo support. The rendered top-left stays anchored when possible, including rotated annotations; near page edges the rectangle is kept on the page. Read-only annotations are left unchanged. This happens after editing; opening a PDF does not resize all saved annotations. Disabling the plugin stops automatic sizing and retains already saved dimensions.

### MathJax in PDF text annotations

Use the PDF reader's **Add Text** tool to mix ordinary text with LaTeX formulas:

```text
质能关系：$E=mc^2$
行内公式：\(x_1 + x_2\)
$$\frac{1}{\sqrt{1+x^2}}$$
\[\int_0^1 x^2\,dx = \frac{1}{3}\]
```

While editing, the native text box shows the original LaTeX source. Click outside it or press **Escape** to show the rendered formulas. Edit it again using Zotero's normal text annotation interaction. Ordinary Chinese and English text keeps the handwritten font; mathematical symbols use MathJax's mathematical glyphs.

MathJax is bundled and works offline, including fractions, roots, integrals, matrices, and AMS notation. Both existing and new annotations work in split views. PDF page previews follow the native color, font size, zoom, and rotation and shrink to fit the annotation rectangle; enlarge that rectangle when more room is needed. Invalid or unsupported formulas remain as source text. To write a literal dollar sign beside formulas, use `\$`.

The PDF reader's sidebar annotation list also renders formulas in annotation comments and extracted text. Native rich-text formatting and line breaks are preserved. Focus the original editor to edit the source, then leave it to restore the formula preview. Selecting, searching, filtering, and dragging annotations retain their normal behavior, including the rule that hides black Add Text entries. Other annotation types keep their usual collapsed preview limit; expand an entry to see longer formulas.

For **Add Text** entries, the complete handwritten text and formulas scale together to fit the card width. The preview uses the PDF annotation's font size and wrapping width before scaling, preserving line breaks, spacing, and formula placement. Resizing the sidebar recalculates the scale without reflowing the content. Plain text and unsupported formula source receive the same layout treatment. The card height follows the scaled content, and entering edit mode restores Zotero's normal source editor. This is a sidebar display change and does not resize the saved PDF annotation.

Hover over an **Add Text** card for 600 ms to open an enlarged preview with the same handwriting, formulas, and line layout. Move into the popup to scroll longer content. Moving away, pressing **Escape**, clicking to edit, or scrolling the sidebar dismisses it. Other annotation types retain their normal hover behavior.

This renders formulas locally in the PDF reader. Saved annotations retain their LaTeX source; automatic fitting updates their rectangle after editing as described above. Exported PDFs and other PDF viewers do not receive the rendered preview. Disabling the plugin restores Zotero's source-text display. PDF body text and note editors are unaffected.

### Hide black text annotations in the sidebar

In PDF readers, pure black (`#000000`) annotations made with **Add Text** are hidden from the sidebar's annotation list. This applies to existing and new text annotations. Changing their color updates the list automatically: black hides the entry, and another color restores it.

The text remains visible and editable on the PDF page, and the saved annotation data is preserved. Other annotation types, including black highlights, underlines, and sticky notes, keep their normal sidebar entries. Disabling the plugin restores the hidden entries. Search and color filters continue to work on the remaining entries.

The black swatch is also hidden from the sidebar's color filter. If black is already selected, the plugin deselects it before hiding the swatch, preserving other selected colors, tags, and the search query. Disabling the plugin restores the swatch.

### Select content beneath underlines and area annotations

In PDF readers, click or drag on underlined text or inside an **area annotation** to interact with the underlying content, including selecting text and copying it. Click the underline stroke or the area annotation's border to select the annotation. A small hit allowance makes thin strokes easier to click at different zoom levels.

This also applies when the annotation is already selected. Its visible range or resize handles remain usable. Highlights and other annotation types keep their normal behavior. Existing and new PDF readers, split views, and rotated pages are supported; disabling the plugin restores Zotero's original hit targets. Annotation content and saved positions are unchanged.

If the hit-target feature encounters an error, that PDF view falls back to Zotero's original hit targets so normal mouse interaction can continue.

### Locate sidebar annotations with a header double-click

In PDF readers, a single click in the sidebar annotation list selects the annotation without scrolling the PDF. Double-click the blank area of the annotation's top header bar to scroll to its location. This applies to all annotation types and uses the active PDF view in split readers.

Double-clicking annotation content retains its native editing behavior. The page label, menu button, and other header controls retain their own actions. Modifier clicks still use native multi-selection; keyboard navigation and navigation initiated elsewhere keep their normal behavior. Disabling the plugin restores single-click PDF navigation.

## Install

1. Build `dist/zotero-plugin.xpi` from source, or download `zotero-plugin.xpi` from the [latest release](https://github.com/AruoTan/zotero-plugin/releases/latest) when available.
2. In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…** and pick the `.xpi`.

Plugin ID: `vnmhgrjk@sfirstmail.com`.

Zotero requires an update URL even for personal plugins. The manifest points to this repository's `master/update.json`; the supplied file has an empty update list, so it advertises no releases. Publish that file at the configured URL if using update checks.

## Project structure

```text
.
├── src/
│   ├── bootstrap.js              # Plugin lifecycle and feature registration
│   └── features/
│       ├── selection-popup.js    # Alt-triggered selection popup
│       ├── handwritten-text.js   # PDF text annotation handwriting
│       ├── black-text-sidebar-filter.js # Hide black Add Text sidebar entries
│       ├── annotation-hit-targets.js # Underline strokes and area borders only
│       ├── math-text.js           # Offline MathJax in PDF text and sidebar entries
│       ├── text-annotation-size.js # Fit native bounds after editing
│       ├── sidebar-annotation-navigation.js # Locate from a header double-click
│       └── library-tag-filter.js  # Exclude PDF annotation tags from the library selector
├── assets/fonts/                 # Bundled font, license, and source attribution
├── vendor/mathjax/               # Pinned SVG engine, adapter source, and license
├── tests/                        # Feature lifecycle regression tests
├── scripts/
│   ├── build.sh                  # Bundle and package the plugin
│   └── dev-install.sh            # Build and install into a local profile
├── docs/
│   └── development.md            # Development conventions and validation
├── dist/                         # Generated packages (ignored by Git)
├── .devcontainer/                # Development container configuration
├── .editorconfig                # Formatting conventions
├── manifest.json                # Plugin metadata
├── update.json                  # Update manifest (empty release list)
└── LICENSE
```

## Build from source

Run from the repository root:

```sh
bash scripts/build.sh
```

Requires Bash, `zip`, `base64`, and `tr`. The output is `dist/zotero-plugin.xpi`; no JavaScript toolchain is required.

## Development install

Quit Zotero, then run:

```sh
ZOTERO_PROFILE="/path/to/your/zotero/profile" bash scripts/dev-install.sh
```

The profile must already contain an `extensions` directory. The script builds and installs the plugin, then clears extension startup caches. Restart Zotero to load the plugin.

See [the development guide](docs/development.md) for feature organization and verification steps.

## Compatibility

- Zotero 7.x: the popup feature was previously tested on 7.0.24; handwriting, sidebar filtering, annotation hit targets, and MathJax previews have source and automated checks but still need validation in Zotero.
- Zotero 8–9: untested.
- Zotero 10.0.x: declared compatible; installer requirements and reader integration checked against 10.0.6 source. Runtime validation is still required.

## License

Plugin code: MIT — see [LICENSE](LICENSE).

Bundled font: see [font attribution](assets/fonts/README.md) and [Hetang Yuese author declaration](assets/fonts/HetangYuese-NOTICE.txt).

Bundled MathJax: Apache-2.0 — see [license](vendor/mathjax/LICENSE) and [source attribution](vendor/mathjax/README.md).
