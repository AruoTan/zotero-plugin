# Bundled handwriting font

荷塘月色手写体 (Hetang Yuese) supplies Chinese characters, English letters, and digits from the same handwritten face. Using its native Latin glyphs keeps stroke weight and style consistent in mixed-language PDF annotations.

- Author: 豆角豆角
- File: `HetangYuese-Regular.ttf`
- Internal family name: `hetangyuese` / `荷塘月色手写体`
- Font version: Version 1.000, January 15, 2025 (corrected release)
- Source package: [`@fontpkg/hetangyuese@1.0.0`](https://registry.npmjs.org/@fontpkg/hetangyuese/-/hetangyuese-1.0.0.tgz), original filename `荷塘月色手写体 Regular.ttf`
- SHA-256: `a829f60335600d182b382bf1186cf57d78ea2ea23be33aa6c44cfb5bf05cbd16`
- Attribution and author declaration references: [HetangYuese-NOTICE.txt](HetangYuese-NOTICE.txt)
- Release announcement: [author's post](https://mp.weixin.qq.com/s/UH2XYR_ey_EOslvx3cz9sQ), [reproduced announcement](https://www.maoken.com/freefonts/24739.html)

The reproduced author declaration allows free personal and enterprise use. The binary is embedded unchanged, and the attribution notice is packaged with the plugin.

## Embedding and font selection

`scripts/build.sh` embeds this font as a base64 data URL in `ZoteroPluginHandwritingFonts` in the generated `bootstrap.js`. Each reader document loads the face with `FontFace` before handwriting styles are applied. No system font installation or network request is needed.

The CSS family order is `ZoteroPluginHandwriting` (Hetang Yuese), then the reader's original family for missing glyphs. Chinese, Latin, and numeric glyphs all use Hetang Yuese when available. The runtime CSS alias does not change the binary's internal font name.
