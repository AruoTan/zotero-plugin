/* Hide black Add Text sidebar entries and the sidebar's black color swatch. */

var ZoteroPluginBlackTextSidebarFilter = (() => {
  const ROW_SELECTOR = "#annotationsView [data-sidebar-annotation-id]";
  const COLOR_SELECTOR = "#annotationsView #selector .colors > button.color";
  const HIDDEN_ATTRIBUTE = "data-zotero-plugin-hidden-black-text";
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  const READERS = new Map();
  let session;

  function isActive(state) {
    return session === state.session && !state.closed;
  }

  function isBlack(color) {
    // Read the annotation icon's inline color, not a theme-adjusted computed color.
    return ["black", "#000", "#000000", "rgb(0,0,0)", "rgba(0,0,0,1)"]
      .includes((color || "").replace(/\s+/g, "").toLowerCase());
  }

  function updateVisibility(state) {
    if (!isActive(state)) return;
    const hidden = new Set();
    for (const row of state.document.querySelectorAll(ROW_SELECTOR)) {
      // This icon carries the saved annotation type and color in Zotero 7 and 10.
      const icon = row.querySelector(".preview > header > .start > .icon-text");
      if (icon && isBlack(icon.style.color)) {
        hidden.add(row);
      }
    }
    for (const button of state.document.querySelectorAll(COLOR_SELECTOR)) {
      const fill = button.querySelector("svg [fill]")?.getAttribute("fill");
      if (isBlack(fill)) {
        hidden.add(button);
        if (button.getAttribute("aria-checked") === "true") {
          // Use the native toggle to clear just black, preserving other filters.
          // Wait for React to commit deselection before allowing another toggle.
          if (!state.pendingDeselections.has(button)) {
            state.pendingDeselections.add(button);
            button.click();
          }
        } else {
          state.pendingDeselections.delete(button);
        }
      } else {
        state.pendingDeselections.delete(button);
      }
    }
    for (const node of hidden) {
      if (!node.hasAttribute(HIDDEN_ATTRIBUTE)) node.setAttribute(HIDDEN_ATTRIBUTE, "");
    }
    for (const node of state.hiddenElements) {
      if (!hidden.has(node)) node.removeAttribute(HIDDEN_ATTRIBUTE);
    }
    state.hiddenElements = hidden;
  }

  function detach(reader) {
    const state = READERS.get(reader);
    if (!state) return;
    state.closed = true;
    READERS.delete(reader);
    state.observer?.disconnect();
    state.window?.removeEventListener("unload", state.onUnload);
    state.style?.remove();
    for (const node of state.hiddenElements) node.removeAttribute(HIDDEN_ATTRIBUTE);
    state.hiddenElements.clear();
  }

  async function attach(reader) {
    if (!session || reader?._type !== "pdf" || READERS.has(reader)) return;
    const state = {
      reader, session, hiddenElements: new Set(), pendingDeselections: new WeakSet(), closed: false,
    };
    READERS.set(reader, state);
    try {
      await reader._initPromise;
      if (!isActive(state)) return;
      await reader._waitForReader();
      if (!isActive(state)) return;
      const win = reader._iframeWindow;
      const doc = win?.document;
      if (!doc?.head) {
        detach(reader);
        return;
      }
      state.window = win;
      state.document = doc;
      state.style = doc.createElement("style");
      state.style.id = "zotero-plugin-black-text-sidebar-filter";
      state.style.textContent = `${ROW_SELECTOR}[${HIDDEN_ATTRIBUTE}], ${COLOR_SELECTOR}[${HIDDEN_ATTRIBUTE}] { display: none !important; }`;
      doc.head.appendChild(state.style);
      state.onUnload = () => detach(reader);
      win.addEventListener("unload", state.onUnload, { once: true });
      state.observer = new win.MutationObserver(mutations => {
        // Changes outside the sidebar cannot alter annotation or swatch colors.
        if (mutations.some(mutation => mutation.type === "childList"
            || mutation.target.closest?.("#annotationsView"))) {
          updateVisibility(state);
        }
      });
      // The sidebar can mount late, be toggled off, or replace rows after a search.
      // Our own marker attribute is excluded to avoid observer feedback loops.
      state.observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "fill", "aria-checked"],
      });
      updateVisibility(state);
    } catch (error) {
      if (READERS.get(reader) === state) detach(reader);
      Zotero.debug("[zotero-plugin] black text sidebar filter: " + error);
    }
  }

  function onReaderEvent({ reader }) {
    void attach(reader);
  }

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
          for (const reader of READERS.keys()) {
            if (ids.includes(reader.tabID)) detach(reader);
          }
        }
      },
    }, ["tab"], "zotero-plugin-black-text-sidebar-filter");
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
