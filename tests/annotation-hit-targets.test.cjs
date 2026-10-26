const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/annotation-hit-targets.js"), "utf8");
const flush = () => new Promise(setImmediate);
const at = (x, y, pageIndex = 0) => ({ pageIndex, rects: [[x, y, x, y]] });
const annotation = (type, rects = [[10, 20, 110, 40]], extra = {}) => ({
  id: type, type, position: { pageIndex: 0, rects, ...extra },
});
function rectsOnPage(a, pageIndex) {
  return a.position.pageIndex === pageIndex ? a.position.rects
    : a.position.pageIndex + 1 === pageIndex ? a.position.nextPageRects || [] : [];
}
function contains(rect, point) {
  return point[0] >= rect[0] && point[0] <= rect[2] && point[1] >= rect[1] && point[1] <= rect[3];
}

// Model native candidate ordering, selected-object dragging, and PDF -> backing
// pixel transforms. The plugin must only narrow the two requested hit targets.
const nativeMethods = {
  getSelectableAnnotations(position) {
    if (!this.loaded) return null;
    const result = this._annotations.filter(a => rectsOnPage(a, position.pageIndex)
      .some(r => contains(r, position.rects[0])));
    const selectedText = result.find(a => a.type === "text" && a.id === this._selectedAnnotationIDs[0]);
    return selectedText ? [selectedText] : result.sort((a, b) => this.area(a) - this.area(b));
  },
  getSelectedAnnotationAction(a, position) {
    if (this.handleAction) return this.handleAction;
    return rectsOnPage(a, position.pageIndex).some(r => contains(r, position.rects[0]))
      ? { type: "drag", annotation: a } : null;
  },
};

function pdfView(annotations = [], { zoom = 1, density = 1, rotation = 0, textRotation = 0 } = {}) {
  const pages = Array.from({ length: 3 }, () => ({ outputScale: { sx: density, sy: density } }));
  const view = Object.create(nativeMethods);
  Object.assign(view, {
    loaded: true, _annotations: annotations, _selectedAnnotationIDs: [], rotation,
    _pdfPages: Array.from({ length: 3 }, () => ({ chars: [{ rect: [15, 22, 20, 35], rotation: textRotation }] })),
    _iframeWindow: { PDFViewerApplication: { pdfViewer: {
      _pages: pages,
    } } },
    area(a) { return a.position.rects.reduce((sum, r) => sum + (r[2] - r[0]) * (r[3] - r[1]), 0); },
    getPageByIndex(index) { return this.loaded && pages[index] ? { originalPage: pages[index] } : null; },
    getViewportRotation() { return this.rotation; },
    getViewPoint([x, y]) {
      const scale = zoom * density;
      return (this.rotation === 90 ? [-y, -x] : this.rotation === 180 ? [-x, y]
        : this.rotation === 270 ? [y, x] : [x, -y]).map(v => v * scale);
    },
    getViewRect(rect, pageIndex) {
      const p = this.getViewPoint(rect, pageIndex);
      const q = this.getViewPoint(rect.slice(2), pageIndex);
      return [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[0], q[0]), Math.max(p[1], q[1])];
    },
    hits(position) { return Array.from(this.getSelectableAnnotations(position) || [], a => a.id); },
  });
  return view;
}

function readerMock(view = pdfView(), wrapped = true) {
  const runtimeErrors = [];
  const realm = vm.createContext({ console: { error(message) { runtimeErrors.push(message); } } });
  const realmFunction = vm.runInContext("Function", realm);
  const windowListeners = new Map();
  const documentListeners = new Map();
  const observers = [];
  const doc = {
    documentElement: {},
    addEventListener(type, fn) { documentListeners.set(type, fn); },
    removeEventListener(type, fn) { if (documentListeners.get(type) === fn) documentListeners.delete(type); },
    mutate() { for (const o of observers) if (o.connected) o.callback(); },
  };
  return {
    _type: "pdf", tabID: "tab", _initPromise: Promise.resolve(), _waitForReader: async () => {},
    _internalReader: { _primaryView: wrapped ? { _view: view } : view },
    _iframeWindow: {
      Function: realmFunction,
      document: doc,
      addEventListener(type, fn) { windowListeners.set(type, fn); },
      removeEventListener(type, fn) { if (windowListeners.get(type) === fn) windowListeners.delete(type); },
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() { this.connected = true; }
        disconnect() { this.connected = false; }
      },
    },
    doc, documentListeners, windowListeners, observers, realmFunction, realm, runtimeErrors,
  };
}

function harness(readers) {
  const events = new Map();
  const notifiers = new Map();
  const errors = [];
  let nextID = 0;
  const scope = vm.createContext({ Zotero: {
    debug(error) { errors.push(error); },
    Reader: {
      _readers: readers, getByTabID(id) { return readers.find(r => r.tabID === id); },
      registerEventListener(type, fn) { events.set(type, fn); },
      unregisterEventListener(type, fn) { if (events.get(type) === fn) events.delete(type); },
    },
    Notifier: {
      registerObserver(observer) { notifiers.set(++nextID, observer); return nextID; },
      unregisterObserver(id) { notifiers.delete(id); },
    },
  } });
  vm.runInContext(source, scope);
  const feature = scope.ZoteroPluginAnnotationHitTargets;
  return {
    feature, events, notifiers, errors,
    start() { feature.startup({ id: "test-plugin" }); },
    notify(event, ids) { for (const observer of notifiers.values()) observer.notify(event, "tab", ids); },
  };
}

test("underline text is selectable while the stroke remains a hit target at different zoom and density", async () => {
  for (const zoom of [0.5, 1, 3]) for (const density of [1, 2]) {
    const a = annotation("underline");
    const saved = JSON.stringify(a);
    const view = pdfView([a], { zoom, density });
    const h = harness([readerMock(view)]);
    h.start();
    await flush();
    assert.deepEqual(view.hits(at(60, 30)), []);
    assert.deepEqual(view.hits(at(60, 20.5)), ["underline"]);
    assert.deepEqual(view.hits(at(60, 20 - 1 / zoom)), ["underline"], "small hit allowance outside the stroke");
    assert.deepEqual(view.hits(at(60, 20 - 4 / zoom)), []);
    assert.equal(JSON.stringify(a), saved, "saved position and content must remain untouched");
    h.feature.shutdown();
    assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
    assert.equal(Object.hasOwn(view, "getSelectableAnnotations"), false, "restore inherited methods");
    assert.deepEqual(h.errors, []);
  }
});

test("area annotation interior passes through, and all four borders and outer edges remain selectable", async () => {
  const box = annotation("image", [[0, 0, 100, 100]]);
  const view = pdfView([box]);
  const h = harness([readerMock(view, false)]);
  h.start();
  await flush();
  assert.deepEqual(view.hits(at(50, 50)), []);
  for (const [x, y] of [[0, 50], [100, 50], [50, 0], [50, 100], [-2, 50], [102, 50], [50, -2], [50, 102]]) {
    assert.deepEqual(view.hits(at(x, y)), ["image"]);
  }
  assert.deepEqual(view.hits(at(5, 50)), []);
  assert.deepEqual(view.hits(at(50, 50, 1)), []);
  h.feature.shutdown();
});

test("selected marks release their interiors but keep native drag and visible transform handles", async () => {
  for (const type of ["image", "underline"]) {
    const a = annotation(type, [[0, 0, 100, 100]]);
    const view = pdfView([a]);
    view._selectedAnnotationIDs = [a.id];
    const h = harness([readerMock(view)]);
    h.start();
    await flush();
    assert.equal(view.getSelectedAnnotationAction(a, at(50, 50)), null);
    assert.equal(view.getSelectedAnnotationAction(a, at(50, 0)).type, "drag");
    for (const handleType of ["resize", "updateAnnotationRange"]) {
      view.handleAction = { type: handleType, annotation: a };
      assert.equal(view.getSelectedAnnotationAction(a, at(0, 50)), view.handleAction);
    }
    view.handleAction = null;
    a.readOnly = true;
    assert.equal(view.getSelectedAnnotationAction(a, at(50, 50)), null);
    h.feature.shutdown();
  }
});

test("underlines follow text and page rotation, multiline ranges, and next-page rects", async () => {
  for (const rotation of [0, 90, 180, 270]) for (const textRotation of [0, 90, 180, 270]) {
    const a = annotation("underline");
    const view = pdfView([a], { rotation, textRotation });
    const h = harness([readerMock(view)]);
    h.start();
    await flush();
    const point = textRotation === 90 ? at(109.5, 30) : textRotation === 180 ? at(60, 40.5)
      : textRotation === 270 ? at(9.5, 30) : at(60, 20.5);
    assert.deepEqual(view.hits(point), ["underline"], `page ${rotation}, text ${textRotation}`);
    assert.deepEqual(view.hits(at(60, 30)), []);
    // A cached text rotation must still follow a newly rotated page.
    view.rotation = (rotation + 90) % 360;
    assert.deepEqual(view.hits(point), ["underline"]);
    h.feature.shutdown();
  }
  const a = annotation("underline", [[10, 20, 110, 40], [10, 50, 90, 70]], {
    nextPageRects: [[20, 80, 120, 100]],
  });
  const view = pdfView([a]);
  const h = harness([readerMock(view)]);
  h.start();
  await flush();
  for (const point of [at(50, 20.5), at(50, 50.5), at(50, 80.5, 1)]) assert.deepEqual(view.hits(point), ["underline"]);
  for (const point of [at(50, 30), at(50, 45), at(50, 90, 1), at(50, 80.5, 2)]) assert.deepEqual(view.hits(point), []);
  h.feature.shutdown();
});

test("other annotations, overlapping priorities, native null results, and recoloring retain their behavior", async () => {
  const underline = annotation("underline");
  const highlight = annotation("highlight");
  const text = annotation("text");
  const note = annotation("note", [[55, 25, 65, 35]]);
  const box = annotation("image", [[0, 0, 200, 200]]);
  const view = pdfView([box, underline, highlight, note]);
  const h = harness([readerMock(view)]);
  h.start();
  await flush();
  assert.deepEqual(view.hits(at(60, 30)), ["note", "highlight"]);
  assert.equal(view.getSelectedAnnotationAction(note, at(60, 30)).type, "drag");
  assert.deepEqual(view.hits(at(60, 20.5)), ["highlight", "underline"]);
  view._annotations.push(text);
  view._selectedAnnotationIDs = [text.id];
  assert.deepEqual(view.hits(at(60, 20.5)), ["text"]);
  view._selectedAnnotationIDs = [];
  view._annotations = [underline];
  underline.color = "#000000";
  assert.deepEqual(view.hits(at(60, 20.5)), ["underline"]);
  view._annotations = [];
  assert.deepEqual(view.hits(at(60, 20.5)), [], "filtered/deleted annotations must not be reintroduced");
  view.loaded = false;
  assert.equal(view.getSelectableAnnotations(at(60, 20.5)), null);
  h.feature.shutdown();
});

test("new split views and replacement PDF views are patched once and fully restored", async () => {
  const a = annotation("image", [[0, 0, 100, 100]]);
  const primary = pdfView([a]);
  const reader = readerMock(primary);
  const h = harness([reader]);
  h.start();
  await flush();
  const wrapper = primary.getSelectableAnnotations;
  reader.doc.mutate();
  assert.equal(primary.getSelectableAnnotations, wrapper);
  const secondary = pdfView([a]);
  reader._internalReader._secondaryView = { _view: secondary };
  reader.doc.mutate();
  assert.deepEqual(secondary.hits(at(50, 50)), []);
  const replacement = pdfView([a]);
  reader._internalReader._primaryView._view = replacement;
  reader.documentListeners.get("load")();
  assert.equal(primary.getSelectableAnnotations, nativeMethods.getSelectableAnnotations);
  assert.deepEqual(replacement.hits(at(50, 50)), []);
  reader._internalReader._secondaryView = null;
  reader.doc.mutate();
  assert.equal(secondary.getSelectableAnnotations, nativeMethods.getSelectableAnnotations);
  h.feature.shutdown();
  assert.equal(replacement.getSelectableAnnotations, nativeMethods.getSelectableAnnotations);
  assert.equal(reader.documentListeners.size, 0);
  assert.equal(reader.windowListeners.size, 0);
  assert.ok(reader.observers.every(o => !o.connected));
  assert.equal(h.events.size, 0);
  assert.equal(h.notifiers.size, 0);
});

test("new tabs, separate windows, non-PDF readers, close, and unload are handled", async () => {
  const readers = [];
  const h = harness(readers);
  h.start();
  const tab = readerMock();
  const separate = readerMock();
  separate.tabID = undefined;
  const epub = readerMock();
  epub._type = "epub";
  readers.push(tab, separate, epub);
  h.notify("add", [tab.tabID]);
  h.events.get("renderToolbar")({ reader: separate });
  h.events.get("renderToolbar")({ reader: epub });
  await flush();
  assert.equal(tab.observers.length, 1);
  assert.equal(separate.observers.length, 1);
  assert.equal(epub.observers.length, 0);
  h.notify("close", [tab.tabID]);
  assert.equal(tab.observers[0].connected, false);
  separate.windowListeners.get("unload")();
  assert.equal(separate.observers[0].connected, false);
  h.feature.shutdown();
});

test("pending initialization cannot attach after shutdown, close, or a later startup", async () => {
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const reader = readerMock();
  reader._initPromise = pending;
  const h = harness([reader]);
  h.start();
  h.feature.shutdown();
  h.start();
  h.notify("close", [reader.tabID]);
  resolve();
  await flush();
  assert.equal(reader.observers.length, 0);
  reader._initPromise = Promise.resolve();
  h.events.get("renderToolbar")({ reader });
  await flush();
  assert.equal(reader.observers.length, 1);
  h.feature.shutdown();
});

test("failed initialization can retry and later plugin wrappers are preserved but become inactive", async () => {
  const view = pdfView([annotation("underline")]);
  const original = view.getSelectableAnnotations.bind(view);
  view.getSelectableAnnotations = original;
  const reader = readerMock(view);
  reader._waitForReader = async () => { throw Error("reader not ready"); };
  const h = harness([reader]);
  h.start();
  await flush();
  assert.equal(h.errors.length, 1);
  reader._waitForReader = async () => {};
  h.events.get("renderToolbar")({ reader });
  await flush();
  const ours = view.getSelectableAnnotations;
  const later = function(...args) { return ours.apply(this, args); };
  view.getSelectableAnnotations = later;
  assert.deepEqual(view.hits(at(60, 30)), []);
  h.feature.shutdown();
  assert.equal(view.getSelectableAnnotations, later);
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
});

test("a later wrapper becomes native on view removal and works after the view is reattached", async () => {
  const view = pdfView([annotation("underline")]);
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  const ours = view.getSelectableAnnotations;
  const later = function(...args) { return ours.apply(this, args); };
  view.getSelectableAnnotations = later;
  reader._internalReader._primaryView = null;
  reader.doc.mutate();
  assert.equal(view.getSelectableAnnotations, later);
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
  reader._internalReader._primaryView = { _view: view };
  reader.doc.mutate();
  assert.deepEqual(view.hits(at(60, 30)), []);
  h.feature.shutdown();
  assert.equal(view.getSelectableAnnotations, later);
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
});

test("mouse callbacks and result arrays belong to the reader realm and preserve annotation identity", async () => {
  const a = annotation("underline");
  const view = pdfView([a]);
  const reader = readerMock(view);
  reader._iframeWindow.wrappedJSObject = { Function: reader.realmFunction };
  reader._iframeWindow.Function = () => assert.fail("must use the unwrapped reader global");
  const h = harness([reader]);
  h.start();
  await flush();
  for (const name of ["getSelectableAnnotations", "getSelectedAnnotationAction"]) {
    assert.equal(Object.getPrototypeOf(view[name]), reader.realmFunction.prototype,
      "the reader must not call an unexported privileged bootstrap function");
  }
  const results = view.getSelectableAnnotations(at(60, 20.5));
  assert.equal(Object.getPrototypeOf(results), vm.runInContext("Array.prototype", reader.realm),
    "returned arrays must be accessible to the reader's mouse handlers");
  assert.equal(results[0], a, "do not clone annotations: native selection relies on identity");
  assert.deepEqual(view.hits(at(60, 30)), []);
  h.feature.shutdown();
  assert.deepEqual(reader.runtimeErrors, []);
});

test("a geometry failure returns native candidates and restores both mouse callbacks immediately", async () => {
  const a = annotation("underline");
  const view = pdfView([a]);
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  view.getViewPoint = () => { throw Error("page view unavailable"); };
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
  assert.equal(view.getSelectableAnnotations, nativeMethods.getSelectableAnnotations);
  assert.equal(view.getSelectedAnnotationAction, nativeMethods.getSelectedAnnotationAction);
  assert.equal(reader.runtimeErrors.length, 1);
  // A later observer scan must not immediately reinstall the broken patch.
  reader.doc.mutate();
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
  assert.equal(reader.runtimeErrors.length, 1);
  h.feature.shutdown();
});

test("selected-annotation failures return native actions without interrupting the event", async () => {
  const a = annotation("image", [[0, 0, 100, 100]]);
  const view = pdfView([a]);
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  view.getViewRect = () => { throw Error("viewport unavailable"); };
  const action = view.getSelectedAnnotationAction(a, at(50, 50));
  assert.equal(action.type, "drag");
  assert.equal(action.annotation, a);
  assert.equal(view.getSelectableAnnotations, nativeMethods.getSelectableAnnotations);
  assert.equal(view.getSelectedAnnotationAction, nativeMethods.getSelectedAnnotationAction);
  assert.equal(reader.runtimeErrors.length, 1);
  h.feature.shutdown();
});

test("ordinary unannotated pages and unrelated annotations keep working in a separate reader realm", async () => {
  const highlight = annotation("highlight");
  const view = pdfView([highlight]);
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  assert.deepEqual(view.hits(at(200, 200)), []);
  const results = view.getSelectableAnnotations(at(60, 30));
  assert.equal(results[0], highlight);
  assert.equal(view.getSelectedAnnotationAction(highlight, at(60, 30)).type, "drag");
  assert.deepEqual(reader.runtimeErrors, []);
  h.feature.shutdown();
});

test("hit testing works when the PDF window hides PDFViewerApplication", async () => {
  for (const type of ["underline", "image"]) {
    const a = annotation(type, [[0, 0, 100, 100]]);
    const view = pdfView([a]);
    view._iframeWindow = {};
    const reader = readerMock(view);
    const h = harness([reader]);
    h.start();
    await flush();
    assert.deepEqual(view.hits(at(50, 50)), []);
    assert.deepEqual(view.hits(at(50, 0.5)), [type]);
    assert.equal(view.getSelectedAnnotationAction(a, at(50, 50)), null);
    assert.equal(view.getSelectedAnnotationAction(a, at(50, 0.5)).annotation, a);
    assert.deepEqual(reader.runtimeErrors, []);
    h.feature.shutdown();
  }
});

test("hit testing never reads the PDF window global through a security wrapper", async () => {
  const view = pdfView([annotation("underline")]);
  Object.defineProperty(view._iframeWindow, "PDFViewerApplication", {
    get() { assert.fail("PDFViewerApplication must be accessed only by native reader methods"); },
  });
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  assert.deepEqual(view.hits(at(60, 30)), []);
  assert.deepEqual(view.hits(at(60, 20.5)), ["underline"]);
  assert.deepEqual(reader.runtimeErrors, []);
  h.feature.shutdown();
});

test("missing page output scale preserves native hits until the page is ready", async () => {
  const a = annotation("underline");
  const view = pdfView([a]);
  const page = view.getPageByIndex(0).originalPage;
  const outputScale = page.outputScale;
  delete page.outputScale;
  const reader = readerMock(view);
  const h = harness([reader]);
  h.start();
  await flush();
  assert.deepEqual(view.hits(at(60, 30)), ["underline"]);
  assert.equal(view.getSelectedAnnotationAction(a, at(60, 30)).annotation, a);
  page.outputScale = outputScale;
  assert.deepEqual(view.hits(at(60, 30)), []);
  assert.deepEqual(view.hits(at(60, 20.5)), ["underline"]);
  assert.equal(view.getSelectedAnnotationAction(a, at(60, 30)), null);
  assert.deepEqual(reader.runtimeErrors, []);
  h.feature.shutdown();
});
