/* Exclude PDF annotation tag associations from the main library tag selector. */

var ZoteroPluginLibraryTagFilter = (() => {
  const WINDOWS = new Map();
  let session;

  function log(error) { Zotero.debug("[zotero-plugin] library tag filter: " + error); }
  function libraryIDs(selector) {
    return [...new Set(selector.libraryIDs || [selector.libraryID])]
      .filter(id => Number.isInteger(id) && id > 0);
  }
  async function associations(ids, tables) {
    if (!ids.length && !tables?.length) {
      return { types: new Map(), names: new Set(), pdfOnly: new Set() };
    }
    const params = ["application/pdf"];
    let scope;
    if (tables) {
      // These identifiers come from native cached search results, never tag text.
      if (tables.some(table => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))) {
        throw new Error("Unexpected tag selector search table");
      }
      const items = tables.map(table => "SELECT itemID FROM " + table).join(" UNION ");
      scope = "it.itemID IN (" + items + " UNION SELECT itemID "
        + "FROM itemAnnotations WHERE parentItemID IN (" + items + "))";
    } else {
      scope = "i.libraryID IN (" + ids.map(() => "?").join(",") + ")";
      params.push(...ids);
    }
    // queryAsync only returns rows for statements beginning with SELECT/PRAGMA.
    // A top-level WITH executes successfully but returns undefined in Zotero 10.
    const rows = await Zotero.DB.queryAsync(
      "SELECT tag, type, MAX(pdf) AS pdf, MIN(pdf) AS onlyPDF FROM ("
      + "SELECT t.name AS tag, it.type, EXISTS (SELECT 1 FROM itemAnnotations a "
      + "JOIN itemAttachments p ON p.itemID = a.parentItemID "
      + "WHERE a.itemID = it.itemID AND p.contentType = ?) AS pdf "
      + "FROM itemTags it JOIN tags t USING (tagID) JOIN items i USING (itemID) WHERE " + scope
      + ") AS tagged GROUP BY tag, type",
      params, { noCache: true });
    const result = { types: new Map(), names: new Set(), pdfOnly: new Set() };
    for (const row of rows) {
      if (!row.onlyPDF) {
        if (!result.types.has(row.tag)) result.types.set(row.tag, []);
        result.types.get(row.tag).push(Number(row.type) || 0);
        result.names.add(row.tag);
      }
      if (row.pdf) result.pdfOnly.add(row.tag);
    }
    for (const name of result.names) result.pdfOnly.delete(name);
    return result;
  }

  function filterTags(tags, associations) {
    const seen = new Set();
    return tags.flatMap(tag => {
      if (seen.has(tag.tag)) return [];
      seen.add(tag.tag);
      // Native name-only caching can retain a type from a removed association.
      // Use the remaining ordinary associations so automatic-tag toggles work.
      return (associations.types.get(tag.tag) || []).map(type => ({ ...tag, type }));
    });
  }

  function wrap(state, target, name, make) {
    const original = target[name];
    if (typeof original !== "function") throw new Error("Missing tag selector method: " + name);
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const wrapper = make(original);
    Object.defineProperty(target, name, { configurable: true, writable: true, value: wrapper });
    state.patches.push(() => {
      if (target[name] !== wrapper) return;
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    });
  }

  function active(state) { return session === state.session && !state.closed; }

  async function refresh(state) {
    const selector = state.selector;
    if (!active(state) || !selector || selector._uninitialized) return;
    const result = await selector.getTagsAndScope();
    if (!active(state) || selector !== state.selector || selector._uninitialized) return;
    let changed = false;
    for (const name of state.excluded || []) {
      if (selector.selectedTags.delete(name)) changed = true;
    }
    selector.setState(result);
    if (changed) selector.props.onSelection?.(selector.selectedTags);
  }

  function patchSelector(state, selector) {
    if (!active(state) || !selector || state.selector === selector) return;
    // Closing/reopening the tag pane creates a new native React container.
    const previousPatches = new Set(state.selectorPatches);
    for (const restore of previousPatches) restore();
    state.patches = state.patches.filter(restore => !previousPatches.has(restore));
    state.selector = selector;
    state.hiddenColors = new Set();
    state.excluded = new Set();
    state.colorLibraries = "";
    const start = state.patches.length;
    wrap(state, selector, "getTagsAndScope", original => async function (...args) {
      const ids = libraryIDs(this);
      const signature = ids.join(",");
      const selectedRows = this.collectionTreeRows || this.collectionTreeRow;
      const rows = this.collectionTreeRows || (this.collectionTreeRow ? [this.collectionTreeRow] : []);
      const version = state.queryVersion = (state.queryVersion || 0) + 1;
      const result = await original.apply(this, args);
      if (!active(state) || state.selector !== this || this._uninitialized) return result;
      try {
        const tables = await Promise.all(rows.filter(row => !["share", "bucket", "feeds"].includes(row.type))
          .map(row => row.getSearchResults(true)));
        const [view, library] = await Promise.all([associations([], tables), associations(ids)]);
        if (!active(state) || state.selector !== this || this._uninitialized) return result;
        // Native view changes can finish while the database queries are pending.
        if (signature !== libraryIDs(this).join(",")
            || selectedRows !== (this.collectionTreeRows || this.collectionTreeRow)) {
          return this.getTagsAndScope(...args);
        }
        if (version === state.queryVersion) {
          state.hiddenColors = library.pdfOnly;
          state.colorLibraries = signature;
          state.excluded = new Set([...(result.scope || [])].filter(name => !view.names.has(name)));
          for (const name of library.pdfOnly) state.excluded.add(name);
        }
        const allowed = this.displayAllTags ? library : view;
        return { ...result, tags: filterTags(result.tags, allowed),
          scope: new Set([...(result.scope || [])].filter(name => view.names.has(name))) };
      } catch (error) {
        log(error);
        return result;
      }
    });
    wrap(state, selector, "render", original => function (...args) {
      if (!active(state) || state.selector !== this || state.colorLibraries !== libraryIDs(this).join(",")) {
        return original.apply(this, args);
      }
      // Native render adds colored presets back even when absent from state.tags.
      // Filter a temporary map, preserving the synced color settings and React state.
      const previous = this.state;
      this.state = { ...previous, tags: [...previous.tags],
        tagColors: new Map([...previous.tagColors].filter(([name]) => !state.hiddenColors.has(name))) };
      try { return original.apply(this, args); }
      finally { this.state = previous; }
    });
    wrap(state, selector, "notify", original => async function (...args) {
      const result = await original.apply(this, args);
      // Native add/remove notifications have an incremental path that bypasses
      // getTagsAndScope. Reconcile it, including deletion of a shared item tag.
      if (active(state) && state.selector === this && !this._uninitialized) await refresh(state).catch(log);
      return result;
    });
    state.selectorPatches = state.patches.slice(start);
    void refresh(state).catch(log);
  }

  function detach(win, restoreUI = true) {
    const state = WINDOWS.get(win);
    if (!state) return;
    state.closed = true;
    WINDOWS.delete(win);
    win.removeEventListener("unload", state.onUnload);
    for (const restore of state.patches.reverse()) restore();
    const selector = state.selector;
    if (restoreUI && selector && !selector._uninitialized && !win.closed) {
      // Rebuild from native data rather than retaining the filtered state on disable.
      void Promise.resolve(selector.getTagsAndScope()).then(result => {
        if (!WINDOWS.has(win) && !selector._uninitialized && !win.closed) selector.setState(result);
      }).catch(log);
    }
  }

  function attach(win) {
    if (!session || WINDOWS.has(win) || !win.ZoteroPane) return;
    const state = { session, patches: [], closed: false };
    WINDOWS.set(win, state);
    state.onUnload = () => detach(win, false);
    win.addEventListener("unload", state.onUnload, { once: true });
    try {
      wrap(state, win.ZoteroPane, "initTagSelector", original => async function (...args) {
        const result = await original.apply(this, args);
        try {
          if (active(state)) patchSelector(state, this.tagSelector);
        } catch (error) { detach(win); log(error); }
        return result;
      });
      patchSelector(state, win.ZoteroPane.tagSelector);
    } catch (error) { detach(win); log(error); }
  }

  function startup() {
    if (session) return;
    const current = session = { pending: new Map() };
    current.listener = {
      onOpenWindow(xulWindow) {
        const win = xulWindow.docShell.domWindow;
        const loaded = () => {
          current.pending.delete(win);
          if (session === current) attach(win);
        };
        current.pending.set(win, loaded);
        win.addEventListener("load", loaded, { once: true });
      },
      onCloseWindow() {}, onWindowTitleChange() {},
    };
    Services.wm.addListener(current.listener);
    void Promise.resolve(Zotero.uiReadyPromise).then(() => {
      if (session === current) for (const win of Zotero.getMainWindows()) attach(win);
    }).catch(log);
  }

  function shutdown() {
    if (!session) return;
    const current = session;
    session = null;
    Services.wm.removeListener(current.listener);
    for (const [win, loaded] of current.pending) win.removeEventListener("load", loaded);
    current.pending.clear();
    for (const win of WINDOWS.keys()) detach(win);
  }

  return { startup, shutdown };
})();
