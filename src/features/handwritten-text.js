/* Handwritten PDF text annotations. The font is embedded by the build script. */

var ZoteroPluginHandwrittenText = (() => {
  const FONT_NAMES = ZoteroPluginHandwritingFonts.map(font => font.family);
  const STYLE_ID = "zotero-plugin-handwritten-text";
  const READERS = new Map();
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  let session;

  function report(error) {
    Zotero.debug("[zotero-plugin] handwritten text: " + error);
  }

  function isActive(state) {
    return session === state.session && !state.closed;
  }

  function refresh(reader) {
    // Newer readers may wrap the PDF view in a common View instance.
    for (const view of [reader._internalReader?._primaryView, reader._internalReader?._secondaryView]) {
      const pdfView = view?._view || view;
      try {
        pdfView?._render?.();
      } catch (error) {
        report(error);
      }
    }
  }

  function removeDocument(state, doc) {
    const entry = state.documents.get(doc);
    if (!entry) return;
    state.documents.delete(doc);
    entry.style?.remove();
    // Zotero may have copied our family into a text annotation's inline style.
    for (const node of doc.querySelectorAll(".customAnnotationLayer textarea.textAnnotation")) {
      if (FONT_NAMES.some(name => node.style.fontFamily.includes(name))) {
        node.style.fontFamily = state.originalFamily || "";
      }
    }
    for (const font of entry.fonts) doc.fonts.delete(font);
  }

  function detach(reader) {
    const state = READERS.get(reader);
    if (!state) return;
    state.closed = true;
    READERS.delete(reader);
    state.observer?.disconnect();
    state.document?.removeEventListener("load", state.onLoad, true);
    state.window?.removeEventListener("unload", state.onUnload);
    if (state.globalWindow && state.globalWindow.computedFontFamily === state.fontFamily) {
      state.globalWindow.computedFontFamily = state.originalFamily;
    }
    for (const doc of state.documents.keys()) {
      removeDocument(state, doc);
    }
    refresh(reader);
  }

  async function addDocument(state, doc) {
    if (!doc?.head || state.documents.has(doc) || !isActive(state)) return;
    const entry = { fonts: [] };
    state.documents.set(doc, entry);
    try {
      for (const { family, source } of ZoteroPluginHandwritingFonts) {
        entry.fonts.push(new doc.defaultView.FontFace(family, `url("${source}")`));
      }
      // Apply the stack only after the bundled faces are ready, including for measurement.
      await Promise.all(entry.fonts.map(font => font.load()));
      // A reader can close, reload, or be disabled while the font is loading.
      if (!isActive(state) || state.documents.get(doc) !== entry) return;
      for (const font of entry.fonts) doc.fonts.add(font);
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      // Zotero 7 measures annotations with hidden textareas in the outer document.
      // Keep their font consistent with the PDF text, including before first paint.
      style.textContent = `
        .customAnnotationLayer textarea.textAnnotation,
        body > textarea[style*="visibility: hidden"][style*="pointer-events: none"][style*="position: absolute"] {
          font-family: ${state.fontFamily} !important;
        }
      `;
      entry.style = style;
      entry.ready = true;
      doc.head.appendChild(style);
      scanDocuments(state);
      refresh(state.reader);
    } catch (error) {
      if (state.documents.get(doc) === entry) {
        removeDocument(state, doc);
      }
      report(error);
    }
  }

  function scanDocuments(state) {
    if (!isActive(state)) return;
    const documents = new Set([state.document]);
    for (const iframe of state.document.querySelectorAll("iframe")) {
      // Only PDF view frames, including a secondary split view.
      if (!iframe.getAttribute("src")?.includes("pdf/web/viewer.html")) continue;
      const doc = iframe.contentDocument;
      if (doc?.head && doc.documentURI !== "about:blank") documents.add(doc);
    }
    for (const doc of state.documents.keys()) {
      if (!documents.has(doc)) removeDocument(state, doc);
    }
    for (const doc of documents) {
      void addDocument(state, doc);
    }
    if (state.documents.get(state.document)?.ready
        && state.globalWindow.computedFontFamily !== state.fontFamily) {
      // Used by annotation rendering and, in newer Zotero versions, measurement.
      state.globalWindow.computedFontFamily = state.fontFamily;
      refresh(state.reader);
    }
  }

  async function attach(reader) {
    if (!session || reader?._type !== "pdf" || READERS.has(reader)) return;
    const state = { reader, session, documents: new Map(), closed: false };
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
      state.globalWindow = win.wrappedJSObject || win;
      state.originalFamily = state.globalWindow.computedFontFamily;
      state.fontFamily = `${FONT_NAMES.map(name => `"${name}"`).join(", ")}, ${state.originalFamily || "sans-serif"}`;
      state.onLoad = () => scanDocuments(state);
      state.onUnload = () => detach(reader);
      doc.addEventListener("load", state.onLoad, true);
      win.addEventListener("unload", state.onUnload, { once: true });
      state.observer = new win.MutationObserver(() => scanDocuments(state));
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
      scanDocuments(state);
    } catch (error) {
      // A later startup may already have attached a fresh state for this reader.
      if (READERS.get(reader) === state) detach(reader);
      report(error);
    }
  }

  function onReaderEvent({ reader }) {
    void attach(reader);
  }

  function startup({ id }) {
    if (session) return;
    session = {};
    for (const event of EVENTS) {
      Zotero.Reader.registerEventListener(event, onReaderEvent, id);
    }
    session.notifierID = Zotero.Notifier.registerObserver({
      notify(event, type, ids) {
        if (type !== "tab") return;
        if (event === "add") {
          for (const tabID of ids) {
            void attach(Zotero.Reader.getByTabID(tabID));
          }
        } else if (event === "close") {
          for (const reader of READERS.keys()) {
            if (ids.includes(reader.tabID)) detach(reader);
          }
        }
      },
    }, ["tab"], "zotero-plugin-handwritten-text");
    for (const reader of Zotero.Reader._readers || []) {
      void attach(reader);
    }
  }

  function shutdown() {
    if (!session) return;
    const { notifierID } = session;
    session = null;
    Zotero.Notifier.unregisterObserver(notifierID);
    for (const event of EVENTS) {
      Zotero.Reader.unregisterEventListener(event, onReaderEvent);
    }
    for (const reader of READERS.keys()) {
      detach(reader);
    }
  }

  return { startup, shutdown };
})();
