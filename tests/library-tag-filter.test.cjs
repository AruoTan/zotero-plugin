const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/library-tag-filter.js"), "utf8");
const flush = () => new Promise(setImmediate);
const names = tags => Array.from(tags, tag => tag.tag).sort();

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE items (itemID INTEGER PRIMARY KEY, libraryID INTEGER);
    CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE itemTags (itemID INTEGER, tagID INTEGER, type INTEGER DEFAULT 0);
    CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, contentType TEXT);
    CREATE TABLE itemAnnotations (itemID INTEGER PRIMARY KEY, parentItemID INTEGER);
    INSERT INTO items VALUES (1,1),(2,1),(3,1),(4,1),(5,1),(6,1),(7,1),(8,2),(9,2);
    INSERT INTO tags VALUES (1,'paper'),(2,'PDF only'),(3,'shared'),(4,'EPUB note'),
      (5,'other collection'),(6,'automatic'),(7,'attachment'),(8,'group tag');
    INSERT INTO itemAttachments VALUES (2,'application/pdf'),(5,'application/epub+zip'),(8,'application/pdf');
    INSERT INTO itemAnnotations VALUES (3,2),(6,5),(9,8);
    INSERT INTO itemTags VALUES (1,1,0),(3,2,0),(3,3,0),(1,3,0),(6,4,0),
      (4,5,0),(3,5,0),(3,6,0),(1,6,1),(2,7,0),(9,8,0),(7,8,0);
    CREATE TEMP TABLE scopeOne (itemID INTEGER);
    INSERT INTO scopeOne VALUES (1),(2),(5);
    CREATE TEMP TABLE scopeTwo (itemID INTEGER);
    INSERT INTO scopeTwo VALUES (4);
    CREATE TEMP TABLE scopeGroup (itemID INTEGER);
    INSERT INTO scopeGroup VALUES (8);
  `);
  const errors = [], selections = [], listeners = new Set(), windows = [];
  const queries = [];
  const nativeSQL = `SELECT DISTINCT name AS tag, type FROM itemTags JOIN tags USING(tagID)
    JOIN items USING(itemID) WHERE `;
  function nativeTags(selector, all) {
    if (all) return db.prepare(nativeSQL + `libraryID IN (${selector.libraryIDs.join(",")})`).all();
    const tables = selector.collectionTreeRows.map(row => `SELECT itemID FROM ${row.table}`).join(" UNION ");
    if (!tables) return [];
    return db.prepare(nativeSQL + `itemID IN (${tables} UNION SELECT itemID FROM itemAnnotations
      WHERE parentItemID IN (${tables}))`).all();
  }
  class Selector {
    constructor() {
      this.libraryIDs = [1];
      this.collectionTreeRows = [row("scopeOne")];
      this.displayAllTags = false;
      this.state = { tags: [], scope: new Set(), tagColors: new Map([
        ["PDF only", { color: "#f00" }], ["shared", { color: "#0f0" }],
        ["unused preset", { color: "#00f" }],
      ]) };
      this.selectedTags = new Set();
      this.props = { onSelection: tags => selections.push([...tags].sort()) };
    }
    async getTagsAndScope() {
      const tags = nativeTags(this, false);
      const shown = this.displayAllTags ? nativeTags(this, true) : tags;
      // Match native getTagsAndScope's name-only cache optimization.
      const cached = this.state.tags.length === shown.length
        && shown.every(tag => this.state.tags.some(previous => previous.tag === tag.tag));
      return { tags: cached ? this.state.tags : shown,
        scope: new Set(tags.map(tag => tag.tag)) };
    }
    setState(update) { Object.assign(this.state, update); }
    render() {
      const tags = [...this.state.tags];
      for (const tag of this.state.tagColors.keys()) {
        if (!tags.some(value => value.tag === tag)) tags.push({ tag });
      }
      return tags;
    }
    async notify() {
      // Simulate native incremental notification: it never calls getTagsAndScope.
      this.setState({ tags: nativeTags(this, this.displayAllTags) });
      return "native notify result";
    }
  }
  function row(table) { return { type: "collection", table, getSearchResults: async () => table }; }
  function window(selector = new Selector()) {
    const events = new Map();
    const win = { ZoteroPane: { tagSelector: selector, async initTagSelector() { return "native init result"; } },
      addEventListener(type, handler) { events.set(type, handler); },
      removeEventListener(type, handler) { if (events.get(type) === handler) events.delete(type); },
      events };
    return win;
  }
  const win = window();
  windows.push(win);
  const query = async (sql, params) => {
    queries.push({ sql, params });
    const rows = db.prepare(sql).all(...params);
    // Zotero.DBConnection.queryAsync executes WITH queries, but only returns
    // rows when the first SQL command is SELECT or PRAGMA (Zotero 10.0.6).
    return /^(SELECT|PRAGMA)\b/i.test(sql) ? rows : undefined;
  };
  const Zotero = { uiReadyPromise: Promise.resolve(), getMainWindows: () => windows,
    debug: error => errors.push(String(error)), DB: { queryAsync: query } };
  const context = vm.createContext({ Zotero, Services: { wm: {
    addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); },
  } } });
  vm.runInContext(source, context);
  const feature = context.ZoteroPluginLibraryTagFilter;
  return { feature, db, Zotero, win, selector: win.ZoteroPane.tagSelector, window, windows,
    row, queries, errors, selections, listeners, query,
    async start() { feature.startup(); await flush(); },
    async stop() { feature.shutdown(); await flush(); db.close(); },
  };
}

test("selector excludes PDF tag associations while retaining shared, attachment and non-PDF annotation tags", async () => {
  const app = fixture();
  await app.start();
  assert.deepEqual(names(app.selector.state.tags), ["EPUB note", "attachment", "automatic", "paper", "shared"]);
  assert.deepEqual([...app.selector.state.scope].sort(), names(app.selector.state.tags));
  assert.equal(app.selector.state.tags.find(tag => tag.tag === "automatic").type, 1,
    "a PDF manual tag must not turn an ordinary automatic tag into a manual tag");
  const previous = app.selector.state;
  assert.deepEqual(names(app.selector.render()),
    ["EPUB note", "attachment", "automatic", "paper", "shared", "unused preset"]);
  assert.equal(app.selector.state, previous);
  assert.ok(app.selector.state.tagColors.has("PDF only"), "synced color settings are preserved");
  assert.deepEqual(app.errors, []);
  await app.stop();
});

test("Display All Tags, collection scope and cross-library selections retain independent tag origins", async () => {
  const app = fixture();
  await app.start();
  app.selector.displayAllTags = true;
  app.selector.setState(await app.selector.getTagsAndScope());
  assert.ok(names(app.selector.state.tags).includes("other collection"));
  assert.ok(!app.selector.state.scope.has("other collection"), "a PDF-only association is out of scope");
  assert.ok(!names(app.selector.state.tags).includes("PDF only"));
  app.selector.libraryIDs = [2];
  app.selector.collectionTreeRows = [app.row("scopeGroup")];
  app.selector.setState(await app.selector.getTagsAndScope());
  assert.deepEqual(names(app.selector.state.tags), [], "same tag on an item in a different library cannot rescue it");
  app.selector.libraryIDs = [1, 2];
  app.selector.collectionTreeRows = [app.row("scopeOne"), app.row("scopeTwo"), app.row("scopeGroup")];
  app.selector.setState(await app.selector.getTagsAndScope());
  assert.ok(names(app.selector.state.tags).includes("group tag"), "shared tags across selected libraries survive");
  assert.ok(app.selector.state.scope.has("other collection"));
  await app.stop();
});

test("native add/remove updates are reconciled, with hidden active filters cleared through native selection", async () => {
  const app = fixture();
  app.selector.selectedTags = new Set(["PDF only", "paper"]);
  await app.start();
  assert.deepEqual(app.selections, [["paper"]]);
  app.db.exec("INSERT INTO itemTags VALUES (1,2,0)");
  assert.equal(await app.selector.notify("add", "item-tag"), "native notify result");
  assert.ok(names(app.selector.state.tags).includes("PDF only"));
  assert.ok(names(app.selector.render()).includes("PDF only"));
  app.selector.selectedTags.add("PDF only");
  app.db.exec("DELETE FROM itemTags WHERE itemID=1 AND tagID=2");
  await app.selector.notify("remove", "item-tag");
  assert.ok(!names(app.selector.state.tags).includes("PDF only"));
  assert.ok(!names(app.selector.render()).includes("PDF only"));
  assert.deepEqual(app.selections, [["paper"], ["paper"]]);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM itemTags WHERE itemID=3 AND tagID=2").get().n, 1);
  await app.stop();
});

test("ordinary tag types replace stale native name-only cache entries", async () => {
  const app = fixture();
  await app.start();
  assert.equal(app.selector.state.tags.find(tag => tag.tag === "automatic").type, 1);
  app.db.exec("UPDATE itemTags SET type=0 WHERE itemID=1 AND tagID=6");
  app.selector.setState(await app.selector.getTagsAndScope());
  assert.equal(app.selector.state.tags.find(tag => tag.tag === "automatic").type, 0);
  app.db.exec("UPDATE itemTags SET type=1 WHERE itemID=1 AND tagID=6");
  app.selector.setState(await app.selector.getTagsAndScope());
  assert.equal(app.selector.state.tags.find(tag => tag.tag === "automatic").type, 1);
  await app.stop();
});

test("empty and unsupported views do not query unscoped item tags", async () => {
  const app = fixture();
  await app.start();
  for (const rows of [[], [{ type: "feeds", getSearchResults() { throw Error("Must not search feeds"); } }]]) {
    app.selector.libraryIDs = [];
    app.selector.collectionTreeRows = rows;
    // The native mock query expects table-backed rows; unsupported rows contribute no results.
    for (const row of rows) row.table = "scopeTwo";
    const result = await app.selector.getTagsAndScope();
    assert.deepEqual(names(result.tags), []);
  }
  assert.deepEqual(app.errors, []);
  await app.stop();
});

test("recreated selectors and newly opened windows are patched and all native behavior returns on disable", async () => {
  const app = fixture();
  const originalInit = app.win.ZoteroPane.initTagSelector;
  const originalQuery = app.selector.getTagsAndScope;
  await app.start();
  const next = app.window().ZoteroPane.tagSelector;
  app.win.ZoteroPane.tagSelector = next;
  assert.equal(await app.win.ZoteroPane.initTagSelector(), "native init result");
  await flush();
  assert.equal(app.selector.getTagsAndScope, originalQuery);
  assert.ok(!names(next.state.tags).includes("PDF only"));
  const other = app.window();
  [...app.listeners][0].onOpenWindow({ docShell: { domWindow: other } });
  other.events.get("load")();
  other.events.delete("load");
  await flush();
  assert.ok(!names(other.ZoteroPane.tagSelector.state.tags).includes("PDF only"));
  app.feature.shutdown();
  await flush();
  assert.equal(app.win.ZoteroPane.initTagSelector, originalInit);
  for (const selector of [next, other.ZoteroPane.tagSelector]) {
    assert.equal(Object.hasOwn(selector, "getTagsAndScope"), false);
    assert.equal(Object.hasOwn(selector, "render"), false);
    assert.ok(names(selector.state.tags).includes("PDF only"));
    assert.ok(names(selector.render()).includes("PDF only"));
  }
  assert.equal(app.listeners.size + app.win.events.size + other.events.size, 0);
  await app.stop();
});

test("query failures preserve native tags, and pending work cannot change state after disable", async () => {
  const app = fixture();
  await app.start();
  app.Zotero.DB.queryAsync = async () => { throw Error("Database unavailable"); };
  const result = await app.selector.getTagsAndScope();
  assert.ok(names(result.tags).includes("PDF only"));
  assert.ok(app.errors.some(error => error.includes("Database unavailable")));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  app.Zotero.DB.queryAsync = async (...args) => { await pending; return app.query(...args); };
  const notification = app.selector.notify("add", "item-tag");
  await flush();
  app.feature.shutdown();
  await flush();
  const state = app.selector.state.tags;
  release();
  await notification;
  assert.equal(app.selector.state.tags, state);
  assert.ok(names(state).includes("PDF only"));
  app.db.close();
});

test("a collection switch while querying cannot apply the previous collection's tag associations", async () => {
  const app = fixture();
  await app.start();
  let release, waiting = true;
  const gate = new Promise(resolve => { release = resolve; });
  app.Zotero.DB.queryAsync = async (...args) => {
    if (waiting) { waiting = false; await gate; }
    return app.query(...args);
  };
  const old = app.selector.getTagsAndScope();
  await flush();
  app.selector.collectionTreeRows = [app.row("scopeTwo")];
  app.selector.setState(await app.selector.getTagsAndScope());
  release();
  const result = await old;
  assert.deepEqual(names(result.tags), ["other collection"]);
  assert.deepEqual([...result.scope], ["other collection"]);
  assert.deepEqual(app.errors, []);
  await app.stop();
});

test("startup cancellation and later wrappers remain safe through re-enabling and window unload", async () => {
  const app = fixture();
  let ready;
  app.Zotero.uiReadyPromise = new Promise(resolve => { ready = resolve; });
  app.feature.startup();
  app.feature.shutdown();
  ready();
  await flush();
  assert.equal(Object.hasOwn(app.selector, "getTagsAndScope"), false);
  assert.equal(app.listeners.size, 0);
  await app.start();
  const patched = app.selector.getTagsAndScope;
  const later = function (...args) { return patched.apply(this, args); };
  app.selector.getTagsAndScope = later;
  app.feature.shutdown();
  await flush();
  assert.equal(app.selector.getTagsAndScope, later);
  assert.ok(names((await later.call(app.selector)).tags).includes("PDF only"));
  await app.start();
  app.win.events.get("unload")();
  app.win.events.delete("unload");
  assert.equal(app.win.events.size, 0);
  assert.ok(names((await app.selector.getTagsAndScope()).tags).includes("PDF only"));
  await app.stop();
});

test("a pending native restoration cannot overwrite a re-enabled selector", async () => {
  const app = fixture();
  const original = app.selector.getTagsAndScope;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let shouldWait = false;
  app.selector.getTagsAndScope = async function (...args) {
    const result = await original.apply(this, args);
    if (shouldWait) { shouldWait = false; await gate; }
    return result;
  };
  await app.start();
  shouldWait = true;
  app.feature.shutdown();
  await flush();
  await app.start();
  assert.ok(!names(app.selector.state.tags).includes("PDF only"));
  release();
  await flush();
  assert.ok(!names(app.selector.state.tags).includes("PDF only"));
  await app.stop();
});
