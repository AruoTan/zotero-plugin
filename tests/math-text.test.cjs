const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const engineSource = fs.readFileSync(path.join(__dirname, "../vendor/mathjax/tex-svg.js"), "utf8");
const featureSource = fs.readFileSync(path.join(__dirname, "../src/features/math-text.js"), "utf8");
const engineScope = vm.createContext({});
vm.runInContext(engineSource, engineScope);
const engine = engineScope.ZoteroPluginMathJax;
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);

test("real offline MathJax parses four delimiters, escaped dollars, multiline math, and mixed text", () => {
  const parts = plain(engine.split(String.raw`中文 $x^2$ English \(y_1\)
$$\frac{a}{b}$$ \[\begin{pmatrix}1&2\\3&4\end{pmatrix}\]`));
  assert.deepEqual(parts.filter(part => part.math !== undefined).map(part => [part.math, part.display]), [
    ["x^2", false], ["y_1", false], [String.raw`\frac{a}{b}`, true],
    [String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, true],
  ]);
  assert.equal(parts[0].text, "中文 ");
  assert.deepEqual(plain(engine.split(String.raw`\$5 plus $x$`)), [
    { text: "$" }, { text: "5 plus " }, { math: "x", display: false, raw: "$x$" },
  ]);
  for (const text of ["ordinary 中文 English 123", "$unfinished", String.raw`\$5`, "x".repeat(32769)]) {
    assert.equal(engine.split(text), null);
  }
  assert.equal(engine.split("$x$ ".repeat(65)), null);
});

test("real renderer produces self-contained SVG for fractions, roots, integrals, matrices, and Chinese", () => {
  for (const tex of [String.raw`\frac{1}{\sqrt{1+x^2}}`, String.raw`\int_0^1 x^2\,dx`,
    String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`, String.raw`\text{中文} + \boldsymbol{x}`]) {
    const svg = engine.render(tex, true);
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    assert.match(svg, /viewBox=/);
    assert.doesNotMatch(svg, /<(?:script|image|a|use)\b|(?:href|src)=|data-mml-node="merror"/);
  }
  assert.throws(() => engine.render(String.raw`\frac{a}`));
  assert.throws(() => engine.render(String.raw`\unknowncommand{x}`));
  assert.throws(() => engine.render("x".repeat(8193)));
  assert.throws(() => engine.render(String.raw`\def\loop{\loop}\loop`));
});

test("formula definitions do not leak and URL/HTML/autoload commands cannot load external resources", () => {
  assert.match(engine.render(String.raw`\newcommand{\myvalue}{x}\myvalue`), /<svg/);
  assert.throws(() => engine.render(String.raw`\myvalue`));
  for (const tex of [String.raw`\require{html}`, String.raw`\href{javascript:alert(1)}{x}`,
    String.raw`\includegraphics{https://example.com/a.svg}`, String.raw`\htmlClass{evil}{x}`]) {
    assert.throws(() => engine.render(tex));
  }
});

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, target) { for (const fn of listeners.get(type) || []) fn({ type, target }); },
  };
}

function element(name, doc) {
  const attributes = new Map();
  return {
    localName: name, ownerDocument: doc, children: [], style: { cssText: "" },
    clientWidth: 200, clientHeight: 40, scrollWidth: 200, scrollHeight: 40,
    appendChild(node) {
      node.remove();
      this.children.push(node);
      node.parentElement = this;
      return node;
    },
    remove() {
      if (this.parentElement) {
        const siblings = this.parentElement.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parentElement = null;
      }
    },
    setAttribute(key, value) { attributes.set(key, value); },
    getAttribute(key) { return attributes.get(key) ?? null; },
    removeAttribute(key) { attributes.delete(key); },
    matches(selector) { return name === "textarea" && selector.includes("textarea.textAnnotation"); },
    get textContent() { return this.text ?? this.children.map(child => child.textContent).join(""); },
    set textContent(value) { this.text = value; },
  };
}

function documentMock(uri = "resource://zotero/reader/pdf/web/viewer.html") {
  const doc = Object.assign(eventTarget(), {
    documentURI: uri, textAnnotations: [], frames: [], observers: [], activeElement: null,
    fonts: eventTarget(),
  });
  doc.createElement = name => element(name, doc);
  doc.createTextNode = text => Object.assign(element("#text", doc), { text });
  doc.importNode = node => Object.assign(element(node.localName, doc), { markup: node.markup });
  doc.documentElement = doc.createElement("html");
  doc.head = doc.createElement("head");
  doc.querySelectorAll = selector => selector === "iframe" ? doc.frames : doc.textAnnotations;
  doc.defaultView = Object.assign(eventTarget(), {
    document: doc,
    getComputedStyle: node => ({ fontFamily: "ZoteroPluginHandwriting", lineHeight: "normal", padding: "0px", direction: node.dir || "ltr", textAlign: "start" }),
    DOMParser: class {
      parseFromString(markup) { return { documentElement: { localName: "svg", markup } }; }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; doc.observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
      trigger() { if (this.connected) this.callback(); }
    },
  });
  return doc;
}

function annotation(doc, value) {
  const page = doc.createElement("div");
  const layer = doc.createElement("div");
  const node = doc.createElement("textarea");
  page.appendChild(layer);
  layer.appendChild(node);
  node.value = value;
  node.style.cssText = "left:10px;top:20px;width:200px;height:40px;transform:rotate(90deg);color:rgb(20,40,60)";
  doc.textAnnotations.push(node);
  return node;
}

function readerMock(pdf = documentMock(), type = "pdf") {
  const outer = documentMock("resource://zotero/reader/reader.html");
  const frame = { contentDocument: pdf, getAttribute: () => "pdf/web/viewer.html" };
  outer.frames.push(frame);
  return {
    _type: type, tabID: Math.random().toString(), _iframeWindow: outer.defaultView,
    _initPromise: Promise.resolve(), _waitForReader: async () => {}, outer, frame,
  };
}

function harness(readers = []) {
  const events = new Map(), notifiers = new Map(), errors = [];
  const scope = vm.createContext({
    ZoteroPluginMathJax: engine,
    Zotero: {
      debug(error) { errors.push(error); },
      Reader: {
        _readers: readers,
        registerEventListener(type, fn) { events.set(type, fn); },
        unregisterEventListener(type) { events.delete(type); },
        getByTabID: id => readers.find(reader => reader.tabID === id),
      },
      Notifier: {
        registerObserver(observer) { notifiers.set(observer, observer); return observer; },
        unregisterObserver(id) { notifiers.delete(id); },
      },
    },
  });
  vm.runInContext(featureSource, scope);
  const feature = scope.ZoteroPluginMathText;
  return {
    feature, events, notifiers, errors,
    start() { feature.startup({ id: "test" }); },
    notify(event, ids) { for (const observer of notifiers.values()) observer.notify(event, "tab", ids); },
  };
}

const preview = node => node.parentElement.parentElement.children.find(child => child.className === "zotero-plugin-math-preview");

test("renders existing formulas beside the native layer, preserving geometry, handwriting, and saved source", async () => {
  const doc = documentMock();
  const node = annotation(doc, String.raw`说明 <img onerror=alert(1)> $\frac{a}{b}$`);
  const plainNode = annotation(doc, "ordinary text");
  const app = harness([readerMock(doc)]);
  app.start();
  await flush();
  const overlay = preview(node);
  assert.ok(overlay);
  assert.equal(node.parentElement.children.length, 1, "native child diffing sees only the textarea");
  assert.equal(overlay.style.cssText, node.style.cssText, "geometry, font size, rotation, and color follow native styles");
  assert.equal(overlay.style.fontFamily, "ZoteroPluginHandwriting");
  assert.equal(overlay.getAttribute("aria-hidden"), "true");
  assert.match(overlay.children[0].textContent, /<img onerror=alert\(1\)>/);
  assert.match(overlay.children[0].children.find(child => child.localName === "span").children[0].markup, /<svg/);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), "");
  assert.equal(plainNode.getAttribute("data-zotero-plugin-math"), null);
  assert.equal(preview(plainNode), undefined);
  assert.equal(node.value, String.raw`说明 <img onerror=alert(1)> $\frac{a}{b}$`);
  assert.match(doc.head.children[0].textContent, /pointer-events: none !important/);
  app.feature.shutdown();
  assert.equal(preview(node), undefined);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  assert.equal(doc.head.children.length, 0);
  assert.equal(doc.observers[0].connected, false);
  assert.equal(app.events.size, 0);
  assert.equal(app.notifiers.size, 0);
  assert.deepEqual(app.errors, []);
});

test("focus exposes the original source, input stays native, and blur refreshes or removes preview", async () => {
  const doc = documentMock(), node = annotation(doc, "$x^2$");
  const app = harness([readerMock(doc)]);
  app.start(); await flush();
  doc.activeElement = node;
  doc.emit("focusin", node);
  assert.equal(preview(node).hidden, true);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  node.value = "$y_1$";
  doc.emit("input", node);
  await flush();
  assert.equal(preview(node).hidden, true);
  assert.equal(node.value, "$y_1$");
  doc.activeElement = null;
  doc.emit("focusout", node);
  await flush();
  assert.equal(preview(node).hidden, false);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), "");
  node.value = "now plain";
  doc.observers[0].trigger();
  await flush();
  assert.equal(preview(node), undefined);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  app.feature.shutdown();
});

test("unsupported or incomplete equations fall back to source while valid neighbors still render", async () => {
  const doc = documentMock();
  const bad = annotation(doc, String.raw`$\badcommand$`);
  const mixed = annotation(doc, String.raw`$x^2$ and $\frac{a}$`);
  const incomplete = annotation(doc, "$unfinished");
  const app = harness([readerMock(doc)]);
  app.start(); await flush();
  assert.equal(preview(bad), undefined);
  assert.equal(preview(incomplete), undefined);
  assert.match(preview(mixed).textContent, /\$\\frac\{a\}\$/);
  assert.deepEqual(app.errors, []);
  app.feature.shutdown();
});

test("native style changes and font readiness refresh layout without retypesetting; removed nodes clean up", async () => {
  const doc = documentMock(), node = annotation(doc, "$x$");
  const app = harness([readerMock(doc)]);
  app.start(); await flush();
  const content = preview(node).children[0];
  content.scrollHeight = 80;
  node.style.cssText = "left:50px;top:60px;transform:rotate(180deg);color:blue;font-size:32px";
  doc.observers[0].trigger();
  await flush();
  assert.equal(preview(node).children[0], content);
  assert.equal(preview(node).style.cssText, node.style.cssText);
  assert.equal(content.style.transform, "scale(0.5)");
  doc.fonts.emit("loadingdone");
  await flush();
  assert.equal(preview(node).children[0], content);
  doc.textAnnotations.length = 0;
  doc.observers[0].trigger();
  await flush();
  assert.equal(preview(node), undefined);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  app.feature.shutdown();
});

test("new tabs, delayed frame loads, split views, view replacement, and tab/window closure release resources", async () => {
  const readers = [], app = harness(readers);
  const first = documentMock("about:blank"), reader = readerMock(first);
  app.start(); readers.push(reader); app.notify("add", [reader.tabID]); await flush();
  assert.equal(first.head.children.length, 0);
  const primary = documentMock(), secondary = documentMock();
  const one = annotation(primary, "$x$"), two = annotation(secondary, "$y$");
  reader.frame.contentDocument = primary;
  reader.outer.emit("load"); await flush();
  reader.outer.frames.push({ contentDocument: secondary, getAttribute: () => "pdf/web/viewer.html" });
  reader.outer.observers[0].trigger(); await flush();
  assert.ok(preview(one)); assert.ok(preview(two));
  app.events.get("renderToolbar")({ reader }); await flush();
  assert.equal(primary.head.children.length, 1);
  reader.outer.frames.pop(); reader.outer.observers[0].trigger(); await flush();
  assert.equal(preview(two), undefined);
  app.notify("close", [reader.tabID]);
  assert.equal(preview(one), undefined);
  assert.equal(primary.listeners.get("input").size, 0);
  app.events.get("renderToolbar")({ reader }); await flush();
  assert.ok(preview(one));
  reader.outer.defaultView.emit("unload");
  assert.equal(preview(one), undefined);
  app.feature.shutdown();
});

test("EPUB/unrelated frames stay untouched and pending initialization or queued scans cannot survive shutdown", async () => {
  const doc = documentMock(), epub = readerMock(doc, "epub");
  const unrelated = readerMock(doc); unrelated.frame.getAttribute = () => "other.html";
  const pending = readerMock(doc);
  let resolve;
  pending._initPromise = new Promise(done => { resolve = done; });
  const app = harness([epub, unrelated, pending]);
  app.start(); await flush(); app.feature.shutdown(); resolve(); await flush();
  assert.equal(doc.head.children.length, 0);
  app.start(); await flush();
  const node = annotation(doc, "$z$");
  doc.observers[0].trigger();
  app.feature.shutdown(); await flush();
  assert.equal(preview(node), undefined);
  assert.equal(doc.head.children.length, 0);
});

test("an already focused annotation stays editable until blur and a replaced PDF document is cleaned up", async () => {
  const first = documentMock(), node = annotation(first, "$x$");
  first.activeElement = node;
  const reader = readerMock(first), app = harness([reader]);
  app.start(); await flush();
  assert.equal(preview(node), undefined);
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  first.activeElement = null;
  first.emit("focusout", node); await flush();
  assert.ok(preview(node));
  const next = documentMock(), other = annotation(next, "$y$");
  reader.frame.contentDocument = next;
  reader.outer.emit("load"); await flush();
  assert.equal(preview(node), undefined);
  assert.equal(first.observers[0].connected, false);
  assert.ok(preview(other));
  app.feature.shutdown();
});

test("DOM conversion failures retain source and do not retry until the annotation changes", async () => {
  const doc = documentMock(), node = annotation(doc, "$x$");
  let attempts = 0;
  const Parser = doc.defaultView.DOMParser;
  doc.defaultView.DOMParser = class { constructor() { attempts++; throw new Error("Unavailable parser"); } };
  const app = harness([readerMock(doc)]);
  app.start(); await flush();
  assert.equal(node.getAttribute("data-zotero-plugin-math"), null);
  assert.equal(preview(node), undefined);
  assert.equal(app.errors.length, 1);
  doc.observers[0].trigger(); await flush();
  assert.equal(attempts, 1);
  doc.defaultView.DOMParser = Parser;
  node.value = "$y$";
  doc.observers[0].trigger(); await flush();
  assert.ok(preview(node));
  app.feature.shutdown();
});
