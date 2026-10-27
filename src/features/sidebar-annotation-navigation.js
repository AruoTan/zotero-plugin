/* Select sidebar annotations with one click; locate them from a header double-click. */

var ZoteroPluginSidebarAnnotationNavigation = (() => {
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  const READERS = new Map();
  let session;

  // Compile in the reader realm so native navigation never receives privileged
  // callbacks or objects. React already holds bound selection callbacks: leave
  // those intact and suppress only their synchronous pointer-click navigation.
  function createPatch(reader, win) {
    const doc = win.document;
    const patches = new Map();
    let enabled = true;
    let click;

    function restoreView(view, patch) {
      if (view.navigate !== patch.wrapper) return;
      if (patch.descriptor) Object.defineProperty(view, "navigate", patch.descriptor);
      else delete view.navigate;
    }

    function patchView(view) {
      const current = new Set([reader._primaryView, reader._secondaryView, view]);
      for (const [oldView, patch] of patches) {
        if (!current.has(oldView)) {
          restoreView(oldView, patch);
          patches.delete(oldView);
        }
      }
      if (!view || patches.has(view) || typeof view.navigate !== "function") return;
      const original = view.navigate;
      const descriptor = Object.getOwnPropertyDescriptor(view, "navigate");
      const wrapper = function (location, ...args) {
        // eventPhase returns to NONE after dispatch, even if another handler
        // stops propagation. No timers or temporary global navigation lock.
        if (enabled && click?.event.eventPhase && location?.annotationID === click.id) return;
        return original.call(this, location, ...args);
      };
      Object.defineProperty(view, "navigate", {
        configurable: true, enumerable: descriptor?.enumerable ?? false,
        writable: true, value: wrapper,
      });
      patches.set(view, { descriptor, wrapper });
    }

    function rowAt(event) {
      const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
      return target?.closest?.("#annotationsView [data-sidebar-annotation-id]");
    }

    function onClick(event) {
      click = null;
      if (!enabled || event.button !== 0 || event.detail < 1) return;
      const row = rowAt(event);
      if (!row) return;
      try {
        patchView(reader._lastView);
        click = { event, id: row.getAttribute("data-sidebar-annotation-id") };
      } catch (error) {
        console.error("[zotero-plugin] sidebar annotation navigation: " + error);
      }
    }

    function onDoubleClick(event) {
      if (!enabled || event.button !== 0 || event.ctrlKey || event.metaKey
          || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const row = rowAt(event);
      const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
      const header = target?.closest?.("header");
      if (!row || !header || header !== row.querySelector(".preview > header")) return;
      // Keep page-label editing, menus, and custom header controls native.
      if (target.closest(".start, button, a, input, textarea, select, [contenteditable], [role=button]")) return;
      click = null;
      reader._lastView?.navigate({ annotationID: row.getAttribute("data-sidebar-annotation-id") });
    }

    doc.addEventListener("click", onClick, true);
    doc.addEventListener("dblclick", onDoubleClick, true);
    return {
      restore() {
        enabled = false;
        click = null;
        doc.removeEventListener("click", onClick, true);
        doc.removeEventListener("dblclick", onDoubleClick, true);
        for (const [view, patch] of patches) restoreView(view, patch);
        patches.clear();
      },
    };
  }

  function isActive(state) {
    return session === state.session && !state.closed;
  }

  function detach(reader) {
    const state = READERS.get(reader);
    if (!state) return;
    state.closed = true;
    READERS.delete(reader);
    state.window?.removeEventListener("unload", state.onUnload);
    state.patch?.restore();
  }

  async function attach(reader) {
    if (!session || reader?._type !== "pdf" || READERS.has(reader)) return;
    const state = { reader, session, closed: false };
    READERS.set(reader, state);
    try {
      await reader._initPromise;
      if (!isActive(state)) return;
      await reader._waitForReader();
      if (!isActive(state)) return;
      const win = reader._iframeWindow;
      const internal = reader._internalReader;
      if (!win?.document?.documentElement || !internal) { detach(reader); return; }
      const readerGlobal = win.wrappedJSObject || win;
      const factory = readerGlobal.Function("return (" + createPatch.toString() + ");")();
      state.patch = factory(internal, readerGlobal);
      state.window = win;
      state.onUnload = () => detach(reader);
      win.addEventListener("unload", state.onUnload, { once: true });
    } catch (error) {
      if (READERS.get(reader) === state) detach(reader);
      Zotero.debug("[zotero-plugin] sidebar annotation navigation: " + error);
    }
  }

  function onReaderEvent({ reader }) { void attach(reader); }

  function startup({ id }) {
    if (session) return;
    session = {};
    for (const event of EVENTS) Zotero.Reader.registerEventListener(event, onReaderEvent, id);
    session.notifierID = Zotero.Notifier.registerObserver({
      notify(event, type, ids) {
        if (type !== "tab") return;
        if (event === "add") {
          for (const tabID of ids) void attach(Zotero.Reader.getByTabID(tabID));
        } else if (event === "close") {
          for (const reader of READERS.keys()) if (ids.includes(reader.tabID)) detach(reader);
        }
      },
    }, ["tab"], "zotero-plugin-sidebar-annotation-navigation");
    for (const reader of Zotero.Reader._readers || []) void attach(reader);
  }

  function shutdown() {
    if (!session) return;
    const { notifierID } = session;
    session = null;
    Zotero.Notifier.unregisterObserver(notifierID);
    for (const event of EVENTS) Zotero.Reader.unregisterEventListener(event, onReaderEvent);
    for (const reader of READERS.keys()) detach(reader);
  }

  return { startup, shutdown };
})();
