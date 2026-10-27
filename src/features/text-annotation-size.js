/* Fit PDF Add Text annotation bounds after editing, using rendered content. */

var ZoteroPluginTextAnnotationSize = (() => {
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  const PDF_SELECTOR = ".customAnnotationLayer textarea.textAnnotation";
  const SIDEBAR_SELECTOR = "#annotationsView [data-sidebar-annotation-id] .comment .editor > .content";
  const READERS = new Map();
  let session;

  // All annotation arrays and objects sent to the native manager stay in the
  // reader realm. The bootstrap exchanges only JSON strings and DOM documents.
  function createBridge(internal) {
    function find(id, doc) {
      const manager = internal._annotationManager;
      const annotation = manager?._getAnnotationByID?.(id);
      if (!annotation || annotation.type !== "text" || annotation.readOnly
          || manager._readOnly || internal._state?.readOnly) return null;
      for (const wrapper of [internal._primaryView, internal._secondaryView]) {
        const view = wrapper?._view || wrapper;
        if (view?._iframeWindow?.document !== doc || view._readOnly || view.action) continue;
        const page = view.getPageByIndex?.(annotation.position.pageIndex)?.originalPage;
        if (page?.viewport?.scale > 0) return { manager, annotation, view, page };
      }
      return null;
    }

    return {
      resizing(doc) {
        for (const wrapper of [internal._primaryView, internal._secondaryView]) {
          const view = wrapper?._view || wrapper;
          const action = view?.action;
          if (view?._iframeWindow?.document === doc && action?.type === "resize"
              && action.triggered && action.annotation?.type === "text") return action.annotation.id;
        }
        return null;
      },
      get(id, doc) {
        const found = find(id, doc);
        return found ? JSON.stringify({ annotation: found.annotation,
          scale: found.page.viewport.scale, page: found.page.viewport.viewBox }) : null;
      },
      resize(serialized, doc) {
        const request = JSON.parse(serialized);
        const found = find(request.id, doc);
        if (!found) return false;
        const { annotation, manager } = found;
        if (annotation.comment !== request.comment
            || JSON.stringify(annotation.position) !== request.position) return false;
        let position;
        if (request.source) {
          // Restore room for raw TeX before the native textarea receives focus.
          position = found.view.adjustTextAnnotationPosition(annotation, {
            adjustSingleLineWidth: true, enableSingleLineMaxWidth: true,
          });
          const rect = position?.rects?.[0];
          if (!rect || !(rect[2] > rect[0] && rect[3] > rect[1])) return false;
        } else {
          const { width, height } = request;
          if (![width, height].every(value => Number.isFinite(value) && value > 0)) return false;
          position = JSON.parse(JSON.stringify(annotation.position));
          const rect = position.rects[0];
          const oldWidth = rect[2] - rect[0], oldHeight = rect[3] - rect[1];
          const angle = (position.rotation || 0) * Math.PI / 180;
          const cos = Math.cos(angle), sin = Math.sin(angle);
          // Keep the rendered top-left fixed, including rotated annotations.
          const cx = (rect[0] + rect[2] + cos * (width - oldWidth) + sin * (height - oldHeight)) / 2;
          const cy = (rect[1] + rect[3] + sin * (width - oldWidth) - cos * (height - oldHeight)) / 2;
          const next = [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2];
          const page = found.page.viewport.viewBox;
          if (page?.length === 4) {
            const extentX = (Math.abs(cos) * width + Math.abs(sin) * height) / 2;
            const extentY = (Math.abs(sin) * width + Math.abs(cos) * height) / 2;
            const dx = Math.max(page[0] - (cx - extentX), Math.min(0, page[2] - (cx + extentX)));
            const dy = Math.max(page[1] - (cy - extentY), Math.min(0, page[3] - (cy + extentY)));
            for (let i = 0; i < 4; i++) next[i] += i % 2 ? dy : dx;
          }
          if (next.every((value, i) => Math.abs(value - rect[i]) < 0.25)) return false;
          position.rects = [next.map(value => Math.round(value * 1000) / 1000)];
        }
        // Native PDF position updates require sortIndex. Keep the existing
        // ordering when fitting content at its anchor, without resaving source
        // or triggering the manager's source-based measurement path.
        manager.updateAnnotations([{ id: annotation.id, position, sortIndex: annotation.sortIndex }]);
        return true;
      },
    };
  }

  function active(state) { return session === state.session && !state.closed; }
  function report(error) {
    Zotero.debug("[zotero-plugin] text annotation size: " + error);
    Zotero.logError?.(error);
  }

  function pdfNode(state, id) {
    for (const [doc, entry] of state.documents) {
      if (entry.sidebar) continue;
      for (const node of doc.querySelectorAll(PDF_SELECTOR)) {
        if (node.getAttribute("data-id") === id) return node;
      }
    }
    return null;
  }

  function measure(node, scale, annotation, preserveWidth = false) {
    const doc = node.ownerDocument;
    const style = doc.defaultView.getComputedStyle(node);
    const rect = annotation.position.rects[0];
    const width = (rect[2] - rect[0]) * scale;
    if (!(width > 0) || !node.value.trim()) return null;
    const preview = Array.from(node.parentElement.parentElement.children).find(child =>
      child.classList.contains("zotero-plugin-math-preview")
      && child.getAttribute("data-zotero-plugin-source-id") === annotation.id);
    const probe = preview?.firstElementChild?.cloneNode(true) || doc.createElement("div");
    if (!preview) probe.textContent = node.value;
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;
      display:inline-block;box-sizing:content-box;width:${preserveWidth ? width + "px" : "max-content"};max-width:${width}px;
      height:auto;min-width:0;min-height:0;margin:0;padding:0;border:0;transform:none;
      white-space:pre-wrap;overflow-wrap:anywhere;`;
    for (const property of ["fontFamily", "fontSize", "lineHeight", "direction", "letterSpacing"]) {
      probe.style[property] = style[property];
    }
    doc.body.appendChild(probe);
    try {
      const bounds = probe.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) return null;
      // Keep one PDF point of room for fractional glyph metrics at every zoom.
      const renderedScale = preview ? Math.min(1, bounds.width / Math.max(bounds.width, probe.scrollWidth)) : 1;
      return { width: preserveWidth ? rect[2] - rect[0]
        : Math.max(annotation.position.fontSize, bounds.width / scale + 1),
        height: Math.max(annotation.position.fontSize, bounds.height * renderedScale / scale + 1) };
    } finally {
      probe.remove();
    }
  }

  function resize(state, id, source, preserveWidth = false) {
    if (!active(state)) return;
    const node = pdfNode(state, id);
    if (!node || (!source && node.ownerDocument.activeElement === node)) return;
    const serialized = state.bridge.get(id, node.ownerDocument);
    if (!serialized) return;
    const { annotation, scale } = JSON.parse(serialized);
    const size = source ? {} : measure(node, scale, annotation, preserveWidth);
    if (!size) return;
    state.bridge.resize(JSON.stringify({ id, comment: annotation.comment,
      position: JSON.stringify(annotation.position), source, ...size }), node.ownerDocument);
  }

  function scheduleFit(state, id, preserveWidth = false) {
    if (state.timers.has(id)) state.window.clearTimeout(state.timers.get(id));
    // Native input/React updates run before measuring the final MathJax preview.
    state.timers.set(id, state.window.setTimeout(async () => {
      state.timers.delete(id);
      try {
        const node = pdfNode(state, id);
        if (!node) return;
        await node.ownerDocument.fonts.ready;
        resize(state, id, false, preserveWidth);
      } catch (error) { report(error); }
    }, 50));
  }

  function removeDocument(state, doc) {
    const entry = state.documents.get(doc);
    if (!entry) return;
    state.documents.delete(doc);
    for (const type of ["focusin", "focusout"]) doc.removeEventListener(type, entry.onEdit, true);
    if (entry.onPointerUp) doc.removeEventListener("pointerup", entry.onPointerUp, true);
  }

  function scan(state) {
    if (!active(state)) return;
    const documents = new Set([state.document]);
    for (const iframe of state.document.querySelectorAll("iframe")) {
      if (!iframe.getAttribute("src")?.includes("pdf/web/viewer.html")) continue;
      const doc = iframe.contentDocument;
      if (doc?.head && doc.documentURI !== "about:blank") documents.add(doc);
    }
    for (const doc of state.documents.keys()) {
      if (!documents.has(doc)) removeDocument(state, doc);
    }
    for (const doc of documents) {
      if (state.documents.has(doc)) continue;
      const sidebar = doc === state.document;
      const selector = sidebar ? SIDEBAR_SELECTOR : PDF_SELECTOR;
      const entry = { sidebar };
      state.documents.set(doc, entry);
      entry.onEdit = event => {
        const node = event.target.closest?.(selector);
        if (!node) return;
        const id = sidebar ? node.closest("[data-sidebar-annotation-id]")?.getAttribute("data-sidebar-annotation-id")
          : node.getAttribute("data-id");
        if (!id) return;
        if (event.type === "focusin") {
          if (state.timers.has(id)) state.window.clearTimeout(state.timers.get(id));
          state.timers.delete(id);
          try { resize(state, id, true); } catch (error) { report(error); }
        } else scheduleFit(state, id);
      };
      for (const type of ["focusin", "focusout"]) doc.addEventListener(type, entry.onEdit, true);
      if (!sidebar) {
        entry.onPointerUp = () => {
          try {
            // Observe before the native window pointerup handler commits the
            // source-measured resize, then fit its final rendered height.
            const id = state.bridge.resizing(doc);
            if (id) scheduleFit(state, id, true);
          } catch (error) { report(error); }
        };
        doc.addEventListener("pointerup", entry.onPointerUp, true);
      }
    }
  }

  function detach(reader) {
    const state = READERS.get(reader);
    if (!state) return;
    state.closed = true;
    READERS.delete(reader);
    state.observer?.disconnect();
    state.document?.removeEventListener("load", state.onLoad, true);
    state.window?.removeEventListener("unload", state.onUnload);
    for (const timer of state.timers.values()) state.window.clearTimeout(timer);
    state.timers.clear();
    for (const doc of state.documents.keys()) removeDocument(state, doc);
  }

  async function attach(reader) {
    if (!session || reader?._type !== "pdf" || READERS.has(reader)) return;
    const state = { reader, session, closed: false, documents: new Map(), timers: new Map() };
    READERS.set(reader, state);
    try {
      await reader._initPromise;
      if (!active(state)) return;
      await reader._waitForReader();
      if (!active(state)) return;
      const win = reader._iframeWindow;
      const doc = win?.document;
      if (!doc?.head || !reader._internalReader) { detach(reader); return; }
      state.window = win;
      state.document = doc;
      const global = win.wrappedJSObject || win;
      state.bridge = global.Function("return (" + createBridge.toString() + ");")()(reader._internalReader);
      state.onLoad = () => scan(state);
      state.onUnload = () => detach(reader);
      doc.addEventListener("load", state.onLoad, true);
      win.addEventListener("unload", state.onUnload, { once: true });
      state.observer = new win.MutationObserver(() => scan(state));
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
      scan(state);
    } catch (error) {
      if (READERS.get(reader) === state) detach(reader);
      report(error);
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
    }, ["tab"], "zotero-plugin-text-annotation-size");
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
