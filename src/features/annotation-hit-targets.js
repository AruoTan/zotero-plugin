/* Let PDF content receive clicks except on underline strokes and image borders. */

var ZoteroPluginAnnotationHitTargets = (() => {
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  const READERS = new Map();
  let session;

  function isActive(state) {
    return session === state.session && !state.closed;
  }

  // This entire factory is compiled in the reader's realm. A privileged bootstrap
  // callback or return array must never leak into its pointer-event handlers.
  // Keep it self-contained: it cannot refer to plugin-scope variables or Zotero.
  function createViewPatch(view) {
    const TEXT_ROTATIONS = new WeakMap();
    const patches = [];
    let enabled = true;

    function isTarget(annotation) {
      return annotation.type === "underline" || annotation.type === "image";
    }

    function pageRects(position, pageIndex) {
      if (position.pageIndex === pageIndex) return position.rects || [];
      if (position.pageIndex + 1 === pageIndex) return position.nextPageRects || [];
      return [];
    }

    function inRect(point, rect, padding = 0) {
      return point[0] >= Math.min(rect[0], rect[2]) - padding
        && point[0] <= Math.max(rect[0], rect[2]) + padding
        && point[1] >= Math.min(rect[1], rect[3]) - padding
        && point[1] <= Math.max(rect[1], rect[3]) + padding;
    }

    function textRotation(view, pageIndex, rect) {
      // Match the reader renderer: use the most common char rotation in the first
      // rect on this page, then add the viewport rotation (including user rotation).
      const chars = view._pdfPages?.[pageIndex]?.chars;
      const cached = TEXT_ROTATIONS.get(rect);
      if (cached && cached.chars === chars) {
        return ((cached.rotation + view.getViewportRotation(pageIndex)) % 360 + 360) % 360;
      }
      const counts = new Map();
      for (const char of chars || []) {
        const r = char.rect;
        if (inRect([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], rect)) {
          const rotation = char.rotation || 0;
          counts.set(rotation, (counts.get(rotation) || 0) + 1);
        }
      }
      let rotation = 0;
      let max = 0;
      // Native tie-breaking chooses the largest angle among equally common ones.
      for (const [angle, count] of [...counts].sort((a, b) => a[0] - b[0])) {
        if (count >= max) { rotation = angle; max = count; }
      }
      TEXT_ROTATIONS.set(rect, { chars, rotation });
      return ((rotation + view.getViewportRotation(pageIndex)) % 360 + 360) % 360;
    }

    function hitsStroke(view, annotation, position) {
      const pageIndex = position.pageIndex;
      const rects = pageRects(annotation.position, pageIndex);
      if (!rects.length) return false;
      // getViewPoint/getViewRect use backing pixels, not CSS pixels. Keep a small
      // two-CSS-pixel hit allowance at all zoom levels and display densities.
      // PDF window expandos can be hidden by Gecko's security wrapper. Use the
      // Page object already owned by this view instead of reading that global.
      const page = view.getPageByIndex(pageIndex)?.originalPage;
      const outputScale = Math.max(page?.outputScale?.sx, page?.outputScale?.sy);
      // A page can exist before its canvas is ready. Keep native hits for this
      // event and retry on the next one; missing scale is not a geometry error.
      if (!Number.isFinite(outputScale) || outputScale <= 0) return null;
      const point = view.getViewPoint(position.rects[0], pageIndex);
      const padding = 2 * outputScale;
      const origin = view.getViewPoint([0, 0], pageIndex);
      const unit = view.getViewPoint([1, 0], pageIndex);
      const width = Math.hypot(unit[0] - origin[0], unit[1] - origin[1]);
      const rotation = annotation.type === "underline" ? textRotation(view, pageIndex, rects[0]) : 0;
      return rects.some(rect => {
        const [x1, y1, x2, y2] = view.getViewRect(rect, pageIndex);
        if (annotation.type === "image") {
          // Image/area annotations have a two-CSS-pixel border in the reader.
          return [[x1, y1, x2, y1], [x1, y2, x2, y2],
            [x1, y1, x1, y2], [x2, y1, x2, y2]]
            .some(edge => inRect(point, edge, padding + outputScale));
        }
        // These are the same four stroke rectangles used by Zotero's renderer.
        const stroke = rotation === 90 ? [x2 - width, y1, x2, y2]
          : rotation === 180 ? [x1, y1 - width, x2, y1]
          : rotation === 270 ? [x1 - width, y1, x1, y2]
          : [x1, y2 - width, x2, y2];
        return inRect(point, stroke, padding);
      });
    }

    function area(annotation) {
      return (annotation.position.rects || []).reduce((sum, r) => sum + (r[2] - r[0]) * (r[3] - r[1]), 0);
    }

    function restore() {
      enabled = false;
      for (const { name, descriptor, wrapper } of patches) {
        // Preserve any wrapper installed later by another plugin.
        if (view[name] !== wrapper) continue;
        if (descriptor) Object.defineProperty(view, name, descriptor);
        else delete view[name];
      }
    }

    function fail(error) {
      // A plugin geometry error must not interrupt a native mouse event. Disable
      // this view's patches and return the original native result for this call.
      try { restore(); } catch (_) {}
      try { console.error("[zotero-plugin] annotation hit targets disabled for this view: " + error); } catch (_) {}
    }

    function patch(name, create) {
      const original = view[name];
      const descriptor = Object.getOwnPropertyDescriptor(view, name);
      const wrapper = create(original);
      view[name] = wrapper;
      patches.push({ name, descriptor, wrapper });
    }

    try {
      patch("getSelectableAnnotations", original => function(position, ...args) {
        const candidates = original.call(this, position, ...args);
        if (!enabled || !candidates || !position?.rects?.length) return candidates;
        try {
          // Preserve the native priority of the currently edited text annotation.
          if (candidates.some(a => a.type === "text" && a.id === this._selectedAnnotationIDs?.[0])) return candidates;
          const result = [];
          for (const candidate of candidates) {
            if (!isTarget(candidate)) result.push(candidate);
          }
          for (const annotation of this._annotations || []) {
            if (!isTarget(annotation)) continue;
            const hit = hitsStroke(this, annotation, position);
            if (hit === true || (hit === null && candidates.includes(annotation))) result.push(annotation);
          }
          // Include strokes just outside the original rectangle, retaining native
          // smallest-annotation-first ordering and annotation object identity.
          return result.sort((a, b) => area(a) - area(b));
        } catch (error) {
          fail(error);
          return candidates;
        }
      });
      patch("getSelectedAnnotationAction", original => function(annotation, position, ...args) {
        const action = original.call(this, annotation, position, ...args);
        if (!enabled) return action;
        try {
          if (!isTarget(annotation) || !position?.rects?.length) return action;
          // Keep visible resize/range handles usable after selecting a mark.
          if (action?.type === "resize" || action?.type === "updateAnnotationRange") return action;
          return hitsStroke(this, annotation, position) === false ? null : action;
        } catch (error) {
          fail(error);
          return action;
        }
      });
    } catch (error) {
      restore();
      throw error;
    }
    return { restore };
  }

  function restoreView(state, view) {
    const patch = state.views.get(view);
    if (!patch) return;
    state.views.delete(view);
    patch.restore();
  }

  function patchView(state, view) {
    if (!view || state.views.has(view)
        || typeof view.getSelectableAnnotations !== "function"
        || typeof view.getSelectedAnnotationAction !== "function"
        || typeof view.getPageByIndex !== "function"
        || typeof view.getViewPoint !== "function"
        || typeof view.getViewRect !== "function"
        || typeof view.getViewportRotation !== "function") return;
    state.views.set(view, state.createViewPatch(view));
  }

  function scanViews(state) {
    if (!isActive(state)) return;
    try {
      const internal = state.reader._internalReader;
      const views = new Set([internal?._primaryView, internal?._secondaryView]
        .map(view => view?._view || view).filter(Boolean));
      for (const view of state.views.keys()) {
        if (!views.has(view)) restoreView(state, view);
      }
      for (const view of views) {
        try {
          patchView(state, view);
        } catch (error) {
          restoreView(state, view);
          throw error;
        }
      }
    } catch (error) {
      Zotero.debug("[zotero-plugin] annotation hit targets: " + error);
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
    for (const view of state.views.keys()) restoreView(state, view);
  }

  async function attach(reader) {
    if (!session || reader?._type !== "pdf" || READERS.has(reader)) return;
    const state = { reader, session, views: new Map(), closed: false };
    READERS.set(reader, state);
    try {
      await reader._initPromise;
      if (!isActive(state)) return;
      await reader._waitForReader();
      if (!isActive(state)) return;
      const win = reader._iframeWindow;
      const doc = win?.document;
      if (!doc?.documentElement) { detach(reader); return; }
      state.window = win;
      state.document = doc;
      const readerGlobal = win.wrappedJSObject || win;
      // Use only our static source; no document text or user input is evaluated.
      state.createViewPatch = readerGlobal.Function("return (" + createViewPatch.toString() + ");")();
      state.onLoad = () => scanViews(state);
      state.onUnload = () => detach(reader);
      doc.addEventListener("load", state.onLoad, true);
      win.addEventListener("unload", state.onUnload, { once: true });
      state.observer = new win.MutationObserver(() => scanViews(state));
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
      scanViews(state);
    } catch (error) {
      if (READERS.get(reader) === state) detach(reader);
      Zotero.debug("[zotero-plugin] annotation hit targets: " + error);
    }
  }

  function onReaderEvent({ reader }) {
    if (READERS.has(reader)) scanViews(READERS.get(reader));
    else void attach(reader);
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
    }, ["tab"], "zotero-plugin-annotation-hit-targets");
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
