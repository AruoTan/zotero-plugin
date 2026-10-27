/* Offline MathJax previews for PDF Add Text annotations. */

var ZoteroPluginMathText = (() => {
  const SELECTOR = ".customAnnotationLayer textarea.textAnnotation";
  const SIDEBAR_SELECTOR = ["comment", "text"].map(section =>
    `#annotationsView [data-sidebar-annotation-id] .preview > .${section} .editor > .content`).join(", ");
  const MARKER = "data-zotero-plugin-math";
  const PREVIEW = "zotero-plugin-math-preview";
  const SIDEBAR_MARKER = "data-zotero-plugin-math-sidebar";
  const SIDEBAR_PREVIEW = "zotero-plugin-math-sidebar-preview";
  const SIDEBAR_LAYOUT = "data-zotero-plugin-math-layout";
  const HOVER_PREVIEW = "zotero-plugin-math-hover-preview";
  const HOVER_DELAY = 600;
  const EVENTS = ["renderToolbar", "renderTextSelectionPopup"];
  const READERS = new Map();
  const CACHE = new Map();
  const OBSERVE = {
    childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ["style", "class", "data-comment", "dir", "contenteditable"],
  };
  let session;

  function report(error) {
    Zotero.debug("[zotero-plugin] math text: " + error);
  }

  function isActive(state) {
    return session === state.session && !state.closed;
  }

  function removePreview(entry, node) {
    const item = entry.items.get(node);
    if (!item) return;
    if (entry.hover?.node === node) dismissHover(entry);
    node.removeAttribute(MARKER);
    item.parent?.removeAttribute(SIDEBAR_MARKER);
    item.parent?.removeAttribute(SIDEBAR_LAYOUT);
    if (item.layoutParent) entry.resizeObserver?.unobserve(item.layoutParent);
    item.preview?.remove();
    entry.items.delete(node);
  }

  function dismissHover(entry) {
    const hover = entry.hover;
    if (!hover) return;
    const win = entry.document.defaultView;
    win.clearTimeout(hover.timer);
    win.clearTimeout(hover.leaveTimer);
    hover.popup?.remove();
    entry.hover = null;
  }

  function showHover(entry, hover) {
    const { document: doc } = entry;
    const win = doc.defaultView;
    const item = entry.items.get(hover.node);
    if (entry.hover !== hover || !isActive(entry.state) || !hover.row.isConnected
        || !item?.addText || !item.preview || item.preview.hidden
        || !hover.row.getClientRects().length || item.parent.contains(doc.activeElement)) {
      dismissHover(entry);
      return;
    }
    const style = win.getComputedStyle(item.content);
    // offsetWidth rounds fractional pixels down on some layouts, which would
    // wrap a final word onto an extra line in the cloned preview.
    const width = parseFloat(style.width) || item.content.offsetWidth;
    const height = parseFloat(style.height) || item.content.offsetHeight;
    if (!(width > 0 && height > 0)) { dismissHover(entry); return; }
    // Copy the already-rendered layout, including its wrapping width. Enlarging
    // the whole result keeps formulas and handwriting aligned without reflow.
    const zoom = Math.max(1.25, 20 / (parseFloat(style.fontSize) || 14));
    const popup = doc.createElement("div");
    popup.className = HOVER_PREVIEW;
    popup.setAttribute("role", "tooltip");
    const canvas = doc.createElement("div");
    canvas.style.cssText = `position:relative;width:${width * zoom}px;height:${height * zoom}px;`;
    const content = item.content.cloneNode(true);
    content.style.width = `${width}px`;
    content.style.maxWidth = "none";
    content.style.transform = `scale(${zoom})`;
    for (const property of ["fontFamily", "fontSize", "lineHeight", "direction", "textAlign", "color"]) {
      content.style[property] = style[property];
    }
    canvas.appendChild(content);
    popup.appendChild(canvas);
    const card = hover.row.getBoundingClientRect();
    const rightSpace = win.innerWidth - card.right - 22, leftSpace = card.left - 22;
    const beside = Math.max(rightSpace, leftSpace) >= 240;
    const useLeft = beside && leftSpace > rightSpace;
    const available = beside ? (useLeft ? leftSpace : rightSpace) : win.innerWidth - 24;
    popup.style.maxWidth = `${Math.max(1, Math.min(900, available))}px`;
    popup.style.maxHeight = `${Math.max(1, win.innerHeight - 24)}px`;
    hover.popup = popup;
    doc.body.appendChild(popup);
    const bounds = popup.getBoundingClientRect();
    const left = useLeft ? card.left - bounds.width - 10 : card.right + 10;
    popup.style.left = `${Math.max(12, Math.min(left, win.innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(12, Math.min(card.top, win.innerHeight - bounds.height - 12))}px`;
  }

  function installHover(entry) {
    const doc = entry.document, win = doc.defaultView;
    entry.onHover = event => {
      const hover = entry.hover;
      const inside = node => node && (hover?.row.contains(node) || hover?.popup?.contains(node));
      if (event.type === "mouseout") {
        if (hover && inside(event.target) && !inside(event.relatedTarget)) {
          win.clearTimeout(hover.timer);
          win.clearTimeout(hover.leaveTimer);
          // Allow crossing the small gap from the card into the scrollable popup.
          if (hover.popup) hover.leaveTimer = win.setTimeout(() => dismissHover(entry), 180);
          else dismissHover(entry);
        }
        return;
      }
      if (inside(event.target)) { win.clearTimeout(hover.leaveTimer); return; }
      const row = event.target.closest?.("#annotationsView [data-sidebar-annotation-id]");
      if (!row) return;
      dismissHover(entry);
      for (const [node, item] of entry.items) {
        if (!item.addText || !item.preview || item.preview.hidden
            || node.closest("[data-sidebar-annotation-id]") !== row
            || item.parent.contains(doc.activeElement)) continue;
        const next = { row, node };
        entry.hover = next;
        next.timer = win.setTimeout(() => {
          try { showHover(entry, next); } catch (error) { dismissHover(entry); report(error); }
        }, HOVER_DELAY);
        break;
      }
    };
    entry.onDismissHover = event => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (entry.hover?.popup?.contains(event.target)) {
        if (event.type !== "keydown") return;
      }
      dismissHover(entry);
    };
    for (const type of ["mouseover", "mouseout"]) doc.addEventListener(type, entry.onHover, true);
    for (const type of ["pointerdown", "scroll", "wheel", "keydown"]) doc.addEventListener(type, entry.onDismissHover, true);
    for (const type of ["resize", "blur"]) win.addEventListener(type, entry.onDismissHover);
  }

  function equation(source, display) {
    const key = (display ? "D" : "I") + source;
    if (CACHE.has(key)) return CACHE.get(key);
    let svg = null;
    try {
      svg = ZoteroPluginMathJax.render(source, display);
    } catch (_error) {
      // Incomplete/unsupported TeX is ordinary annotation content, not a reader error.
    }
    CACHE.set(key, svg);
    if (CACHE.size > 128) CACHE.delete(CACHE.keys().next().value);
    return svg;
  }

  function makeFormula(doc, part) {
    const markup = equation(part.math, part.display);
    if (!markup) return null;
    // Parse only SVG generated by our offline engine. Annotation text is never
    // evaluated or interpreted as HTML.
    const parsed = new doc.defaultView.DOMParser().parseFromString(markup, "image/svg+xml");
    if (parsed.documentElement.localName !== "svg") throw new Error("Invalid MathJax SVG");
    const span = doc.createElement("span");
    span.className = part.display ? "zotero-plugin-math-display" : "zotero-plugin-math-inline";
    span.appendChild(doc.importNode(parsed.documentElement, true));
    return span;
  }

  function makeContent(doc, parts, allowPlain = false) {
    const content = doc.createElement("div");
    content.className = "zotero-plugin-math-content";
    let rendered = false;
    for (const part of parts) {
      if (part.text !== undefined) {
        content.appendChild(doc.createTextNode(part.text));
        continue;
      }
      const formula = makeFormula(doc, part);
      if (!formula) {
        content.appendChild(doc.createTextNode(part.raw));
        continue;
      }
      content.appendChild(formula);
      rendered = true;
    }
    return rendered || allowPlain ? content : null;
  }

  // Geometry is read in the reader realm; no annotation object crosses into
  // bootstrap layout code. PDF-point dimensions are independent of viewer zoom.
  function createSidebarLayoutGetter(internal) {
    return id => {
      const annotation = internal._annotationManager?._getAnnotationByID?.(id);
      const position = annotation?.position;
      const rect = position?.rects?.[0];
      if (annotation?.type !== "text" || !rect) return null;
      const width = rect[2] - rect[0];
      return width > 0 && position.fontSize > 0
        ? JSON.stringify({ width, fontSize: position.fontSize, source: annotation.comment || "" }) : null;
    };
  }

  function sidebarLayout(entry, node) {
    const state = entry.state;
    const internal = state.reader._internalReader;
    if (!internal) return null;
    if (state.layoutInternal !== internal) {
      const global = state.window.wrappedJSObject || state.window;
      state.getLayout = global.Function("return (" + createSidebarLayoutGetter.toString() + ");")()(internal);
      state.layoutInternal = internal;
    }
    const id = node.closest("[data-sidebar-annotation-id]")?.getAttribute("data-sidebar-annotation-id");
    const serialized = id && state.getLayout(id);
    return serialized ? JSON.parse(serialized) : null;
  }

  function scaleSidebar(entry, node, item, style, layout) {
    const { content, preview, parent } = item;
    preview.setAttribute(SIDEBAR_LAYOUT, "");
    parent.setAttribute(SIDEBAR_LAYOUT, "");
    // Use the page's text size and wrapping width before uniformly scaling the
    // complete result. Intrinsic width avoids scaling unused rectangle space.
    content.style.cssText = "width:max-content;max-width:none;white-space:pre-wrap;overflow-wrap:anywhere;transform:none;";
    content.style.fontSize = layout ? `${layout.fontSize}px` : style.fontSize;
    content.style.lineHeight = layout ? "normal" : style.lineHeight;
    if (layout) content.style.maxWidth = `${layout.width}px`;
    const left = parseFloat(style.paddingLeft) || 0, right = parseFloat(style.paddingRight) || 0;
    const top = parseFloat(style.paddingTop) || 0, bottom = parseFloat(style.paddingBottom) || 0;
    const available = parent.clientWidth - left - right;
    const width = Math.max(content.offsetWidth, content.scrollWidth);
    const height = Math.max(content.offsetHeight, content.scrollHeight);
    if (available > 0 && width > 0 && height > 0) {
      const scale = Math.min(1, available / width);
      content.style.transform = `scale(${scale})`;
      preview.style.height = `${Math.ceil(height * scale + top + bottom)}px`;
    }
    if (item.layoutParent !== parent) {
      if (item.layoutParent) entry.resizeObserver?.unobserve(item.layoutParent);
      item.layoutParent = parent;
      entry.resizeObserver?.observe(parent);
    }
  }

  function makeSidebarContent(doc, node) {
    const source = node.textContent || "";
    const parts = ZoteroPluginMathJax.split(source);
    if (!parts) return null;
    // Clone ranges of the existing native editor DOM around each expression.
    // This preserves bold/italic/subscript/superscript and line breaks, including
    // formulas split across text nodes, without modifying contenteditable DOM.
    const walker = doc.createTreeWalker(node, 4); // NodeFilter.SHOW_TEXT
    const segments = [];
    let offset = 0;
    for (let text; (text = walker.nextNode());) {
      segments.push({ node: text, start: offset, end: offset + text.nodeValue.length });
      offset += text.nodeValue.length;
    }
    function point(index, start = false) {
      // At a text-node boundary, keep preceding/following <br> elements outside
      // the replaced formula rather than swallowing a native line break.
      const segment = segments.find(item => index >= item.start
        && (start ? index < item.end : index <= item.end));
      if (!segment) throw new Error("Cannot locate formula source in sidebar editor");
      return [segment.node, index - segment.start];
    }
    const content = doc.createElement("div");
    content.className = "zotero-plugin-math-content";
    let cursor = 0;
    let previous = [node, 0];
    let rendered = false;
    function appendRange(end) {
      const range = doc.createRange();
      range.setStart(...previous);
      range.setEnd(...end);
      content.appendChild(range.cloneContents());
    }
    for (const part of parts) {
      if (part.text !== undefined) {
        // FindTeX emits escaped dollars/backslashes as a separate text match.
        if ((part.text === "$" || part.text === "\\")
            && source.slice(cursor, cursor + 2) === "\\" + part.text) {
          appendRange(point(cursor, true));
          content.appendChild(doc.createTextNode(part.text));
          cursor += 2;
          previous = point(cursor);
        } else {
          cursor += part.text.length;
        }
        continue;
      }
      const start = cursor;
      cursor += part.raw.length;
      const formula = makeFormula(doc, part);
      if (!formula) continue;
      appendRange(point(start, true));
      content.appendChild(formula);
      previous = point(cursor);
      rendered = true;
    }
    if (!rendered) return null;
    appendRange([node, node.childNodes.length]);
    return content;
  }

  function sourceKey(entry, node) {
    return entry.sidebar ? node.innerHTML : node.value || "";
  }

  function updateNode(entry, node) {
    const doc = entry.document;
    if (doc.activeElement === node || (entry.sidebar && node.parentElement?.contains(doc.activeElement))) {
      if (entry.hover?.node === node) dismissHover(entry);
      node.removeAttribute(MARKER);
      const item = entry.items.get(node);
      item?.parent?.removeAttribute(SIDEBAR_MARKER);
      item?.parent?.removeAttribute(SIDEBAR_LAYOUT);
      if (item?.preview) item.preview.hidden = true;
      return;
    }
    const source = sourceKey(entry, node);
    const addText = entry.sidebar && !!node.closest?.("[data-sidebar-annotation-id]")
      ?.querySelector(".preview > header > .start > .icon-text");
    let item = entry.items.get(node);
    if (item?.failed && item.source === source && item.addText === addText) return;
    const layout = addText ? sidebarLayout(entry, node) : null;
    const text = addText ? layout?.source ?? (node.querySelector("br, div")
      ? node.innerText : node.textContent) ?? "" : source;
    if (!item || item.source !== source || item.addText !== addText || (addText && item.text !== text)) {
      removePreview(entry, node);
      item = { source, addText, text };
      entry.items.set(node, item);
      const content = addText ? makeContent(doc, ZoteroPluginMathJax.split(text) || [{ text }], true)
        : entry.sidebar ? makeSidebarContent(doc, node)
          : makeContent(doc, ZoteroPluginMathJax.split(source) || []);
      if (!content) return;
      item.preview = doc.createElement("div");
      item.preview.className = entry.sidebar ? SIDEBAR_PREVIEW : PREVIEW;
      if (!entry.sidebar) item.preview.setAttribute("data-zotero-plugin-source-id", node.getAttribute("data-id") || "");
      item.preview.setAttribute("aria-hidden", "true");
      item.preview.appendChild(content);
      item.content = content;
    }
    if (!item.preview) return;
    if (entry.sidebar) {
      const parent = node.parentElement;
      if (item.parent !== parent) item.parent?.removeAttribute(SIDEBAR_MARKER);
      item.parent = parent;
      if (item.preview.parentElement !== parent) parent.appendChild(item.preview);
      const style = doc.defaultView.getComputedStyle(node);
      item.preview.style.padding = style.padding;
      item.preview.style.direction = style.direction;
      item.preview.style.textAlign = style.textAlign;
      item.preview.hidden = false;
      parent.setAttribute(SIDEBAR_MARKER, "");
      node.setAttribute(MARKER, "");
      if (addText) scaleSidebar(entry, node, item, style, layout);
      return;
    }
    // Place the preview beside the native layer, outside its child diffing.
    // The textarea remains Zotero's only focus, pointer, and saved-data target.
    const parent = node.parentElement?.parentElement;
    if (!parent) return;
    if (item.preview.parentElement !== parent) parent.appendChild(item.preview);
    const style = doc.defaultView.getComputedStyle(node);
    item.preview.style.cssText = node.style.cssText;
    for (const property of ["fontFamily", "lineHeight", "padding", "direction", "textAlign"]) {
      item.preview.style[property] = style[property];
    }
    item.preview.hidden = false;
    // Fit within Zotero's existing hit/resize rectangle without writing positions.
    item.content.style.transform = "";
    const width = item.preview.clientWidth;
    const height = item.preview.clientHeight;
    const contentWidth = item.content.scrollWidth;
    const contentHeight = item.content.scrollHeight;
    if (width > 0 && height > 0 && contentWidth > 0 && contentHeight > 0) {
      const scale = Math.min(1, width / contentWidth, height / contentHeight);
      item.content.style.transform = `scale(${scale})`;
    }
    node.setAttribute(MARKER, "");
  }

  function scanAnnotations(state, entry) {
    if (!isActive(state) || state.documents.get(entry.document) !== entry) return;
    entry.queued = false;
    // All changes here are synchronous. Observe again after our own DOM writes
    // so preview insertion and styling cannot start a mutation feedback loop.
    entry.observer.disconnect();
    try {
      const nodes = new Set(entry.document.querySelectorAll(entry.selector));
      for (const node of entry.items.keys()) {
        if (!nodes.has(node)) removePreview(entry, node);
      }
      for (const node of nodes) {
        try {
          updateNode(entry, node);
        } catch (error) {
          const addText = entry.sidebar && !!node.closest?.("[data-sidebar-annotation-id]")
            ?.querySelector(".preview > header > .start > .icon-text");
          removePreview(entry, node);
          // Do not retry a broken DOM/rendering operation on every mouse or
          // reader mutation. A content edit or a new view can retry safely.
          entry.items.set(node, { source: sourceKey(entry, node), addText, failed: true });
          report(error);
        }
      }
      if (entry.hover && !entry.hover.row.getClientRects().length) dismissHover(entry);
    } finally {
      if (isActive(state)) entry.observer.observe(entry.document.documentElement, OBSERVE);
    }
    if (!entry.sidebar) {
      const sidebar = state.documents.get(state.document);
      if (sidebar) schedule(state, sidebar);
    }
  }

  function schedule(state, entry) {
    if (entry.queued || !isActive(state)) return;
    entry.queued = true;
    void Promise.resolve().then(() => scanAnnotations(state, entry));
  }

  function addDocument(state, doc, sidebar = false) {
    if (!doc?.head || state.documents.has(doc)) return;
    const entry = { state, document: doc, items: new Map(), sidebar, selector: sidebar ? SIDEBAR_SELECTOR : SELECTOR };
    state.documents.set(doc, entry);
    const style = doc.createElement("style");
    entry.style = style;
    style.id = "zotero-plugin-math-text";
    style.textContent = `
      ${SELECTOR}[${MARKER}]:not(:focus) { color: transparent !important; }
      .${PREVIEW} {
        position: absolute; z-index: 3; pointer-events: none !important;
        box-sizing: border-box; border: none; margin: 0; overflow: hidden;
        white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .${PREVIEW}[hidden] { display: none !important; }
      .zotero-plugin-math-content { transform-origin: top left; }
      .zotero-plugin-math-display { display: block; text-align: center; }
      .zotero-plugin-math-inline { display: inline-block; white-space: nowrap; }
      .${PREVIEW} svg { max-width: none; overflow: visible; }
      #annotationsView .editor[${SIDEBAR_MARKER}] { display: grid; }
      #annotationsView .editor > .content[${MARKER}] {
        grid-area: 1 / 1; opacity: 0; min-width: 0;
      }
      #annotationsView .${SIDEBAR_PREVIEW} {
        grid-area: 1 / 1; min-width: 0; box-sizing: border-box;
        pointer-events: none !important; white-space: pre-wrap;
        overflow-wrap: anywhere; overflow: hidden; max-height: calc(4em + 6px);
      }
      #annotationsView .expanded .${SIDEBAR_PREVIEW} { max-height: none; }
      #annotationsView .${SIDEBAR_PREVIEW}[hidden] { display: none !important; }
      #annotationsView .${SIDEBAR_PREVIEW} svg { max-width: 100%; height: auto; }
      #annotationsView .${SIDEBAR_PREVIEW}[${SIDEBAR_LAYOUT}] {
        position: relative; min-height: 0; max-height: none;
      }
      #annotationsView .${SIDEBAR_PREVIEW}[${SIDEBAR_LAYOUT}] svg { max-width: none; }
      #annotationsView .editor[${SIDEBAR_MARKER}][${SIDEBAR_LAYOUT}] > .content[${MARKER}] {
        position: absolute; inset: 0; width: 100%; height: 100%; box-sizing: border-box;
      }
      .${HOVER_PREVIEW} {
        position: fixed; z-index: 2147483647; left: 12px; top: 12px;
        box-sizing: border-box; padding: 14px; overflow: auto; overscroll-behavior: contain;
        background: var(--material-background, #fff); color: var(--fill-primary, #222);
        border: 1px solid var(--fill-quinary, #ccc); border-radius: 6px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, .25);
        white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .${HOVER_PREVIEW} svg { max-width: none; height: auto; overflow: visible; }
    `;
    doc.head.appendChild(style);
    entry.onEdit = event => {
      const node = event.target.closest?.(entry.selector)
        || (event.target.matches?.(entry.selector) ? event.target : null);
      if (!node) return;
      dismissHover(entry);
      if (event.type === "focusin") {
        node.removeAttribute(MARKER);
        const item = entry.items.get(node);
        item?.parent?.removeAttribute(SIDEBAR_MARKER);
        item?.parent?.removeAttribute(SIDEBAR_LAYOUT);
        if (item?.preview) item.preview.hidden = true;
      }
      schedule(state, entry);
    };
    for (const type of ["focusin", "focusout", "input"]) doc.addEventListener(type, entry.onEdit, true);
    entry.onFonts = () => { dismissHover(entry); schedule(state, entry); };
    doc.fonts?.addEventListener("loadingdone", entry.onFonts);
    if (sidebar) installHover(entry);
    if (sidebar && doc.defaultView.ResizeObserver) {
      const widths = new WeakMap();
      entry.resizeObserver = new doc.defaultView.ResizeObserver(changes => {
        let changed = false;
        for (const { target, contentRect } of changes) {
          if (widths.get(target) !== contentRect.width) {
            if (widths.has(target) && entry.hover
                && entry.items.get(entry.hover.node)?.layoutParent === target) dismissHover(entry);
            widths.set(target, contentRect.width);
            changed = true;
          }
        }
        if (changed) schedule(state, entry);
      });
    }
    entry.observer = new doc.defaultView.MutationObserver(() => schedule(state, entry));
    scanAnnotations(state, entry);
  }

  function removeDocument(state, doc) {
    const entry = state.documents.get(doc);
    if (!entry) return;
    state.documents.delete(doc);
    entry.observer.disconnect();
    entry.resizeObserver?.disconnect();
    dismissHover(entry);
    if (entry.sidebar) {
      for (const type of ["mouseover", "mouseout"]) doc.removeEventListener(type, entry.onHover, true);
      for (const type of ["pointerdown", "scroll", "wheel", "keydown"]) doc.removeEventListener(type, entry.onDismissHover, true);
      for (const type of ["resize", "blur"]) doc.defaultView.removeEventListener(type, entry.onDismissHover);
    }
    for (const type of ["focusin", "focusout", "input"]) doc.removeEventListener(type, entry.onEdit, true);
    doc.fonts?.removeEventListener("loadingdone", entry.onFonts);
    for (const node of entry.items.keys()) removePreview(entry, node);
    entry.style.remove();
  }

  function scanDocuments(state) {
    if (!isActive(state)) return;
    const documents = new Set([state.document]);
    for (const iframe of state.document.querySelectorAll("iframe")) {
      if (!iframe.getAttribute("src")?.includes("pdf/web/viewer.html")) continue;
      const doc = iframe.contentDocument;
      if (doc?.head && doc.documentURI !== "about:blank") documents.add(doc);
    }
    for (const doc of state.documents.keys()) {
      if (!documents.has(doc)) removeDocument(state, doc);
    }
    for (const doc of documents) addDocument(state, doc, doc === state.document);
  }

  function detach(reader) {
    const state = READERS.get(reader);
    if (!state) return;
    state.closed = true;
    READERS.delete(reader);
    state.observer?.disconnect();
    state.document?.removeEventListener("load", state.onLoad, true);
    state.window?.removeEventListener("unload", state.onUnload);
    for (const doc of state.documents.keys()) removeDocument(state, doc);
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
      if (!doc?.head) { detach(reader); return; }
      state.window = win;
      state.document = doc;
      state.onLoad = () => scanDocuments(state);
      state.onUnload = () => detach(reader);
      doc.addEventListener("load", state.onLoad, true);
      win.addEventListener("unload", state.onUnload, { once: true });
      state.observer = new win.MutationObserver(() => scanDocuments(state));
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
      scanDocuments(state);
    } catch (error) {
      if (READERS.get(reader) === state) detach(reader);
      report(error);
    }
  }

  function onReaderEvent({ reader }) {
    const state = READERS.get(reader);
    if (state?.document) scanDocuments(state);
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
    }, ["tab"], "zotero-plugin-math-text");
    for (const reader of Zotero.Reader._readers || []) void attach(reader);
  }

  function shutdown() {
    if (!session) return;
    const { notifierID } = session;
    session = null;
    Zotero.Notifier.unregisterObserver(notifierID);
    for (const event of EVENTS) Zotero.Reader.unregisterEventListener(event, onReaderEvent);
    for (const reader of READERS.keys()) detach(reader);
    CACHE.clear();
  }

  return { startup, shutdown };
})();
