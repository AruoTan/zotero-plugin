const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/handwritten-text.js"), "utf8");
const flush = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    emit(type) { for (const handler of listeners.get(type) || []) handler(); },
  };
}

function documentMock({ load, loads = {}, uri = "resource://zotero/reader/reader.html" } = {}) {
  const doc = Object.assign(eventTarget(), {
    documentURI: uri,
    documentElement: {},
    frames: [],
    textAnnotations: [],
    fonts: new Set(),
    styles: [],
    observers: [],
    createdFonts: [],
  });
  const win = Object.assign(eventTarget(), {
    document: doc,
    // Emulate Gecko's separate unwrapped page globals.
    wrappedJSObject: { computedFontFamily: "Original Sans" },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; doc.observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
      trigger() { if (this.connected) this.callback(); }
    },
    FontFace: class {
      constructor(family, source) { this.family = family; this.source = source; doc.createdFonts.push(this); }
      async load() { const pending = loads[this.family] || load; if (pending) await pending.promise; return this; }
    },
  });
  doc.defaultView = win;
  doc.head = { appendChild(style) { doc.styles.push(style); } };
  doc.createElement = () => ({
    remove() { const index = doc.styles.indexOf(this); if (index !== -1) doc.styles.splice(index, 1); },
  });
  doc.querySelectorAll = (selector) => selector === "iframe" ? doc.frames : doc.textAnnotations;
  return doc;
}

function frame(doc, src = "pdf/web/viewer.html") {
  return { contentDocument: doc, getAttribute: () => src };
}

function readerMock(doc, type = "pdf") {
  return {
    _type: type,
    tabID: "test-tab",
    _iframeWindow: doc.defaultView,
    _initPromise: Promise.resolve(),
    _waitForReader: async () => {},
    _internalReader: { _primaryView: { _render() {} } },
  };
}

function harness(readers = []) {
  const events = new Map();
  const notifiers = new Map();
  const errors = [];
  let nextID = 0;
  const Zotero = {
    debug(error) { errors.push(error); },
    Reader: {
      _readers: readers,
      registerEventListener(type, handler) { events.set(type, handler); },
      unregisterEventListener(type, handler) { if (events.get(type) === handler) events.delete(type); },
      getByTabID(id) { return readers.find(reader => reader.tabID === id); },
    },
    Notifier: {
      registerObserver(observer) { notifiers.set(++nextID, observer); return nextID; },
      unregisterObserver(id) { notifiers.delete(id); },
    },
  };
  const context = vm.createContext({ Zotero, ZoteroPluginHandwritingFonts: [
    { family: "ZoteroPluginHandwriting", source: "data:font/ttf;base64,HANDWRITING" },
  ] });
  vm.runInContext(source, context);
  const feature = context.ZoteroPluginHandwrittenText;
  return {
    feature, events, notifiers, errors,
    start() { feature.startup({ id: "test-plugin" }); },
    notify(event, ids) { for (const observer of notifiers.values()) observer.notify(event, "tab", ids); },
  };
}

test("styles existing PDF views and restores globals, inline fonts, and resources on disable", async () => {
  const outer = documentMock();
  const pdf = documentMock({ uri: "resource://zotero/reader/pdf/web/viewer.html" });
  outer.frames.push(frame(pdf));
  const reader = readerMock(outer);
  let renders = 0;
  reader._internalReader._primaryView._render = () => { renders++; };
  const app = harness([reader]);
  app.start();
  await flush();
  assert.match(outer.defaultView.wrappedJSObject.computedFontFamily, /ZoteroPluginHandwriting/);
  for (const doc of [outer, pdf]) {
    assert.equal(doc.fonts.size, 1);
    assert.equal(doc.styles.length, 1);
    assert.match(doc.styles[0].textContent, /\.customAnnotationLayer textarea\.textAnnotation/);
    doc.textAnnotations.push({ style: { fontFamily: '"ZoteroPluginHandwriting", Original Sans' } });
  }
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily,
    '"ZoteroPluginHandwriting", Original Sans');
  for (const doc of [outer, pdf]) {
    assert.deepEqual(Array.from(doc.fonts, font => font.family),
      ["ZoteroPluginHandwriting"]);
  }
  assert.ok(renders > 0);
  app.feature.shutdown();
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
  for (const doc of [outer, pdf]) {
    assert.equal(doc.styles.length, 0);
    assert.equal(doc.fonts.size, 0);
    assert.equal(doc.textAnnotations[0].style.fontFamily, "Original Sans");
  }
  assert.equal(app.events.size, 0);
  assert.equal(app.notifiers.size, 0);
  assert.equal(outer.observers[0].connected, false);
  assert.equal(outer.listeners.get("load").size, 0);
  assert.equal(outer.defaultView.listeners.get("unload").size, 0);
  assert.deepEqual(app.errors, []);
});

test("handles new tabs, late iframe loads, split views, and detached frame cleanup", async () => {
  const readers = [];
  const app = harness(readers);
  app.start();
  const outer = documentMock();
  const reader = readerMock(outer);
  readers.push(reader);
  app.notify("add", [reader.tabID]);
  await flush();
  const blank = documentMock({ uri: "about:blank" });
  const primaryFrame = frame(blank);
  outer.frames.push(primaryFrame);
  outer.observers[0].trigger();
  await flush();
  assert.equal(blank.createdFonts.length, 0);
  const primary = documentMock({ uri: "resource://zotero/reader/pdf/web/viewer.html" });
  primaryFrame.contentDocument = primary;
  outer.emit("load");
  await flush();
  assert.equal(primary.fonts.size, 1);
  const secondary = documentMock({ uri: primary.documentURI });
  outer.frames.push(frame(secondary));
  outer.observers[0].trigger();
  await flush();
  assert.equal(secondary.fonts.size, 1);
  // A newer reader can reset the shared family while constructing a split view.
  outer.defaultView.wrappedJSObject.computedFontFamily = "Original Sans";
  outer.observers[0].trigger();
  assert.match(outer.defaultView.wrappedJSObject.computedFontFamily, /ZoteroPluginHandwriting/);
  outer.frames.pop();
  outer.observers[0].trigger();
  assert.equal(secondary.fonts.size, 0);
  app.notify("close", [reader.tabID]);
  assert.equal(primary.fonts.size, 0);
  assert.equal(outer.fonts.size, 0);
  app.feature.shutdown();
});

test("leaves EPUB readers and non-PDF frames untouched and deduplicates reader events", async () => {
  const epub = documentMock();
  const pdf = documentMock();
  const unrelated = documentMock();
  pdf.frames.push(frame(unrelated, "other-view.html"));
  const reader = readerMock(pdf);
  const app = harness([reader, readerMock(epub, "epub")]);
  app.start();
  app.events.get("renderToolbar")({ reader });
  app.events.get("renderTextSelectionPopup")({ reader });
  await flush();
  assert.equal(pdf.createdFonts.length, 1);
  assert.equal(epub.createdFonts.length, 0);
  assert.equal(unrelated.createdFonts.length, 0);
  assert.equal(epub.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
  app.feature.shutdown();
});

test("does not reapply styles after disabling during a pending font load", async () => {
  const load = deferred();
  const outer = documentMock({ load });
  const app = harness([readerMock(outer)]);
  app.start();
  await flush();
  assert.equal(outer.createdFonts.length, 1);
  app.feature.shutdown();
  load.resolve();
  await flush();
  assert.equal(outer.fonts.size, 0);
  assert.equal(outer.styles.length, 0);
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
});

test("a pending old attachment cannot overwrite a re-enabled session", async () => {
  const initialized = deferred();
  const outer = documentMock();
  const reader = readerMock(outer);
  reader._initPromise = initialized.promise;
  const app = harness([reader]);
  app.start();
  app.feature.shutdown();
  reader._initPromise = Promise.resolve();
  app.start();
  await flush();
  initialized.resolve();
  await flush();
  assert.equal(outer.fonts.size, 1);
  assert.equal(outer.styles.length, 1);
  app.feature.shutdown();
  assert.equal(outer.fonts.size, 0);
});

test("reader unload removes resources and pending fonts from a removed split view stay inactive", async () => {
  const outer = documentMock();
  const pendingLoad = deferred();
  const split = documentMock({ load: pendingLoad, uri: "resource://zotero/reader/pdf/web/viewer.html" });
  outer.frames.push(frame(split));
  const app = harness([readerMock(outer)]);
  app.start();
  await flush();
  outer.frames.pop();
  outer.observers[0].trigger();
  pendingLoad.resolve();
  await flush();
  assert.equal(split.fonts.size, 0);
  assert.equal(split.styles.length, 0);
  outer.defaultView.emit("unload");
  assert.equal(outer.fonts.size, 0);
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
  app.feature.shutdown();
});

test("font load failures preserve the original family and do not leave injected resources", async () => {
  const load = deferred();
  const outer = documentMock({ load });
  const app = harness([readerMock(outer)]);
  app.start();
  await flush();
  load.reject(new Error("Invalid font"));
  await flush();
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
  assert.equal(outer.fonts.size, 0);
  assert.equal(outer.styles.length, 0);
  assert.equal(app.errors.length, 1);
  app.feature.shutdown();
});

test("waits for the bundled font before changing mixed-language text and measurements", async () => {
  const chineseLoad = deferred();
  const outer = documentMock({ loads: { ZoteroPluginHandwriting: chineseLoad } });
  const app = harness([readerMock(outer)]);
  app.start();
  await flush();
  assert.equal(outer.fonts.size, 0);
  assert.equal(outer.styles.length, 0);
  assert.equal(outer.defaultView.wrappedJSObject.computedFontFamily, "Original Sans");
  chineseLoad.resolve();
  await flush();
  assert.equal(outer.fonts.size, 1);
  assert.equal(outer.styles.length, 1);
  app.feature.shutdown();
});
