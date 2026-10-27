// Optional browser integration check. See docs/development.md for dependencies.
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.join(__dirname, "..");

async function check(browser) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("request", request => requests.push(request.url()));
  try {
    const editorCSS = `
      body { font: 14px sans-serif; margin: 12px; }
      #annotationsView { width: 280px; float: left; }
      .annotation { border: 1px solid #bbb; margin-bottom: 8px; }
      .editor { position: relative; font-size: 14px; line-height: calc(4 / 3); }
      .content { padding: 3px 8px; word-wrap: break-word; }
      .renderer { position: absolute; opacity: 0; width: 1px; height: 1px; overflow: hidden; }
      .expandable-editor .content { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .expandable-editor.expanded .content { display: block; -webkit-line-clamp: unset; }
      iframe { width: 760px; height: 800px; border: 0; }
    `;
    await page.route("https://zotero.test/**", route => route.fulfill({
      contentType: "text/html",
      body: route.request().url().endsWith("reader.html")
        ? `<html><head><style>${editorCSS}</style></head><body><div id="annotationsView"></div><iframe src="pdf/web/viewer.html"></iframe></body></html>`
        : `<html><head><style>
          .page { position: relative; width: 700px; height: 700px; --scale-factor: 1; }
          .customAnnotationLayer { position: absolute; top: 0; left: 0; }
          .textAnnotation { position: absolute; border: none; padding: 0; margin: 0; background: transparent; box-sizing: border-box; }
        </style></head><body><div class="page"><div class="customAnnotationLayer"></div></div></body></html>`,
    }));
    await page.route("**/handwriting.ttf", route => route.fulfill({
      contentType: "font/ttf", path: path.join(root, "assets/fonts/HetangYuese-Regular.ttf"),
    }));
    await page.goto("https://zotero.test/reader/reader.html");
    await page.evaluate(() => {
      window.ZoteroPluginHandwritingFonts = [{
        family: "ZoteroPluginHandwriting", source: "https://zotero.test/handwriting.ttf",
      }];
    });
    for (const file of ["vendor/mathjax/tex-svg.js", "src/features/handwritten-text.js", "src/features/math-text.js", "src/features/black-text-sidebar-filter.js", "src/features/text-annotation-size.js"]) {
      await page.addScriptTag({ path: path.join(root, file) });
    }
    await page.evaluate(() => {
      window.reader = { _type: "pdf", tabID: "one", _iframeWindow: window,
        _initPromise: Promise.resolve(), _waitForReader: async () => {} };
      window.diagnostics = [];
      window.Zotero = {
        debug(error) { diagnostics.push(error); },
        Reader: { _readers: [reader], registerEventListener() {}, unregisterEventListener() {} },
        Notifier: { registerObserver() { return 1; }, unregisterObserver() {} },
      };
      window.addRow = (id, type, source, color = "#ff0000", section = "comment") => {
        const row = document.createElement("div");
        row.className = "annotation";
        row.setAttribute("data-sidebar-annotation-id", id);
        row.innerHTML = `<div class="preview"><header><div class="start"><span class="icon-${type}"></span></div></header><div class="${section}"><div class="expandable-editor expanded"><div class="editor"><div class="content" contenteditable="true" dir="auto"></div><div class="renderer"></div></div></div></div></div>`;
        row.querySelector(".start span").style.color = color;
        row.querySelector(".content").textContent = source;
        row.addEventListener("click", () => { window.rowClicks = (window.rowClicks || 0) + 1; });
        document.querySelector("#annotationsView").appendChild(row);
        return row.querySelector(".content");
      };
      addRow("text", "text", String.raw`中文 $E=mc^2$ English`);
      addRow("black", "text", "$x^2$", "#000000");
      const rich = addRow("rich", "underline", "");
      rich.innerHTML = String.raw`<b>Bold</b> <i>italic</i><br>$$\frac{a}{b}$$<br><sup>2</sup>`;
      const split = addRow("split", "highlight", "", "#ff0000", "text");
      split.innerHTML = String.raw`<b>$\frac{</b><i>a}{b}$</i>`;
      addRow("bad", "text", String.raw`$\badcommand$`);
      addRow("plain", "text", "ordinary text");
      addRow("escape", "text", String.raw`\$5 plus $x_1$`);
      const textarea = document.querySelector("iframe").contentDocument.createElement("textarea");
      textarea.className = "textAnnotation";
      textarea.setAttribute("data-id", "pdf-math");
      textarea.value = String.raw`PDF $\sqrt{x^2+1}$`;
      textarea.style.cssText = "left:30px;top:40px;width:600px;height:80px;font-size:24px;color:#000";
      document.querySelector("iframe").contentDocument.querySelector(".customAnnotationLayer").appendChild(textarea);
      ZoteroPluginBlackTextSidebarFilter.startup({ id: "test" });
      ZoteroPluginMathText.startup({ id: "test" });
      ZoteroPluginHandwrittenText.startup({ id: "test" });
    });
    const row = id => page.locator(`[data-sidebar-annotation-id="${id}"]`);
    await page.waitForFunction(() => document.querySelectorAll(".zotero-plugin-math-sidebar-preview").length === 7);
    await page.waitForFunction(() => document.fonts.check('14px "ZoteroPluginHandwriting"')
      && document.querySelector("#zotero-plugin-handwritten-text"));
    const handwriting = /ZoteroPluginHandwriting/;
    const family = locator => locator.evaluate(node => getComputedStyle(node).fontFamily);
    assert.match(await family(row("plain").locator(".content")), handwriting);
    assert.match(await family(row("text").locator(".zotero-plugin-math-sidebar-preview")), handwriting);
    assert.doesNotMatch(await family(row("rich").locator(".content")), handwriting);
    assert.doesNotMatch(await family(row("split").locator(".zotero-plugin-math-sidebar-preview")), handwriting);
    assert.doesNotMatch(await family(row("text").locator("header")), handwriting);
    assert.equal(await row("black").isVisible(), false);
    assert.equal(await row("bad").locator(".zotero-plugin-math-sidebar-preview").textContent(), String.raw`$\badcommand$`);
    assert.equal(await row("plain").locator(".zotero-plugin-math-sidebar-preview").textContent(), "ordinary text");
    assert.equal(await row("rich").locator(".zotero-plugin-math-sidebar-preview b").textContent(), "Bold");
    assert.equal(await row("rich").locator(".zotero-plugin-math-sidebar-preview i").textContent(), "italic");
    assert.equal(await row("rich").locator(".zotero-plugin-math-sidebar-preview br").count(), 2);
    assert.equal(await row("split").locator(".zotero-plugin-math-sidebar-preview svg").count(), 1);
    assert.match(await row("escape").locator(".zotero-plugin-math-sidebar-preview").textContent(), /^\$5 plus /);
    const original = await row("rich").locator(".content").innerHTML();
    await row("text").locator(".content").click();
    assert.equal(await page.evaluate(() => rowClicks > 0), true, "native row click handlers receive pointer events");
    assert.equal(await row("text").locator(".zotero-plugin-math-sidebar-preview").isVisible(), false);
    assert.equal(await row("text").locator(".content").evaluate(node => getComputedStyle(node).opacity), "1");
    assert.match(await family(row("text").locator(".content")), handwriting, "native source editing uses handwriting too");
    await row("text").locator(".content").fill(String.raw`Edited $\frac{a}{b}$`);
    await row("text").locator(".content").blur();
    await row("text").locator(".zotero-plugin-math-sidebar-preview").waitFor({ state: "visible" });
    assert.match(await row("text").locator(".zotero-plugin-math-sidebar-preview").textContent(), /Edited/);
    // React/native input may change a text node's data without replacing it.
    await row("text").locator(".content").evaluate(node => { node.firstChild.data = "Changed $z_2$"; });
    await page.waitForFunction(() => document.querySelector('[data-sidebar-annotation-id="text"] .zotero-plugin-math-sidebar-preview').textContent.startsWith("Changed"));
    await page.evaluate(() => addRow("late", "text", "Late $y$"));
    await row("late").locator(".zotero-plugin-math-sidebar-preview").waitFor();
    assert.match(await family(row("late").locator(".zotero-plugin-math-sidebar-preview")), handwriting);
    await row("late").locator(".icon-text").evaluate(node => { node.className = "icon-note"; });
    await page.waitForFunction(() => !document.querySelector('[data-sidebar-annotation-id="late"]').hasAttribute("data-zotero-plugin-handwritten-text"));
    assert.doesNotMatch(await family(row("late").locator(".content")), handwriting);
    await row("late").evaluate(node => node.remove());
    await page.evaluate(() => {
      const content = document.querySelector('[data-sidebar-annotation-id="text"] .content');
      const clone = content.cloneNode(true);
      clone.removeAttribute("data-zotero-plugin-math");
      content.replaceWith(clone);
    });
    await page.waitForFunction(() => document.querySelector('[data-sidebar-annotation-id="text"] .content').hasAttribute("data-zotero-plugin-math"));
    await page.locator("#annotationsView").evaluate(node => { node.style.width = "160px"; });
    assert.equal(await row("rich").locator(".editor").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
    // Native manager fixture: updates selection bounds and persisted geometry,
    // while the actual browser measures handwriting and MathJax DOM content.
    await page.evaluate(() => {
      const doc = document.querySelector("iframe").contentDocument;
      const layer = doc.querySelector(".customAnnotationLayer");
      const annotations = new Map();
      const updates = [];
      const nodes = new Map();
      const metrics = { scale: 1 };
      function render(annotation) {
        const node = nodes.get(annotation.id);
        if (!node) return;
        const [x1, y1, x2, y2] = annotation.position.rects[0];
        const scale = metrics.scale;
        node.style.cssText = `left:${x1 * scale}px;top:${(700 - y2) * scale}px;width:${(x2 - x1) * scale}px;height:${(y2 - y1) * scale}px;font-size:${annotation.position.fontSize * scale}px;color:#000;transform:rotate(${-annotation.position.rotation || 0}deg)`;
        node.value = annotation.comment;
      }
      for (const [id, source, y, rotation] of [["pdf-math", String.raw`Inner-loop $a^{inner}$`, 550, 0],
        ["pdf-plain", "手写内容 Handwriting", 420, 0], ["pdf-rotated", "$x^2$", 250, 90]]) {
        let node = doc.querySelector(`textarea[data-id="${id}"]`);
        if (!node) { node = doc.createElement("textarea"); node.className = "textAnnotation"; node.setAttribute("data-id", id); layer.appendChild(node); }
        const annotation = { id, type: "text", comment: source, color: "#000000", sortIndex: "00000|000000|00300",
          position: { pageIndex: 0, rects: [[30, y, 630, y + 100]], fontSize: 24, rotation } };
        annotations.set(id, annotation); nodes.set(id, node); render(annotation);
      }
      const view = {
        _iframeWindow: doc.defaultView,
        getPageByIndex() { return { originalPage: { viewport: { scale: metrics.scale, viewBox: [0, 0, 700, 700] } } }; },
        adjustTextAnnotationPosition(annotation) {
          const position = JSON.parse(JSON.stringify(annotation.position));
          const [x, y, , top] = position.rects[0];
          position.rects = [[x, y, x + 600, Math.max(top, y + 100)]];
          return position;
        },
      };
      const manager = {
        _getAnnotationByID: id => annotations.get(id),
        updateAnnotations(changes) {
          if (changes.some(change => change.position && !change.sortIndex)) {
            throw new Error("If updating 'position', 'sortIndex' has to be provided as well");
          }
          updates.push(changes);
          for (const change of changes) {
            const annotation = annotations.get(change.id);
            annotation.position = change.position;
            render(annotation);
          }
        },
      };
      reader._internalReader = { _annotationManager: manager, _primaryView: view };
      window.boundsFixture = { annotations, updates, nodes, view, manager, metrics, render };
      ZoteroPluginTextAnnotationSize.startup({ id: "test" });
    });
    const frame = page.frame({ url: "https://zotero.test/reader/pdf/web/viewer.html" });
    await page.evaluate(() => {
      const source = String.raw`task: $t$                 fixed budget: $b_t$` + "\n"
        + String.raw`candidate solution: $x$` + "\n"
        + String.raw`Inner-loop agent: $a^{inner}$    Outer-loop agent: $a^{outer}$` + "\n"
        + String.raw`existing codebase: $x_0$    edits so far: $x_{<i}$` + "\n"
        + String.raw`signal observed on this task: $s_t^{pub}$`;
      boundsFixture.annotations.set("pdf-layout", { id: "pdf-layout", type: "text", comment: source,
        position: { rects: [[30, 100, 510, 280]], fontSize: 18 } });
      addRow("pdf-layout", "text", source);
    });
    const layoutCard = row("pdf-layout");
    await layoutCard.locator("[data-zotero-plugin-math-layout].zotero-plugin-math-sidebar-preview").waitFor();
    const layoutMetrics = () => layoutCard.evaluate(card => {
      const preview = card.querySelector(".zotero-plugin-math-sidebar-preview");
      const content = preview.firstElementChild;
      const css = getComputedStyle(content), range = document.createRange();
      range.selectNodeContents(content);
      return { naturalWidth: content.offsetWidth, naturalHeight: content.offsetHeight,
        scale: new DOMMatrixReadOnly(css.transform).a, fontSize: css.fontSize,
        height: preview.clientHeight, editorHeight: preview.parentElement.clientHeight,
        paintedWidth: content.getBoundingClientRect().width, cardWidth: card.clientWidth,
        fragmentCount: range.getClientRects().length, formulaCount: content.querySelectorAll("svg").length,
        lineBreaks: (content.textContent.match(/\n/g) || []).length };
    });
    const narrow = await layoutMetrics();
    assert.equal(narrow.fontSize, "18px", "layout uses the saved PDF font size before scaling");
    assert.ok(narrow.scale < 1 && narrow.scale > 0);
    assert.ok(narrow.paintedWidth <= narrow.cardWidth, "the complete layout fits within the sidebar");
    assert.ok(narrow.editorHeight <= narrow.height + 1, "hidden source text does not leave an unscaled blank area");
    assert.equal(narrow.formulaCount, 8);
    assert.equal(narrow.lineBreaks, 4, "saved explicit line breaks remain intact");
    await page.locator("#annotationsView").evaluate(node => { node.style.width = "320px"; });
    await page.waitForFunction(() => {
      const content = document.querySelector('[data-sidebar-annotation-id="pdf-layout"] .zotero-plugin-math-content');
      return new DOMMatrixReadOnly(getComputedStyle(content).transform).a > 0.5;
    });
    const wide = await layoutMetrics();
    assert.ok(wide.scale > narrow.scale, "sidebar resizing automatically recomputes the largest fitting scale");
    assert.equal(wide.naturalWidth, narrow.naturalWidth);
    assert.equal(wide.naturalHeight, narrow.naturalHeight);
    assert.equal(wide.fragmentCount, narrow.fragmentCount, "sidebar resizing preserves the original line layout");
    assert.ok(Math.abs(wide.height - 6 - wide.naturalHeight * wide.scale) <= 2);
    await layoutCard.locator(".expandable-editor").evaluate(node => node.classList.remove("expanded"));
    assert.equal((await layoutMetrics()).height, wide.height, "the scaled Add Text layout remains complete in collapsed cards");
    await layoutCard.locator(".expandable-editor").evaluate(node => node.classList.add("expanded"));
    const hoverPreview = page.locator(".zotero-plugin-math-hover-preview");
    await layoutCard.hover();
    await page.waitForTimeout(150);
    assert.equal(await hoverPreview.count(), 0, "brief hovering does not open a preview");
    await hoverPreview.waitFor({ state: "visible" });
    const enlarged = await hoverPreview.evaluate(popup => {
      const content = popup.querySelector(".zotero-plugin-math-content");
      const css = getComputedStyle(content), rect = popup.getBoundingClientRect();
      return { width: content.offsetWidth, height: content.offsetHeight,
        scale: new DOMMatrixReadOnly(css.transform).a, fontFamily: css.fontFamily,
        formulas: content.querySelectorAll("svg").length,
        lineBreaks: (content.textContent.match(/\n/g) || []).length,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    assert.equal(enlarged.width, wide.naturalWidth);
    assert.equal(enlarged.height, wide.naturalHeight);
    assert.ok(enlarged.scale > wide.scale, "the hover preview enlarges the complete layout");
    assert.match(enlarged.fontFamily, handwriting);
    assert.equal(enlarged.formulas, 8);
    assert.equal(enlarged.lineBreaks, 4);
    assert.ok(enlarged.left >= 0 && enlarged.top >= 0 && enlarged.right <= 1100 && enlarged.bottom <= 850,
      "the popup stays inside the viewport");
    if (process.env.HOVER_PREVIEW_SCREENSHOT) await hoverPreview.screenshot({ path: process.env.HOVER_PREVIEW_SCREENSHOT });
    await hoverPreview.hover();
    await page.waitForTimeout(250);
    assert.equal(await hoverPreview.isVisible(), true, "the pointer can enter the popup to read and scroll");
    await page.keyboard.press("Escape");
    assert.equal(await hoverPreview.count(), 0);
    await page.mouse.move(1090, 10);
    await layoutCard.hover();
    await page.waitForTimeout(100);
    await page.mouse.move(1090, 10);
    await page.waitForTimeout(650);
    assert.equal(await hoverPreview.count(), 0, "leaving cancels a pending preview");
    await row("rich").hover();
    await page.waitForTimeout(650);
    assert.equal(await hoverPreview.count(), 0, "other annotation types retain native hover behavior");
    await row("plain").hover();
    await hoverPreview.waitFor({ state: "visible" });
    assert.equal(await hoverPreview.textContent(), "ordinary text", "plain Add Text annotations also have enlarged previews");
    await page.mouse.move(1090, 10);
    await hoverPreview.waitFor({ state: "detached" });
    await layoutCard.hover();
    await hoverPreview.waitFor({ state: "visible" });
    await layoutCard.locator(".content").click();
    assert.equal(await hoverPreview.count(), 0, "clicking to edit dismisses the popup without intercepting the click");
    assert.equal(await layoutCard.locator(".zotero-plugin-math-sidebar-preview").isVisible(), false);
    assert.equal(await layoutCard.locator(".content").evaluate(node => getComputedStyle(node).position), "static");
    await layoutCard.locator(".content").blur();
    await layoutCard.locator(".zotero-plugin-math-sidebar-preview").waitFor({ state: "visible" });
    await page.evaluate(() => addRow("long-hover", "text", "Long handwritten text $x^2$\n".repeat(60)));
    await row("long-hover").locator(".zotero-plugin-math-sidebar-preview").waitFor({ state: "visible" });
    // Let Playwright's automatic scroll settle before starting the hover delay;
    // scrolling intentionally dismisses previews even if the pointer is still.
    const settleScroll = async locator => {
      await locator.scrollIntoViewIfNeeded();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.mouse.move(1090, 10);
    };
    await settleScroll(row("long-hover"));
    await row("long-hover").hover();
    await hoverPreview.waitFor({ state: "visible" });
    assert.equal(await hoverPreview.evaluate(popup => popup.scrollHeight > popup.clientHeight), true,
      "long previews can be scrolled instead of reducing readability");
    await hoverPreview.hover();
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector(".zotero-plugin-math-hover-preview")?.scrollTop > 0);
    assert.equal(await hoverPreview.isVisible(), true, "scrolling inside the popup keeps it open");
    await page.locator("#annotationsView").dispatchEvent("scroll");
    assert.equal(await hoverPreview.count(), 0, "scrolling the sidebar dismisses stale preview placement");
    await row("long-hover").evaluate(node => node.remove());
    await settleScroll(layoutCard);
    await layoutCard.hover();
    await hoverPreview.waitFor({ state: "visible" });
    await page.locator("#annotationsView").evaluate(node => { node.style.width = "310px"; });
    await hoverPreview.waitFor({ state: "detached" });
    await page.mouse.move(1090, 10);
    for (const id of ["pdf-math", "pdf-plain", "pdf-rotated"]) {
      const node = frame.locator(`textarea[data-id="${id}"]`);
      await node.focus();
      await node.blur();
      await page.waitForFunction(id => {
        const rect = boundsFixture.annotations.get(id).position.rects[0];
        return rect[2] - rect[0] < 500 && rect[3] - rect[1] < 90;
      }, id);
    }
    const sizes = await page.evaluate(() => [...boundsFixture.annotations.values()].map(a => ({
      id: a.id, width: a.position.rects[0][2] - a.position.rects[0][0],
      height: a.position.rects[0][3] - a.position.rects[0][1], source: a.comment,
    })));
    assert.ok(sizes[0].width < 400, "formula bounds follow rendered math instead of raw TeX");
    assert.ok(sizes[1].width < 400, "plain handwritten text also fits after editing");
    const mathNode = frame.locator('textarea[data-id="pdf-math"]');
    await mathNode.focus();
    assert.ok(await page.evaluate(() => {
      const rect = boundsFixture.annotations.get("pdf-math").position.rects[0];
      return rect[2] - rect[0] >= 600;
    }), "re-entering edit mode restores room for source text");
    await mathNode.blur();
    await page.waitForFunction(() => {
      const rect = boundsFixture.annotations.get("pdf-math").position.rects[0];
      return rect[2] - rect[0] < 400;
    });
    assert.equal(await page.evaluate(() => boundsFixture.annotations.get("pdf-math").comment), sizes[0].source);
    for (const scale of [0.5, 2]) {
      await page.evaluate(scale => {
        boundsFixture.metrics.scale = scale;
        for (const annotation of boundsFixture.annotations.values()) boundsFixture.render(annotation);
      }, scale);
      await mathNode.focus(); await mathNode.blur();
      await page.waitForFunction(() => {
        const rect = boundsFixture.annotations.get("pdf-math").position.rects[0];
        return rect[2] - rect[0] < 400;
      });
      const width = await page.evaluate(() => {
        const rect = boundsFixture.annotations.get("pdf-math").position.rects[0];
        return rect[2] - rect[0];
      });
      assert.ok(Math.abs(width - sizes[0].width) < 3, "PDF-point bounds remain stable at different zoom levels");
    }
    assert.ok(await page.evaluate(() => boundsFixture.updates.every(changes => changes.every(change =>
      Object.keys(change).sort().join(",") === "id,position,sortIndex"))), "geometry updates include native-required ordering metadata");
    // Zotero side-handle resize commits a source-measured height on pointerup.
    // Reproduce the extra bottom row without any focus/blur event.
    await page.evaluate(() => {
      const { annotations, view, metrics, render, manager, nodes } = boundsFixture;
      metrics.scale = 1;
      const annotation = annotations.get("pdf-math");
      annotation.comment = String.raw`task: $t$    fixed budget: $b_t$` + "\n"
        + String.raw`signal observed on this task: $s_t^{pub}$`;
      annotation.position = { ...annotation.position, rects: [[30, 450, 630, 550]], rotation: 0 };
      render(annotation);
      view.action = { type: "resize", triggered: true, annotation, dir: "r",
        position: { ...annotation.position, rects: [[30, 430, 330, 550]] } };
      const doc = nodes.get("pdf-math").ownerDocument;
      doc.defaultView.addEventListener("pointerup", () => {
        manager.updateAnnotations([{ id: annotation.id, position: view.action.position, sortIndex: annotation.sortIndex }]);
        view.action = null;
      }, { once: true });
      doc.querySelector(".page").dispatchEvent(new doc.defaultView.PointerEvent("pointerup", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const rect = boundsFixture.annotations.get("pdf-math").position.rects[0];
      return rect[3] - rect[1] < 90;
    }, undefined, { timeout: 1500 });
    const resized = await page.evaluate(() => {
      const annotation = boundsFixture.annotations.get("pdf-math");
      const rect = annotation.position.rects[0];
      const node = boundsFixture.nodes.get("pdf-math");
      const content = node.ownerDocument.querySelector('[data-zotero-plugin-source-id="pdf-math"] > div');
      return { width: rect[2] - rect[0], height: rect[3] - rect[1],
        visualHeight: content.getBoundingClientRect().height, source: annotation.comment };
    });
    assert.equal(resized.width, 300, "manual width is retained while removing source-only blank lines");
    assert.ok(resized.height - resized.visualHeight <= 2, "no blank row remains below rendered math");
    assert.match(resized.source, /\n/);
    // Read-only annotations and shutdown during a pending fit must not write.
    await page.evaluate(() => { boundsFixture.annotations.get("pdf-math").readOnly = true; });
    const before = await page.evaluate(() => boundsFixture.updates.length);
    await mathNode.focus(); await mathNode.blur();
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => boundsFixture.updates.length), before);
    await frame.locator('textarea[data-id="pdf-plain"]').focus();
    await frame.locator('textarea[data-id="pdf-plain"]').blur();
    await page.evaluate(() => ZoteroPluginTextAnnotationSize.shutdown());
    const shutdownCount = await page.evaluate(() => boundsFixture.updates.length);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => boundsFixture.updates.length), shutdownCount);
    if (process.env.MATH_PREVIEW_SCREENSHOT) await layoutCard.screenshot({ path: process.env.MATH_PREVIEW_SCREENSHOT });
    await layoutCard.hover();
    await page.evaluate(() => ZoteroPluginMathText.shutdown());
    await page.waitForTimeout(650);
    assert.equal(await hoverPreview.count(), 0, "shutdown cancels pending hover timers");
    assert.equal(await page.locator(".zotero-plugin-math-sidebar-preview").count(), 0);
    assert.equal(await page.locator("[data-zotero-plugin-math-sidebar], [data-zotero-plugin-math]").count(), 0);
    assert.equal(await row("rich").locator(".content").innerHTML(), original);
    assert.equal(await row("black").isVisible(), false, "MathJax cleanup preserves black annotation filtering");
    assert.match(await family(row("plain").locator(".content")), handwriting);
    await page.evaluate(() => ZoteroPluginHandwrittenText.shutdown());
    assert.equal(await page.locator("[data-zotero-plugin-handwritten-text]").count(), 0);
    assert.doesNotMatch(await family(row("plain").locator(".content")), handwriting);
    assert.equal(await row("black").isVisible(), false, "handwriting cleanup preserves black annotation filtering");
    await page.evaluate(() => ZoteroPluginBlackTextSidebarFilter.shutdown());
    assert.equal(await row("black").isVisible(), true);
    assert.deepEqual(await page.evaluate(() => diagnostics), []);
    assert.deepEqual(errors, []);
    assert.ok(requests.every(url => url.startsWith("https://zotero.test/")), "rendering never requests external resources");
    console.log("Browser checks passed: sidebar handwriting/SVG, delayed hover previews, popup scrolling/dismissal, editing, rendered annotation sizing, rotation, zoom, read-only/pending-fit protection, filtering, and cleanup.");
  } finally {
    await page.close();
  }
}

module.exports = check;
if (require.main === module) {
  const { chromium } = require("playwright-core");
  (async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
    try { await check(browser); } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
