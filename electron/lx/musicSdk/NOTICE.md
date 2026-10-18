# LX Music musicSdk（第三方代码说明）

`src/` 下的文件复制自 [lyswhut/lx-music-desktop](https://github.com/lyswhut/lx-music-desktop)
（提交 `ad95d5091c9ed689fa72b5e5c849df65f5a679ce`，路径 `src/renderer/utils/musicSdk/` 与 `src/common/utils/lyricUtils/kg.js`），
按 Apache License 2.0 使用，许可证全文见同目录 `LICENSE-lx-music-desktop`。

Folia-LX 对这些文件的改动：

- 只取酷我（kw）、酷狗（kg）、QQ（tx）、网易（wy）、咪咕（mg）五个来源的搜索、歌单、歌词、封面模块；
- `versionChars.ts` 改名为 `versionChars.js`（内容未改）；
- `kgKrc.js`（原 `lyricUtils/kg.js`）的 `decodeName` 改从 `../index` 引入；
- 原来依赖渲染进程的 `request.js` 和 `utils/index.ts` 换成同目录的 `request.js`、`index.js`（主进程版，见文件头）；
- `entry.js` 是 Folia-LX 写的入口，其中 `pickMatches` 移植自原 `musicSdk/index.js` 的 `findMusic`。

`lxMusicSdk.cjs` 由 `npm run build:lx-sdk`（`dev/lx/bundleMusicSdk.mjs`）从以上文件打包生成，不要手改。

本目录不含任何“自定义源”脚本；播放地址只来自用户自己导入的脚本。
