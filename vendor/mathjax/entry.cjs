// Source for the offline bundle; regenerate with scripts/vendor-mathjax.sh.
const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { SVG } = require("mathjax-full/js/output/svg.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
const { FindTeX } = require("mathjax-full/js/input/tex/FindTeX.js");
require("mathjax-full/js/input/tex/ams/AmsConfiguration.js");
require("mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js");
require("mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js");

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const finder = new FindTeX({
  inlineMath: [["$", "$"], ["\\(", "\\)"]],
  displayMath: [["$$", "$$"], ["\\[", "\\]"]],
  processEscapes: true,
  processEnvironments: false,
  processRefs: false,
});

function split(source) {
  if (source.length > 32768) return null;
  const matches = finder.findMath([source]);
  if (!matches.some(match => typeof match.display === "boolean") || matches.length > 64) return null;
  const parts = [];
  let index = 0;
  for (const match of matches) {
    if (match.start.n > index) parts.push({ text: source.slice(index, match.start.n) });
    parts.push(typeof match.display === "boolean"
      ? { math: match.math, display: match.display, raw: source.slice(match.start.n, match.end.n) }
      : { text: match.math });
    index = match.end.n;
  }
  if (index < source.length) parts.push({ text: source.slice(index) });
  return parts;
}

function render(source, display = false) {
  if (typeof source !== "string" || source.length > 8192) {
    throw new Error("Math expression exceeds the 8192-character limit");
  }
  // Isolate definitions and labels between expressions and annotations. Do not
  // enable autoload, require, or HTML extensions: rendering is entirely local.
  const input = new TeX({
    packages: ["base", "ams", "newcommand", "boldsymbol"],
    maxBuffer: 8192,
    maxMacros: 1000,
    formatError(_jax, error) { throw error; },
  });
  const output = new SVG({ fontCache: "none", mtextInheritFont: true });
  const doc = mathjax.document("", { InputJax: input, OutputJax: output });
  try {
    const container = doc.convert(source, { display, em: 16, ex: 8, containerWidth: 1280 });
    const svg = adaptor.tags(container, "svg")[0];
    if (!svg || adaptor.tags(svg, "merror").length) throw new Error("Invalid math expression");
    return adaptor.outerHTML(svg);
  } finally {
    doc.clear();
  }
}

module.exports = { render, split };
