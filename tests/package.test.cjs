const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const projectDir = path.join(__dirname, "..");

test("built XPI has a Zotero-compatible manifest and root bootstrap entry points", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero package test-"));
  try {
    const fixtureDir = path.join(tempDir, "project with spaces");
    fs.mkdirSync(fixtureDir);
    for (const entry of ["manifest.json", "scripts", "src", "assets", "vendor"]) {
      fs.cpSync(path.join(projectDir, entry), path.join(fixtureDir, entry), { recursive: true });
    }
    execFileSync("bash", [path.join(fixtureDir, "scripts/build.sh")], { cwd: tempDir });
    const archive = path.join(fixtureDir, "dist/zotero-plugin.xpi");
    const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
    assert.ok(entries.includes("manifest.json"), "manifest.json must be at the XPI root");
    assert.ok(entries.includes("bootstrap.js"), "bootstrap.js must be at the XPI root");
    for (const license of ["HetangYuese-NOTICE.txt"]) {
      assert.ok(entries.includes(`assets/fonts/${license}`), "bundled font notice must be packaged");
    }

    const manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
    // Zotero's documented bootstrap format is MV2. Gecko rejects MV1 before startup.
    assert.equal(manifest.manifest_version, 2, "Zotero plugins must use manifest_version 2");
    assert.equal(manifest.applications.zotero.id, "vnmhgrjk@sfirstmail.com");
    // Zotero patches Gecko to reject a missing id, update_url, or strict_max_version.
    const updateURL = new URL(manifest.applications.zotero.update_url);
    assert.equal(updateURL.protocol, "https:");
    assert.equal(updateURL.href, "https://raw.githubusercontent.com/AruoTan/zotero-plugin/master/update.json");
    const updates = JSON.parse(fs.readFileSync(path.join(projectDir, "update.json"), "utf8"));
    assert.ok(Array.isArray(updates.addons[manifest.applications.zotero.id].updates));
    assert.equal(typeof manifest.applications.zotero.strict_min_version, "string");
    assert.equal(manifest.applications.zotero.strict_max_version, "10.0.*", "must allow Zotero 10.0.6");
    assert.deepEqual(manifest, JSON.parse(fs.readFileSync(path.join(projectDir, "manifest.json"), "utf8")));

    const bootstrap = execFileSync("unzip", ["-p", archive, "bootstrap.js"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const scope = vm.createContext({});
    vm.runInContext(bootstrap, scope, { filename: "bootstrap.js" });
    assert.ok(scope.ZoteroPluginFeatures.includes(scope.ZoteroPluginBlackTextSidebarFilter),
      "the sidebar filter must be bundled and registered in the plugin lifecycle");
    assert.equal(typeof scope.ZoteroPluginBlackTextSidebarFilter.startup, "function");
    assert.equal(typeof scope.ZoteroPluginBlackTextSidebarFilter.shutdown, "function");
    assert.ok(scope.ZoteroPluginFeatures.includes(scope.ZoteroPluginAnnotationHitTargets),
      "annotation hit targets must be bundled and registered");
    assert.equal(typeof scope.ZoteroPluginAnnotationHitTargets.startup, "function");
    assert.equal(typeof scope.ZoteroPluginAnnotationHitTargets.shutdown, "function");
    assert.ok(scope.ZoteroPluginFeatures.includes(scope.ZoteroPluginMathText),
      "MathJax text previews must be bundled and registered");
    assert.equal(typeof scope.ZoteroPluginMathText.shutdown, "function");
    assert.ok(scope.ZoteroPluginFeatures.includes(scope.ZoteroPluginTextAnnotationSize),
      "rendered annotation sizing must be bundled and registered");
    assert.match(scope.ZoteroPluginMathJax.render("x^2"), /<svg/,
      "the bundled renderer must work without DOM, module loaders, or network");
    const fontFiles = fs.readdirSync(path.join(projectDir, "assets/fonts"))
      .filter(name => /\.(ttf|otf|woff2?)$/i.test(name)).sort();
    assert.deepEqual(fontFiles, ["HetangYuese-Regular.ttf"],
      "source assets must contain only the current handwriting font");
    assert.deepEqual([...entries].sort(), [
      "assets/fonts/HetangYuese-NOTICE.txt",
      "bootstrap.js", "manifest.json",
      "vendor/mathjax/LICENSE",
    ], "archive must not retain obsolete font resources");
    const embeddedFonts = scope.ZoteroPluginHandwritingFonts;
    assert.deepEqual(Array.from(embeddedFonts, font => font.family),
      ["ZoteroPluginHandwriting"]);
    for (const [index, filename] of ["HetangYuese-Regular.ttf"].entries()) {
      assert.ok(embeddedFonts[index].source.startsWith("data:font/ttf;base64,"));
      const bytes = Buffer.from(embeddedFonts[index].source.split(",")[1], "base64");
      assert.deepEqual(bytes, fs.readFileSync(path.join(projectDir, "assets/fonts", filename)));
    }
    for (const hook of ["install", "uninstall", "startup", "shutdown"]) {
      assert.equal(typeof scope[hook], "function", `${hook} must be available in Zotero's bootstrap scope`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
