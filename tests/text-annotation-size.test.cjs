const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../src/features/text-annotation-size.js"), "utf8");

function harness(rotation = 0) {
  const scope = vm.createContext({});
  // Expose the static factory only inside the test's private source copy.
  vm.runInContext(source.replace("return { startup, shutdown };", "return { startup, shutdown, createBridge };"), scope);
  vm.runInContext(`
    var doc = {}, changes = [];
    var annotation = { id: "A", type: "text", comment: "$x$", color: "#000000", sortIndex: "00000|000000|00300",
      position: { pageIndex: 0, fontSize: 14, rotation: ${rotation}, rects: [[200, 300, 400, 400]] } };
    var page = { viewport: { scale: 2, viewBox: [0, 0, 1000, 1000] } };
    var view = { _iframeWindow: { document: doc }, getPageByIndex: () => ({ originalPage: page }),
      adjustTextAnnotationPosition: a => ({ ...a.position, rects: [[200, 300, 500, 450]] }) };
    var manager = { _getAnnotationByID: id => id === annotation.id ? annotation : null,
      updateAnnotations(updates) {
        if (updates.some(update => update.position && !update.sortIndex)) {
          throw new Error("If updating 'position', 'sortIndex' has to be provided as well");
        }
        if (Object.getPrototypeOf(updates) !== Array.prototype) throw new Error("Wrong update array realm");
        if (Object.getPrototypeOf(updates[0]) !== Object.prototype) throw new Error("Wrong annotation realm");
        changes.push(updates); annotation.position = updates[0].position;
      } };
    var internal = { _annotationManager: manager, _primaryView: view };
    var bridge = ZoteroPluginTextAnnotationSize.createBridge(internal);
  `, scope);
  return {
    scope,
    info() { return JSON.parse(scope.bridge.get("A", scope.doc)); },
    request(extra = {}) {
      return JSON.stringify({ id: "A", comment: scope.annotation.comment,
        position: JSON.stringify(scope.annotation.position), width: 60, height: 30, ...extra });
    },
    resize(extra) { return scope.bridge.resize(this.request(extra), scope.doc); },
  };
}

function topLeft(rect, degrees) {
  const radians = degrees * Math.PI / 180;
  const x = -(rect[2] - rect[0]) / 2, y = (rect[3] - rect[1]) / 2;
  return [(rect[0] + rect[2]) / 2 + Math.cos(radians) * x - Math.sin(radians) * y,
    (rect[1] + rect[3]) / 2 + Math.sin(radians) * x + Math.cos(radians) * y];
}

test("fitting preserves the rendered top-left for arbitrary annotation rotations and writes only geometry", () => {
  for (const rotation of [0, 30, 90, 180, 270]) {
    const app = harness(rotation);
    const original = app.info().annotation;
    assert.equal(app.resize(), true);
    const next = app.info().annotation;
    const before = topLeft(original.position.rects[0], rotation);
    const after = topLeft(next.position.rects[0], rotation);
    assert.ok(before.every((value, i) => Math.abs(value - after[i]) < 0.002));
    assert.ok(Math.abs(next.position.rects[0][2] - next.position.rects[0][0] - 60) < 0.002);
    assert.ok(Math.abs(next.position.rects[0][3] - next.position.rects[0][1] - 30) < 0.002);
    assert.equal(next.comment, original.comment);
    assert.equal(next.color, original.color);
    assert.equal(next.position.fontSize, original.position.fontSize);
    assert.deepEqual(Object.keys(app.scope.changes[0][0]).sort(), ["id", "position", "sortIndex"]);
    assert.equal(app.scope.changes[0][0].sortIndex, original.sortIndex);
    assert.equal(app.resize(), false, "an already fitted position does not create another undo change");
  }
});

test("view scale and split-view lookup use the matching native page without PDF window globals", () => {
  const app = harness();
  assert.equal(app.info().scale, 2);
  app.scope.internal._primaryView = { _view: { _iframeWindow: { document: {} } } };
  app.scope.internal._secondaryView = { _view: app.scope.view };
  assert.equal(app.info().scale, 2);
  assert.equal(app.resize(), true);
});

test("manual resize detection observes only triggered Add Text resize actions in the matching PDF", () => {
  const app = harness();
  for (const type of ["resize", "moveAndDrag", "rotate", "selectText"]) {
    app.scope.view.action = { type, triggered: true, annotation: app.scope.annotation };
    assert.equal(app.scope.bridge.resizing(app.scope.doc), type === "resize" ? "A" : null);
  }
  app.scope.view.action = { type: "resize", triggered: false, annotation: app.scope.annotation };
  assert.equal(app.scope.bridge.resizing(app.scope.doc), null);
  app.scope.view.action.triggered = true;
  app.scope.annotation.type = "image";
  assert.equal(app.scope.bridge.resizing(app.scope.doc), null);
  app.scope.annotation.type = "text";
  assert.equal(app.scope.bridge.resizing({}), null);
});

test("stale content/positions, active pointer actions, invalid sizes, and read-only annotations never write", () => {
  for (const setup of [
    scope => { scope.annotation.comment = "changed"; },
    scope => { scope.annotation.position.rects[0][0] += 1; },
    scope => { scope.view.action = { type: "resize" }; },
    scope => { scope.annotation.readOnly = true; },
    scope => { scope.manager._readOnly = true; },
    scope => { scope.view._readOnly = true; },
    scope => { scope.annotation.type = "highlight"; },
  ]) {
    const app = harness(), request = app.request();
    setup(app.scope);
    assert.equal(app.scope.bridge.resize(request, app.scope.doc), false);
    assert.equal(app.scope.changes.length, 0);
  }
  for (const width of [0, -1, null, Infinity]) {
    const app = harness();
    assert.equal(app.resize({ width }), false);
    assert.equal(app.scope.changes.length, 0);
  }
});

test("re-entering editing restores native source dimensions and page-edge bounds stay on the page", () => {
  const app = harness();
  assert.equal(app.resize(), true);
  assert.equal(app.resize({ source: true }), true);
  assert.deepEqual(app.info().annotation.position.rects, [[200, 300, 500, 450]]);
  const edge = harness();
  edge.scope.page.viewport.viewBox = [250, 250, 450, 450];
  assert.equal(edge.resize(), true);
  const rect = edge.info().annotation.position.rects[0];
  assert.ok(rect[0] >= 250 && rect[1] >= 250 && rect[2] <= 450 && rect[3] <= 450);
});

test("unready native source measurements cannot save collapsed annotation rectangles", () => {
  const app = harness();
  app.scope.view.adjustTextAnnotationPosition = () => ({ rects: [[30, 600, 550, 600]] });
  assert.equal(app.resize({ source: true }), false);
  assert.equal(app.scope.changes.length, 0);
});
