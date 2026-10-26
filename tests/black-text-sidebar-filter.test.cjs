const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/black-text-sidebar-filter.js"), "utf8");
const marker = "data-zotero-plugin-hidden-black-text";
const flush = () => new Promise(setImmediate);

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function row(type, color) {
  const attributes = new Map();
  return {
    type, color,
    querySelector(selector) {
      assert.equal(selector, ".preview > header > .start > .icon-text");
      return this.type === "text" ? { style: { color: this.color } } : null;
    },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    get hidden() { return attributes.has(marker); },
  };
}

function colorButton(color, selected = false) {
  const attributes = new Map();
  return {
    color, selected, clicks: 0,
    querySelector(selector) {
      assert.equal(selector, "svg [fill]");
      return { getAttribute: name => name === "fill" ? this.color : null };
    },
    getAttribute(name) {
      return name === "aria-checked" ? String(this.selected) : attributes.get(name);
    },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    click() { this.clicks++; this.selected = !this.selected; },
    get hidden() { return attributes.has(marker); },
  };
}

function readerMock(rows = [], type = "pdf") {
  const listeners = new Map();
  const doc = {
    rows, colors: [], styles: [], observers: [], documentElement: {},
    head: { appendChild(style) { doc.styles.push(style); } },
    createElement() {
      return { remove() { doc.styles.splice(doc.styles.indexOf(this), 1); } };
    },
    querySelectorAll(selector) {
      if (selector === "#annotationsView #selector .colors > button.color") return doc.colors;
      assert.equal(selector, "#annotationsView [data-sidebar-annotation-id]");
      return doc.rows;
    },
    mutate(records = [{ type: "childList" }]) {
      for (const observer of doc.observers) {
        if (observer.connected) observer.callback(records);
      }
    },
  };
  const win = {
    document: doc,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; doc.observers.push(this); }
      observe(target, options) { this.connected = true; this.options = options; }
      disconnect() { this.connected = false; }
    },
  };
  return {
    _type: type, tabID: "tab", _iframeWindow: win,
    _initPromise: Promise.resolve(), _waitForReader: async () => {},
    // The native filter also hides PDF annotations. Calling it would violate the feature scope.
    _internalReader: { setFilter() { assert.fail("must not use the shared annotation filter"); } },
    doc, listeners,
  };
}

function harness(readers = []) {
  const events = new Map();
  const notifiers = new Map();
  const errors = [];
  let nextID = 0;
  const context = vm.createContext({ Zotero: {
    debug(error) { errors.push(error); },
    Reader: {
      _readers: readers,
      getByTabID(id) { return readers.find(reader => reader.tabID === id); },
      registerEventListener(type, handler) { events.set(type, handler); },
      unregisterEventListener(type, handler) { if (events.get(type) === handler) events.delete(type); },
    },
    Notifier: {
      registerObserver(observer) { notifiers.set(++nextID, observer); return nextID; },
      unregisterObserver(id) { notifiers.delete(id); },
    },
  } });
  vm.runInContext(source, context);
  const feature = context.ZoteroPluginBlackTextSidebarFilter;
  return {
    feature, events, notifiers, errors,
    start() { feature.startup({ id: "test-plugin" }); },
    notify(event, ids) { for (const observer of notifiers.values()) observer.notify(event, "tab", ids); },
  };
}

test("hides only pure black Add Text sidebar rows and preserves annotation data and PDF content", async () => {
  const blackText = ["rgb(0, 0, 0)", "#000000", "#000", "black", "rgba(0, 0, 0, 1)"]
    .map(color => row("text", color));
  const visible = [
    row("text", "#ff0000"), row("text", "#010101"), row("text", "#ffffff"),
    row("text", ""), row("text", "rgba(0, 0, 0, 0)"),
    ...["highlight", "underline", "note", "ink", "image"].map(type => row(type, "#000000")),
  ];
  const reader = readerMock([...blackText, ...visible]);
  reader._internalReader._state = Object.freeze({
    annotations: Object.freeze([Object.freeze({ id: "black", type: "text", color: "#000000" })]),
    filter: Object.freeze({ query: "", colors: Object.freeze([]) }),
  });
  const originalData = JSON.stringify(reader._internalReader._state);
  const app = harness([reader]);
  app.start();
  await flush();
  assert.ok(blackText.every(item => item.hidden));
  assert.ok(visible.every(item => !item.hidden));
  assert.equal(JSON.stringify(reader._internalReader._state), originalData);
  assert.equal(reader.doc.styles.length, 1);
  assert.equal(reader.doc.styles[0].textContent,
    `#annotationsView [data-sidebar-annotation-id][${marker}], #annotationsView #selector .colors > button.color[${marker}] { display: none !important; }`);
  app.feature.shutdown();
  assert.ok(blackText.every(item => !item.hidden));
  assert.equal(reader.doc.styles.length, 0);
  assert.equal(reader.doc.observers[0].connected, false);
  assert.equal(reader.listeners.size, 0);
  assert.equal(app.events.size, 0);
  assert.equal(app.notifiers.size, 0);
  assert.deepEqual(app.errors, []);
});

test("hides the black color filter while preserving other colors and black non-text entries", async () => {
  const blackNote = row("note", "#000000");
  const reader = readerMock([row("text", "#000000"), blackNote]);
  const black = colorButton("#000000");
  const otherColors = ["#ffd400", "#ff6666", "#5fb236", "#2ea8e5", "#aaaaaa"]
    .map(color => colorButton(color));
  reader.doc.colors = [...otherColors, black];
  const app = harness([reader]);
  app.start();
  await flush();
  assert.equal(black.hidden, true);
  assert.equal(blackNote.hidden, false);
  assert.ok(otherColors.every(button => !button.hidden && button.clicks === 0));
  assert.equal(black.clicks, 0, "an unselected black filter should not be toggled");
  // React reuses color buttons by index and updates the SVG fill.
  black.color = "#ff6666";
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(black.hidden, false);
  black.color = "rgb(0, 0, 0)";
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(black.hidden, true);
  reader.doc.colors = [];
  reader.doc.mutate();
  assert.equal(black.hidden, false, "detached color buttons must release their marker");
  const replacement = colorButton("#000000");
  reader.doc.colors = [...otherColors, replacement];
  reader.doc.mutate();
  assert.equal(replacement.hidden, true);
  app.feature.shutdown();
  assert.equal(replacement.hidden, false);
  assert.equal(reader.doc.styles.length, 0);
});

test("clears an already selected black color without toggling other selected colors", async () => {
  const reader = readerMock();
  const black = colorButton("#000000", true);
  const red = colorButton("#ff6666", true);
  // Simulate a delayed React commit: aria-checked remains true after the click.
  black.click = function () { this.clicks++; };
  reader.doc.colors = [black, red];
  const app = harness([reader]);
  app.start();
  await flush();
  reader.doc.mutate();
  assert.equal(black.hidden, true);
  assert.equal(black.clicks, 1, "pending deselection must not be toggled repeatedly");
  assert.equal(red.selected, true);
  assert.equal(red.clicks, 0);
  black.selected = false;
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  black.selected = true;
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(black.clicks, 2, "a later black selection must also be cleared");
  app.feature.shutdown();
  assert.equal(black.hidden, false);
});

test("updates colors, new annotations, replaced rows, and a sidebar mounted after startup", async () => {
  const reader = readerMock();
  const app = harness([reader]);
  app.start();
  await flush();
  const item = row("text", "#000000");
  reader.doc.rows.push(item);
  reader.doc.mutate();
  assert.equal(item.hidden, true);
  item.color = "#ff6666";
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(item.hidden, false, "recoloring must restore the sidebar entry");
  item.color = "rgb(0, 0, 0)";
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(item.hidden, true);
  item.type = "note";
  reader.doc.mutate([{ type: "attributes", target: { closest: () => ({}) } }]);
  assert.equal(item.hidden, false, "reused rows must be checked for type changes");
  item.type = "text";
  reader.doc.mutate();
  const replacement = row("text", "#000000");
  reader.doc.rows = [replacement];
  reader.doc.mutate();
  assert.equal(item.hidden, false, "removed rows must release their marker and references");
  assert.equal(replacement.hidden, true);
  reader.doc.rows = [];
  reader.doc.mutate();
  assert.equal(replacement.hidden, false);
  reader.doc.rows = [replacement];
  reader.doc.mutate();
  assert.equal(replacement.hidden, true);
  app.feature.shutdown();
  assert.equal(replacement.hidden, false);
});

test("attaches new PDF tabs and reader windows, ignores EPUB, and cleans up closed readers", async () => {
  const readers = [];
  const app = harness(readers);
  app.start();
  const reader = readerMock([row("text", "#000000")]);
  readers.push(reader);
  app.notify("add", [reader.tabID]);
  app.events.get("renderToolbar")({ reader });
  await flush();
  assert.equal(reader.doc.styles.length, 1, "duplicate attachment must be ignored");
  assert.equal(reader.doc.rows[0].hidden, true);
  const separateWindow = readerMock([row("text", "#000000")]);
  separateWindow.tabID = undefined;
  app.events.get("renderToolbar")({ reader: separateWindow });
  const epub = readerMock([row("text", "#000000")], "epub");
  app.events.get("renderTextSelectionPopup")({ reader: epub });
  await flush();
  assert.equal(separateWindow.doc.rows[0].hidden, true);
  assert.equal(epub.doc.styles.length, 0);
  assert.equal(epub.doc.rows[0].hidden, false);
  app.notify("close", [reader.tabID]);
  assert.equal(reader.doc.rows[0].hidden, false);
  assert.equal(reader.doc.styles.length, 0);
  assert.equal(separateWindow.doc.rows[0].hidden, true);
  separateWindow.listeners.get("unload")();
  assert.equal(separateWindow.doc.rows[0].hidden, false);
  app.feature.shutdown();
});

test("pending initialization from a disabled session cannot modify a re-enabled reader", async () => {
  const pending = deferred();
  const reader = readerMock([row("text", "#000000")]);
  reader._initPromise = pending.promise;
  const app = harness([reader]);
  app.start();
  app.feature.shutdown();
  reader._initPromise = Promise.resolve();
  app.start();
  await flush();
  pending.resolve();
  await flush();
  assert.equal(reader.doc.styles.length, 1);
  assert.equal(reader.doc.rows[0].hidden, true);
  app.feature.shutdown();
  assert.equal(reader.doc.rows[0].hidden, false);
});

test("closing or disabling while waiting for a reader prevents late filtering", async () => {
  for (const action of ["close", "disable"]) {
    const pending = deferred();
    const reader = readerMock([row("text", "#000000")]);
    reader._waitForReader = () => pending.promise;
    const app = harness([reader]);
    app.start();
    await flush();
    if (action === "close") app.notify("close", [reader.tabID]);
    else app.feature.shutdown();
    pending.resolve();
    await flush();
    assert.equal(reader.doc.styles.length, 0);
    assert.equal(reader.doc.rows[0].hidden, false);
    app.feature.shutdown();
  }
});

test("failed initialization can be retried and leaves no resources behind", async () => {
  const reader = readerMock([row("text", "#000000")]);
  reader._waitForReader = async () => { throw new Error("Reader closed"); };
  const app = harness([reader]);
  app.start();
  await flush();
  assert.equal(reader.doc.styles.length, 0);
  assert.equal(reader.doc.rows[0].hidden, false);
  assert.equal(app.errors.length, 1);
  reader._waitForReader = async () => {};
  app.events.get("renderToolbar")({ reader });
  await flush();
  assert.equal(reader.doc.rows[0].hidden, true);
  app.feature.shutdown();
});
