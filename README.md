# zotero-plugin

A personal Zotero plugin for custom reader behavior and other features as needed.

## Features

### Alt-triggered selection popup

The reader's text-selection popup is hidden by default. Hold **Alt** before releasing the mouse to show it for that selection.

- Select text normally → no popup.
- Hold **Alt** before releasing the mouse → popup appears for that selection.
- Click elsewhere → popup vanishes.

Works in the PDF reader and (best-effort) in the EPUB / snapshot readers.

### Handwritten PDF text

Text inserted with the PDF reader's **Add Text** tool uses **荷塘月色手写体 (Hetang Yuese)** for Chinese, its native handwritten English letters, and digits. A single face keeps mixed-language annotations consistent in stroke weight and style. The font is embedded in the generated script, works offline, and does not need to be installed on your system.

The style applies to both existing and newly created text annotations while the plugin is enabled, including split views. Disabling the plugin restores the reader's normal font. PDF body text, notes, and the Zotero interface keep their existing fonts.

This is a local reader display setting. It does not store a font choice in annotation data or embed the font into exported PDFs; other devices and external PDF viewers may display a different font.

### Hide black text annotations in the sidebar

In PDF readers, pure black (`#000000`) annotations made with **Add Text** are hidden from the sidebar's annotation list. This applies to existing and new text annotations. Changing their color updates the list automatically: black hides the entry, and another color restores it.

The text remains visible and editable on the PDF page, and the saved annotation data is preserved. Other annotation types, including black highlights, underlines, and sticky notes, keep their normal sidebar entries. Disabling the plugin restores the hidden entries. Search and color filters continue to work on the remaining entries.

The black swatch is also hidden from the sidebar's color filter. If black is already selected, the plugin deselects it before hiding the swatch, preserving other selected colors, tags, and the search query. Disabling the plugin restores the swatch.

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
│       └── black-text-sidebar-filter.js # Hide black Add Text sidebar entries
├── assets/fonts/                 # Bundled font, license, and source attribution
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

- Zotero 7.x: the popup feature was previously tested on 7.0.24; handwriting and sidebar filtering have source and automated checks but still need validation in Zotero.
- Zotero 8–9: untested.
- Zotero 10.0.x: declared compatible; installer requirements and reader integration checked against 10.0.6 source. Runtime validation is still required.

## License

Plugin code: MIT — see [LICENSE](LICENSE).

Bundled font: see [font attribution](assets/fonts/README.md) and [Hetang Yuese author declaration](assets/fonts/HetangYuese-NOTICE.txt).
