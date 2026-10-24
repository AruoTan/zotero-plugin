# zotero-plugin

A personal Zotero plugin for custom reader behavior and other features as needed.

## Features

### Alt-triggered selection popup

The reader's text-selection popup is hidden by default. Hold **Alt** before releasing the mouse to show it for that selection.

- Select text normally → no popup.
- Hold **Alt** before releasing the mouse → popup appears for that selection.
- Click elsewhere → popup vanishes.

Works in the PDF reader and (best-effort) in the EPUB / snapshot readers.

## Install

1. Build `zotero-plugin.xpi` from source, or download it from the [latest release](https://github.com/AruoTan/zotero-plugin/releases/latest) when available.
2. In Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…** and pick the `.xpi`.

Plugin ID: `vnmhgrjk@sfirstmail.com`.

## Build from source

```sh
zip -r zotero-plugin.xpi manifest.json bootstrap.js
```

No toolchain is required.

## Development install

Quit Zotero, then run:

```sh
ZOTERO_PROFILE="/path/to/your/zotero/profile" bash dev-install.sh
```

The script builds `zotero-plugin.xpi` and installs it into the specified profile. Restart Zotero to load the plugin.

## Compatibility

- Zotero 7.x (tested on 7.0.24)
- Zotero 8 (untested)

## License

MIT — see [LICENSE](LICENSE).
