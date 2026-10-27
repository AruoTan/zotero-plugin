/* Plugin lifecycle entry point. Feature modules are bundled before this file. */

var ZoteroPluginFeatures = [
  ZoteroPluginSelectionPopup,
  ZoteroPluginHandwrittenText,
  ZoteroPluginBlackTextSidebarFilter,
  ZoteroPluginAnnotationHitTargets,
  ZoteroPluginMathText,
  ZoteroPluginTextAnnotationSize,
];

function install() {}
function uninstall() {}

function startup({ id }) {
  for (const feature of ZoteroPluginFeatures) {
    feature.startup({ id });
  }
}

function shutdown() {
  for (const feature of [...ZoteroPluginFeatures].reverse()) {
    feature.shutdown();
  }
}
