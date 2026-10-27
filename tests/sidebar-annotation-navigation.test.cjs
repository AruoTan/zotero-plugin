const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/sidebar-annotation-navigation.js"), "utf8");
const flush = () => new Promise(setImmediate);

function fixture(type = "pdf") {
  const listeners = new Map(), unload = new Map(), calls = [], errors = [];
  const events = new Map(), observers = new Map();
  const doc = {
    documentElement: {},
    addEventListener(type, handler, capture) {
      assert.equal(capture, true);
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
  };
  const realm = vm.createContext({ document: doc, console: { error: error => errors.push(String(error)) } });
  const readerGlobal = vm.runInContext("({document, Function})", realm);
  const win = { document: doc, wrappedJSObject: readerGlobal,
    addEventListener(type, handler) { unload.set(type, handler); },
    removeEventListener(type) { unload.delete(type); } };
  const viewPrototype = { navigate(location, ...args) {
    calls.push({ view: this, location, args });
    return "native result";
  } };
  const primary = Object.create(viewPrototype), secondary = Object.create(viewPrototype);
  const internal = { _lastView: primary, _primaryView: primary, _secondaryView: secondary };
  const reader = { _type: type, tabID: "one", _iframeWindow: win, _internalReader: internal,
    _initPromise: Promise.resolve(), _waitForReader: async () => {} };
  const readers = [reader];
  const context = vm.createContext({ Zotero: {
    debug(error) { errors.push(String(error)); },
    Reader: {
      _readers: readers,
      getByTabID(id) { return readers.find(item => item.tabID === id); },
      registerEventListener(type, handler) { events.set(type, handler); },
      unregisterEventListener(type) { events.delete(type); },
    },
    Notifier: {
      registerObserver(observer) { observers.set(1, observer); return 1; },
      unregisterObserver(id) { observers.delete(id); },
    },
  } });
  vm.runInContext(source, context);
  const feature = context.ZoteroPluginSidebarAnnotationNavigation;
  const header = {};
  const row = { getAttribute: () => "annotation", querySelector: () => header };
  function target(region = "header") {
    return { closest(selector) {
      if (selector.startsWith("#annotationsView")) return region === "outside" ? null : row;
      if (selector === "header") return ["header", "author", "page", "menu", "control"].includes(region) ? header : null;
      return ["page", "menu", "control"].includes(region) ? {} : null;
    } };
  }
  function dispatch(type = "click", region = "header", props = {}, native = () => {}) {
    const event = { target: target(region), button: 0, detail: type === "dblclick" ? 2 : 1,
      eventPhase: 1, ...props };
    listeners.get(type)?.(event);
    event.eventPhase = 3;
    native(event);
    event.eventPhase = 0;
    return event;
  }
  return { feature, reader, readers, internal, primary, secondary, calls, errors, realm,
    listeners, unload, events, observers, dispatch,
    async start() { feature.startup({ id: "test" }); await flush(); },
  };
}

test("pointer clicks select natively without PDF navigation across all annotation sections", async () => {
  const app = fixture();
  await app.start();
  let selections = 0;
  for (const region of ["header", "text", "comment", "image", "tags"]) {
    for (const detail of [1, 2]) {
      app.dispatch("click", region, { detail }, event => {
        selections++;
        assert.equal(event.defaultPrevented, undefined);
        assert.equal(app.primary.navigate({ annotationID: "annotation" }), undefined);
      });
    }
  }
  assert.equal(selections, 10);
  assert.equal(app.calls.length, 0);
  assert.equal(vm.runInContext("Function", app.realm).prototype.isPrototypeOf(app.primary.navigate), true,
    "native callbacks must belong to the reader realm");
  app.feature.shutdown();
  assert.deepEqual(app.errors, []);
});

test("only unmodified header double-clicks navigate, preserving page and menu controls and editing", async () => {
  const app = fixture();
  await app.start();
  app.dispatch("click", "header", {}, () => app.primary.navigate({ annotationID: "annotation" }));
  for (const region of ["header", "author"]) app.dispatch("dblclick", region);
  assert.equal(app.calls.length, 2);
  for (const region of ["text", "comment", "image", "page", "menu", "control", "outside"]) {
    app.dispatch("dblclick", region);
  }
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey", "defaultPrevented"]) {
    app.dispatch("dblclick", "header", { [key]: true });
  }
  app.dispatch("dblclick", "header", { button: 2 });
  assert.equal(app.calls.length, 2);
  assert.ok(app.calls.every(call => call.location.annotationID === "annotation"));
  app.feature.shutdown();
});

test("keyboard, PDF/programmatic, unrelated and later navigation retain native arguments and results", async () => {
  const app = fixture();
  await app.start();
  app.dispatch("click", "header", {}, () => {
    assert.equal(app.primary.navigate({ pageIndex: 2 }, { block: "center" }), "native result");
    app.primary.navigate({ annotationID: "other" });
  });
  // A stopped-propagation event also resets eventPhase at the end of dispatch.
  assert.equal(app.primary.navigate({ annotationID: "annotation" }), "native result");
  for (const [region, props] of [["header", { detail: 0 }], ["outside", {}], ["header", { button: 2 }]]) {
    app.dispatch("click", region, props, () => app.primary.navigate({ annotationID: "annotation" }));
  }
  assert.equal(app.calls.length, 6);
  assert.deepEqual(app.calls[0].args, [{ block: "center" }]);
  assert.ok(app.calls.every(call => call.view === app.primary));
  app.feature.shutdown();
});

test("modifier clicks preserve native multi-selection and content double-click editing", async () => {
  const app = fixture();
  await app.start();
  let selections = 0, edits = 0;
  for (const key of ["ctrlKey", "metaKey", "shiftKey"]) {
    app.dispatch("click", "header", { [key]: true }, event => {
      if (event[key]) selections++;
    });
  }
  app.dispatch("dblclick", "text", {}, () => edits++);
  app.dispatch("dblclick", "comment", {}, () => edits++);
  assert.equal(selections, 3);
  assert.equal(edits, 2);
  assert.equal(app.calls.length, 0);
  app.feature.shutdown();
});

test("split and replaced last views are patched lazily and restored without changing descriptors", async () => {
  const app = fixture();
  await app.start();
  const original = app.primary.navigate;
  app.dispatch("click", "header");
  app.internal._lastView = app.secondary;
  app.dispatch("click", "text", {}, () => app.secondary.navigate({ annotationID: "annotation" }));
  app.dispatch("dblclick", "header");
  assert.equal(app.calls[0].view, app.secondary);
  const replacement = Object.create(Object.getPrototypeOf(app.primary));
  app.internal._primaryView = replacement;
  app.internal._lastView = replacement;
  app.dispatch("click", "header", {}, () => replacement.navigate({ annotationID: "annotation" }));
  assert.equal(app.primary.navigate, original);
  assert.equal(Object.hasOwn(app.primary, "navigate"), false);
  app.feature.shutdown();
  assert.equal(Object.hasOwn(replacement, "navigate"), false);
  assert.equal(Object.hasOwn(app.secondary, "navigate"), false);
  assert.equal(app.listeners.size + app.unload.size + app.events.size + app.observers.size, 0);
});

test("shutdown keeps later wrappers and disables retained patches", async () => {
  const app = fixture();
  await app.start();
  app.dispatch("click", "header");
  const patched = app.primary.navigate;
  const later = function (...args) { return patched.apply(this, args); };
  app.primary.navigate = later;
  app.feature.shutdown();
  assert.equal(app.primary.navigate, later);
  assert.equal(app.primary.navigate({ annotationID: "annotation" }), "native result");
});

test("late readers, unload, pending initialization and non-PDF readers clean up safely", async () => {
  const app = fixture();
  let resolve;
  app.reader._initPromise = new Promise(done => { resolve = done; });
  await app.start();
  app.feature.shutdown();
  resolve();
  await flush();
  assert.equal(app.listeners.size, 0);
  await app.start();
  assert.equal(app.listeners.size, 2);
  app.unload.get("unload")();
  assert.equal(app.listeners.size, 0);
  app.events.get("renderToolbar")({ reader: app.reader });
  await flush();
  assert.equal(app.listeners.size, 2);
  app.observers.get(1).notify("close", "tab", ["one"]);
  assert.equal(app.listeners.size, 0);
  app.observers.get(1).notify("add", "tab", ["one"]);
  await flush();
  assert.equal(app.listeners.size, 2);
  app.feature.shutdown();
  const epub = fixture("epub");
  await epub.start();
  assert.equal(epub.listeners.size, 0);
  epub.feature.shutdown();
});

test("unpatchable views fall back to native click handling", async () => {
  const app = fixture();
  Object.defineProperty(app.primary, "navigate", { value: app.primary.navigate, configurable: false });
  await app.start();
  app.dispatch("click", "header", {}, () => app.primary.navigate({ annotationID: "annotation" }));
  assert.equal(app.calls.length, 1);
  assert.equal(app.errors.length, 1);
  app.feature.shutdown();
});
