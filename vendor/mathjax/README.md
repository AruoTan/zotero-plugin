# Offline MathJax renderer

`tex-svg.js` is a generated, self-contained bundle of **MathJax 3.2.2**, licensed
under [Apache-2.0](LICENSE). Upstream: [MathJax source](https://github.com/mathjax/MathJax-src/tree/3.2.2),
distributed as [`mathjax-full@3.2.2`](https://www.npmjs.com/package/mathjax-full/v/3.2.2).
Copyright (c) 2017-2022 The MathJax Consortium.
The upstream code is bundled without changes; `entry.cjs` is this plugin's adapter.

The adapter preloads TeX, the AMS/newcommand/boldsymbol extensions, SVG output,
and the lightweight DOM adaptor. It returns self-contained SVG strings with
glyph paths, without browser globals, Node APIs, external fonts, or resource
loading. A new TeX context per expression isolates user macros and labels.
HTML, autoload, and require extensions are not enabled. Invalid expressions
throw so the reader can retain their original source.

MathJax 3.2.2 is pinned for its complete, synchronous SVG font data and support
for the plugin's older Gecko versions. Moving to MathJax 4 requires revisiting
its asynchronous font loading and bundling all required data for offline use.

Normal builds use the checked-in bundle and require no package installation.
To regenerate it with Node.js and npm installed:

```sh
bash scripts/vendor-mathjax.sh
```

The script uses a temporary npm prefix and pinned MathJax/esbuild versions;
it does not create project `node_modules` or modify a user npm installation.
Review the regenerated bundle and license together. The build concatenates
the bundle into `bootstrap.js` and includes `vendor/mathjax/LICENSE` in the XPI.

The SVG path output follows MathJax's [SVG output configuration](https://docs.mathjax.org/en/v3.2/options/output/svg.html).
Delimiter parsing uses its native `FindTeX` parser with explicit inline/display
delimiters; standalone environments outside those delimiters are left as text.
