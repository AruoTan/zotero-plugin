/* zotero-plugin — personal Zotero customizations */

var pluginID;
var notifierID;
const ATTACHED = new WeakSet();
const CLEANUPS = new WeakMap();

const CSS = `body:not(.zotero-plugin-show-popup) .selection-popup { display: none !important; }`;

function install() {}
function uninstall() {}

function startup({ id }) {
  pluginID = id;

  // Already-open readers
  for (const reader of (Zotero.Reader && Zotero.Reader._readers) || []) {
    attachToReader(reader);
  }

  // New reader tabs — earliest hook, fixes first-selection gap
  notifierID = Zotero.Notifier.registerObserver(
    {
      notify(event, type, ids) {
        if (type !== "tab" || event !== "add") return;
        for (const tabID of ids) {
          const reader = Zotero.Reader.getByTabID(tabID);
          if (reader) attachToReader(reader);
        }
      },
    },
    ["tab"],
    "zotero-plugin-observer",
  );

  // Safety net in case the tab notifier misses a reader
  Zotero.Reader.registerEventListener(
    "renderTextSelectionPopup",
    (ev) => attachToReader(ev.reader),
    pluginID,
  );
}

function shutdown() {
  if (notifierID) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (e) {}
    notifierID = null;
  }
  for (const reader of (Zotero.Reader && Zotero.Reader._readers) || []) {
    detachFromReader(reader);
  }
}

async function attachToReader(reader) {
  if (!reader || ATTACHED.has(reader)) return;
  ATTACHED.add(reader);
  CLEANUPS.set(reader, []);

  try {
    if (typeof reader._waitForReader === "function") {
      await reader._waitForReader();
    } else {
      for (let i = 0; i < 200; i++) {
        if (reader._iframeWindow && reader._iframeWindow.document?.body) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  } catch (e) {
    Zotero.debug("[zotero-plugin] waitForReader failed: " + e);
  }

  const outerWin = reader._iframeWindow;
  const outerDoc = outerWin && outerWin.document;
  if (!outerDoc) return;

  // Hide the popup by default; show it only when body has .zotero-plugin-show-popup
  const style = outerDoc.createElement("style");
  style.id = "zotero-plugin-style";
  style.textContent = CSS;
  outerDoc.head.appendChild(style);
  CLEANUPS.get(reader).push(() => style.remove());

  // PDF text layer lives in the outer reader iframe — listen there
  attachListeners(outerWin, outerDoc, outerDoc, reader);

  // EPUB/snapshot content lives in nested iframes — attach there too
  for (const iframe of outerDoc.querySelectorAll("iframe")) {
    attachIframe(iframe, outerDoc, reader);
  }

  // Reader may mount content iframes after we attach; watch for them
  const observer = new outerWin.MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "IFRAME") {
          attachIframe(node, outerDoc, reader);
        } else if (node.querySelectorAll) {
          for (const iframe of node.querySelectorAll("iframe")) {
            attachIframe(iframe, outerDoc, reader);
          }
        }
      }
    }
  });
  observer.observe(outerDoc.body || outerDoc.documentElement, {
    childList: true,
    subtree: true,
  });
  CLEANUPS.get(reader).push(() => observer.disconnect());
}

function attachIframe(iframe, outerDoc, reader) {
  if (iframe._zoteroPluginIframeAttached) return;
  iframe._zoteroPluginIframeAttached = true;

  const tryAttach = () => {
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument;
      if (!win || !doc || !doc.body) return;
      attachListeners(win, doc, outerDoc, reader);
    } catch (e) {
      // Cross-origin or not yet loaded
    }
  };

  tryAttach();
  iframe.addEventListener("load", tryAttach);
  const cleanups = CLEANUPS.get(reader);
  if (cleanups) cleanups.push(() => iframe.removeEventListener("load", tryAttach));
}

function attachListeners(win, listenDoc, classDoc, reader) {
  const onMousedown = () => classDoc.body?.classList.remove("zotero-plugin-show-popup");
  const onMouseup = (e) => {
    if (e.altKey) classDoc.body?.classList.add("zotero-plugin-show-popup");
    else classDoc.body?.classList.remove("zotero-plugin-show-popup");
  };
  const onSelectionChange = () => {
    try {
      const sel = win.getSelection && win.getSelection();
      if (!sel || sel.isCollapsed) {
        classDoc.body?.classList.remove("zotero-plugin-show-popup");
      }
    } catch (e) {}
  };

  listenDoc.addEventListener("mousedown", onMousedown, true);
  listenDoc.addEventListener("mouseup", onMouseup, true);
  listenDoc.addEventListener("selectionchange", onSelectionChange);

  const cleanups = CLEANUPS.get(reader);
  if (cleanups) {
    cleanups.push(() => {
      try {
        listenDoc.removeEventListener("mousedown", onMousedown, true);
        listenDoc.removeEventListener("mouseup", onMouseup, true);
        listenDoc.removeEventListener("selectionchange", onSelectionChange);
      } catch (e) {}
    });
  }
}

function detachFromReader(reader) {
  if (!ATTACHED.has(reader)) return;
  ATTACHED.delete(reader);
  const cleanups = CLEANUPS.get(reader) || [];
  CLEANUPS.delete(reader);
  for (const fn of cleanups) {
    try {
      fn();
    } catch (e) {}
  }
  try {
    reader._iframeWindow?.document?.body?.classList.remove("zotero-plugin-show-popup");
  } catch (e) {}
}
